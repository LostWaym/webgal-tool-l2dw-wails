<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { L2dwContainer, writeFilterStateToContainer } from '../../live2d/L2dwContainer'
import { toFileUrl } from '../../path_utils'
import type { FilterState } from '../../stores/previewStore'
import { DEFAULT_FILTER_STATE } from '../../stores/previewStore'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../../utils/consts'

// pixi-live2d-display reads window.PIXI.Ticker
;(window as any).PIXI = PIXI

const props = defineProps<{
  /** Live2D 模型描述 json 的绝对路径 */
  modelPath: string
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let app: PIXI.Application | null = null
let rootContainer: PIXI.Container | null = null
let stageMain: PIXI.Container | null = null
let wrapper: L2dwContainer | null = null
let model: Live2DModel | null = null
let resizeObserver: ResizeObserver | null = null
let currentFilterState: FilterState = { ...DEFAULT_FILTER_STATE }
let currentScale = 1

// 视口交互常量
const MIN_SCALE = 0.05
const MAX_SCALE = 20
const ZOOM_FACTOR = 1.1

// 拖拽状态
let isDragging = false
let dragLastX = 0
let dragLastY = 0

// 视口事件清理
let detachDomHandlers: (() => void) | null = null

// 初始视口（用于重置）
const initialViewport = { x: 0, y: 0, scale: 1 }

onMounted(async () => {
  if (!props.modelPath) return
  await init()
})

watch(
  () => props.modelPath,
  async (newPath) => {
    if (!newPath) return
    if (!app) {
      await init()
    } else {
      await loadModel(newPath)
    }
  },
)

onBeforeUnmount(() => {
  dispose()
})

async function init() {
  const host = containerRef.value
  if (!host) return

  app = new PIXI.Application({
    width: host.clientWidth || 300,
    height: host.clientHeight || 400,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  })
  app.ticker.maxFPS = 60

  host.appendChild(app.view as HTMLCanvasElement)

  // Root 容器：以舞台坐标系 (STAGE_WIDTH/STAGE_HEIGHT) 为基准，
  // 用 scale 把舞台适配进 host.clientHeight（保留 80% 留白）。
  rootContainer = new PIXI.Container()
  const initialScale = computeFitScale(host.clientHeight)
  rootContainer.x = host.clientWidth / 2
  rootContainer.y = host.clientHeight / 2
  rootContainer.scale.set(initialScale)
  currentScale = initialScale

  stageMain = new PIXI.Container()
  stageMain.width = STAGE_WIDTH
  stageMain.height = STAGE_HEIGHT
  stageMain.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  stageMain.x = 0
  stageMain.y = 0

  rootContainer.addChild(stageMain)
  app.stage.addChild(rootContainer)

  resizeObserver = new ResizeObserver(() => {
    if (!app || !host) return
    app.renderer.resize(host.clientWidth, host.clientHeight)
    if (rootContainer) {
      rootContainer.x = host.clientWidth / 2
      rootContainer.y = host.clientHeight / 2
    }
    fitModel()
  })
  resizeObserver.observe(host)

  attachDomHandlers()
  await loadModel(props.modelPath)
}

/** 计算让 STAGE_HEIGHT 适配进 hostHeight、保留 20% 留白的初始 scale。 */
function computeFitScale(hostHeight: number): number {
  const h = hostHeight || STAGE_HEIGHT
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, (h / STAGE_HEIGHT) * 0.8))
}

function attachDomHandlers() {
  if (!app) return
  const canvas = app.view as HTMLCanvasElement

  const onPointerDown = (e: PointerEvent) => {
    // 只响应左键
    if (e.button !== 0) return
    isDragging = true
    dragLastX = e.clientX
    dragLastY = e.clientY
    canvas.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging || !rootContainer) return
    const dx = e.clientX - dragLastX
    const dy = e.clientY - dragLastY
    rootContainer.x += dx
    rootContainer.y += dy
    dragLastX = e.clientX
    dragLastY = e.clientY
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!isDragging) return
    isDragging = false
    canvas.releasePointerCapture?.(e.pointerId)
  }

  const onWheel = (e: WheelEvent) => {
    if (!rootContainer) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rootContainer.scale.x * factor))
    rootContainer.scale.set(next)
    currentScale = next
    // 重算 wrapper 中受缩放影响的滤镜属性
    if (wrapper) writeFilterStateToContainer(wrapper, currentFilterState, currentScale)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  detachDomHandlers = () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
  }
}

async function loadModel(jsonPath: string) {
  if (!app || !rootContainer || !stageMain) return

  // 销毁旧的模型与 wrapper
  if (model) {
    wrapper?.removeChild(model)
    model.destroy()
    model = null
  }
  if (wrapper) {
    wrapper.destroy({ children: true })
    wrapper = null
  }

  wrapper = new L2dwContainer()
  // base 锚定舞台中心，使模型天然位于 STAGE 坐标系中央；
  // rootContainer 自身的 scale/居中负责把 STAGE 适配进 host。
  wrapper.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  stageMain.addChild(wrapper)

  try {
    const loaded = await Live2DModel.from(toFileUrl(jsonPath), {
      idleMotionGroup: '',
      autoInteract: false,
    })
    model = loaded
    wrapper.addChild(model)
    writeFilterStateToContainer(wrapper, currentFilterState, currentScale)
    fitModel()
  } catch (err) {
    console.error('Live2dPreview failed to load model:', err)
  }
}

/**
 * FitInside: 在 STAGE 坐标系下，模型长边贴齐 STAGE 边界，整体不被裁剪。
 * rootContainer 自身负责把整个 STAGE 缩放到适配 host。
 */
function fitModel() {
  if (!model || !wrapper || !rootContainer || !app) return
  const host = containerRef.value
  if (!host) return

  const h = host.clientHeight
  if (h <= 0) return

  // 模型在 STAGE 坐标系下按长边贴齐 STAGE 边界
  model.anchor.set(0.5)
  model.position.set(0, 0)
  const scale = Math.min(STAGE_WIDTH / model.width, STAGE_HEIGHT / model.height)
  model.scale.set(scale, scale)

  // 记录初始视口（重置按钮使用）：重置到 fitModel 时计算的自适应 scale
  initialViewport.x = rootContainer.x
  initialViewport.y = rootContainer.y
  initialViewport.scale = computeFitScale(h)
  // 把当前 rootContainer 也同步到 fitScale，避免多次 resize 时累积误差
  rootContainer.scale.set(initialViewport.scale)
  currentScale = initialViewport.scale
  // 重置后再写一次滤镜，使 scale 敏感字段（blur/bevelThickness/bloomBlur）按新 scale 重新换算
  if (wrapper) writeFilterStateToContainer(wrapper, currentFilterState, currentScale)
}

/** 把 FilterState 按当前 rootContainer 缩放写入 wrapper。 */
function applyFilter(state: FilterState) {
  if (!wrapper) return
  writeFilterStateToContainer(wrapper, state, currentScale)
}

function setFilter(patch: Partial<FilterState>) {
  currentFilterState = { ...currentFilterState, ...patch }
  applyFilter(currentFilterState)
}

function resetFilter() {
  currentFilterState = { ...DEFAULT_FILTER_STATE }
  applyFilter(currentFilterState)
}

/** 重置视口到 fitModel 时记录的初始位置和缩放 */
function resetViewport() {
  if (!rootContainer) return
  rootContainer.x = initialViewport.x
  rootContainer.y = initialViewport.y
  rootContainer.scale.set(initialViewport.scale)
}

function dispose() {
  detachDomHandlers?.()
  detachDomHandlers = null

  resizeObserver?.disconnect()
  resizeObserver = null

  if (model) {
    model.destroy()
    model = null
  }
  if (wrapper) {
    wrapper.destroy({ children: true })
    wrapper = null
  }
  if (rootContainer) {
    rootContainer.destroy({ children: true })
    rootContainer = null
  }
  if (app) {
    try {
      app.destroy(true, { children: true, texture: true, baseTexture: true })
    } catch (e) {
      console.warn('Live2dPreview pixi destroy error:', e)
    }
    app = null
  }
}

defineExpose({
  setFilter,
  resetFilter,
  resetViewport,
})
</script>

<template>
  <div ref="containerRef" class="live2d-preview">
    <button
      class="reset-view-btn"
      title="重置视口"
      aria-label="重置视口"
      @click="resetViewport"
    >
      &#8634;
    </button>
  </div>
</template>

<style scoped>
.live2d-preview {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: rgba(20, 23, 28, 0.6);
  border-radius: 6px;
  overflow: hidden;
}

.live2d-preview :deep(canvas) {
  display: block;
}

.reset-view-btn {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 10;
  width: 28px;
  height: 28px;
  background-color: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background-color 120ms ease;
}

.reset-view-btn:hover {
  background-color: rgba(47, 128, 237, 0.6);
}

.reset-view-btn:active {
  transform: scale(0.95);
}
</style>
