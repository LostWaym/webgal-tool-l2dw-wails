<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { L2dwContainer, FILTER_PROPERTY_KEYS } from '../../live2d/L2dwContainer'
import { toFileUrl } from '../../path_utils'
import type { FilterState } from '../../stores/previewStore'
import { DEFAULT_FILTER_STATE } from '../../stores/previewStore'

// pixi-live2d-display reads window.PIXI.Ticker
;(window as any).PIXI = PIXI

const props = defineProps<{
  /** Live2D 模型描述 json 的绝对路径 */
  modelPath: string
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let app: PIXI.Application | null = null
let rootContainer: PIXI.Container | null = null
let wrapper: L2dwContainer | null = null
let model: Live2DModel | null = null
let resizeObserver: ResizeObserver | null = null
let currentFilterState: FilterState = { ...DEFAULT_FILTER_STATE }

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

  // Root 容器：用户通过左键拖拽和滚轮缩放操作它
  rootContainer = new PIXI.Container()
  rootContainer.x = app.renderer.width / 2
  rootContainer.y = app.renderer.height / 2
  rootContainer.scale.set(1)
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
  if (!app || !rootContainer) return

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
  wrapper.setBasePosition(0, 0)
  rootContainer.addChild(wrapper)

  try {
    const loaded = await Live2DModel.from(toFileUrl(jsonPath), {
      idleMotionGroup: '',
      autoInteract: false,
    })
    model = loaded
    wrapper.addChild(model)
    applyFilter(currentFilterState)
    fitModel()
  } catch (err) {
    console.error('Live2dPreview failed to load model:', err)
  }
}

/**
 * FitInside: 模型长边贴齐容器边界，整体不被裁剪。
 * 居中/缩放由 rootContainer 负责，wrapper 内部模型保持 anchor (0.5, 0.5)。
 */
function fitModel() {
  if (!model || !wrapper || !rootContainer || !app) return
  const host = containerRef.value
  if (!host) return

  const w = host.clientWidth
  const h = host.clientHeight
  if (w <= 0 || h <= 0) return

  // 让模型在 rootContainer 内部按自身原始大小显示；rootContainer 自身负责缩放与居中。
  model.anchor.set(0.5)
  model.position.set(0, 0)
  const scale = Math.min(w / model.width, h / model.height)
  model.scale.set(scale, scale)

  // 记录初始视口（重置按钮使用）
  initialViewport.x = rootContainer.x
  initialViewport.y = rootContainer.y
  initialViewport.scale = 1
}

/** 把 FilterState 字段写回当前 wrapper。 */
function applyFilter(state: FilterState) {
  if (!wrapper) return
  for (const key of FILTER_PROPERTY_KEYS) {
    ;(wrapper as any)[key] = (state as any)[key]
  }
  wrapper.l2dwAlphaFilter = state.l2dwAlphaFilter
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
