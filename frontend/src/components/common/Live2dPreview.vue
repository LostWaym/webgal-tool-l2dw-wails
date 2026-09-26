<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { L2dwContainer, writeFilterStateToContainer } from '../../live2d/L2dwContainer'
import { toFileUrl } from '../../path_utils'
import type { FilterState } from '../../stores/previewStore'
import { DEFAULT_FILTER_STATE } from '../../stores/previewStore'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../../utils/consts'
import type { WmdlConfig } from '../../stores/wmdlTypes'
import { useMessage } from '../../composables/useMessage'
import { SaveScreenshot } from '../../../wailsjs/go/main/App'

const msg = useMessage()

// pixi-live2d-display reads window.PIXI.Ticker
;(window as any).PIXI = PIXI

const props = defineProps<{
  /** wmdl 模型组配置（含子模型列表）。为空时不渲染任何模型。 */
  wmdlConfig?: WmdlConfig | null
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let app: PIXI.Application | null = null
let rootContainer: PIXI.Container | null = null
let stageMain: PIXI.Container | null = null
let wrapper: L2dwContainer | null = null
/** 子模型 Live2DModel 列表（按 wmdlConfig.models 顺序），用于销毁 */
const subModels: Live2DModel[] = []
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
  await init()
})

watch(
  () => props.wmdlConfig,
  async (newConfig) => {
    if (!newConfig) return
    if (!app) {
      await init()
    } else {
      await loadWmdlModels(newConfig)
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
  })
  resizeObserver.observe(host)

  attachDomHandlers()
  await loadWmdlModels(props.wmdlConfig)
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

async function loadWmdlModels(config: WmdlConfig | null | undefined) {
  if (!app || !rootContainer || !stageMain) return

  // 销毁旧的子模型与 wrapper
  for (const m of subModels) {
    wrapper?.removeChild(m)
    m.destroy()
  }
  subModels.length = 0

  if (wrapper) {
    wrapper.destroy({ children: true })
    wrapper = null
  }

  // 创建主 wrapper（wmdl 整体容器），与 Stage.vue loadWmdlModels 一致
  wrapper = new L2dwContainer()
  wrapper.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  wrapper.pivot.set(0, STAGE_HEIGHT / 2)
  stageMain.addChild(wrapper)

  const models = config?.models ?? []
  if (models.length === 0) {
    fitModel()
    return
  }

  try {
    for (const wmdlModel of models) {
      const url = toFileUrl(wmdlModel.jsonAbsPath)
      const model = await Live2DModel.from(url, {
        idleMotionGroup: '',
        autoInteract: false,
      })

      const scaleX = STAGE_WIDTH / model.width
      const scaleY = STAGE_HEIGHT / model.height
      const targetScale = Math.min(scaleX, scaleY) * 1.25
      model.scale.set(targetScale, targetScale)
      model.anchor.set(0.5)
      model.position.x = 0 + wmdlModel.offsetX
      model.position.y = STAGE_HEIGHT / 1.8 + wmdlModel.offsetY

      wrapper.addChild(model)
      subModels.push(model)
    }

    writeFilterStateToContainer(wrapper, currentFilterState, currentScale)
    fitModel()
  } catch (err) {
    console.error('Live2dPreview failed to load model group:', err)
  }
}

/**
 * FitInside: 在 STAGE 坐标系下，模型组长边贴齐 STAGE 边界，整体不被裁剪。
 * rootContainer 自身负责把整个 STAGE 缩放到适配 host。
 */
function fitModel() {
  if (!wrapper || !rootContainer || !app) return
  const host = containerRef.value
  if (!host) return

  const h = host.clientHeight
  if (h <= 0) return

  // 模型组为空时不做 fit 处理（仅保留 rootContainer 居中）
  if (subModels.length === 0) {
    initialViewport.x = rootContainer.x
    initialViewport.y = rootContainer.y
    initialViewport.scale = computeFitScale(h)
    rootContainer.scale.set(initialViewport.scale)
    currentScale = initialViewport.scale
    return
  }

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

/** 把 Blob 写入系统剪贴板。失败时通过气泡提示原因。 */
async function copyBlobToClipboard(blob: Blob) {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      msg.warning('当前环境不支持将图片写入剪贴板')
      return
    }
    console.error(`${blob.type}`)
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  } catch (err) {
    msg.error('复制到剪贴板失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

/**
 * 把截图 PNG 同时落盘到 exe 同级 screenshots/。
 * 文件名：prefix_yyyymmdd_HHMMSS_fff.png。
 * 失败时降级为 warning（剪贴板复制仍继续），不阻塞主流程。
 */
async function saveBlobToDisk(blob: Blob, prefix: 'screen' | 'original'): Promise<string> {
  try {
    const d = new Date()
    const pad = (n: number, w = 2) => String(n).padStart(w, '0')
    const stamp =
      d.getFullYear().toString() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) + '_' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds()) + '_' +
      pad(d.getMilliseconds(), 3)
    const filename = `${prefix}_${stamp}.png`

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = () => reject(fr.error)
      fr.readAsDataURL(blob)
    })
    const base64 = dataUrl.split(',')[1] ?? ''

    const path = await SaveScreenshot(filename, base64)
    msg.success(`已保存截图：${path}`)
    return path
  } catch (err) {
    msg.warning('保存截图失败：' + (err instanceof Error ? err.message : String(err)))
    return ''
  }
}

/**
 * canvas -> Blob 的 Promise 封装；toBlob 在主线程中是异步的，回包用 Promise 包起来。
 * 出错时返回 null 并提示。
 */
function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type)
    } catch (err) {
      msg.error('生成图片失败：' + (err instanceof Error ? err.message : String(err)))
      resolve(null)
    }
  })
}

/**
 * PIXI extract 输出的 canvas 在 toBlob 时会被浏览器合成为黑色不透明 PNG。
 * 这里把内容重绘到一张全新的 2D 画布：先 clearRect 拿到 alpha=0 透明底，
 * 再 drawImage 原样贴回去，PNG 输出即可保留真正的透明通道。
 */
function toTransparentCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')
  if (!ctx) return src
  ctx.clearRect(0, 0, out.width, out.height)
  ctx.drawImage(src, 0, 0)
  return out
}

/** 功能1：抽取 rootContainer 作为"屏幕所见"画面（包含用户的缩放/平移），输出透明 PNG。 */
async function copyScreenToClipboard() {
  if (!app || !rootContainer) {
    msg.warning('模型尚未加载')
    return
  }
  let raw: HTMLCanvasElement
  try {
    raw = (app.renderer as any).extract.canvas(rootContainer) as HTMLCanvasElement
  } catch (err) {
    msg.error('PIXI 抽帧失败：' + (err instanceof Error ? err.message : String(err)))
    return
  }
  const canvas = toTransparentCanvas(raw)
  const blob = await canvasToBlob(canvas)
  if (!blob) return
  await saveBlobToDisk(blob, 'screen')
  await copyBlobToClipboard(blob)
}

/** 功能2：使用 PIXI renderer.extract 抽取 stageMain（原始 stage 坐标系），不受视口变换影响。 */
async function copyOriginalToClipboard() {
  if (!app || !stageMain) {
    msg.warning('模型尚未加载')
    return
  }
  let raw: HTMLCanvasElement
  try {
    raw = (app.renderer as any).extract.canvas(stageMain) as HTMLCanvasElement
  } catch (err) {
    msg.error('PIXI 抽帧失败：' + (err instanceof Error ? err.message : String(err)))
    return
  }
  const canvas = toTransparentCanvas(raw)
  const blob = await canvasToBlob(canvas)
  if (!blob) return
  await saveBlobToDisk(blob, 'original')
  await copyBlobToClipboard(blob)
}

function dispose() {
  detachDomHandlers?.()
  detachDomHandlers = null

  resizeObserver?.disconnect()
  resizeObserver = null

  for (const m of subModels) {
    m.destroy()
  }
  subModels.length = 0
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
  /**
   * 直接写入选中子模型的参数值（不重载模型），用于表情编辑等需要实时预览的场景。
   * 不依赖外部 runtimeRegistry，走本组件自己的 subModels 引用。
   */
  applyParameters(params: Array<{ id: string; val: number }>) {
    if (!subModels.length) return
    for (const m of subModels) {
      const core: any = (m as any).internalModel?.coreModel
      if (!core) continue
      for (const { id, val } of params) {
        if (typeof core.setParameterValueById === 'function') {
          core.setParameterValueById(id, val)
        } else if (typeof core.setParamFloat === 'function') {
          core.setParamFloat(id, val)
        }
      }
    }
  },
  /**
   * 暴露当前已加载的所有 Live2DModel（按 wmdlConfig.models 顺序），
   * 用于父组件（如演出编辑器 ActorStage）将实例同步到
   * editRuntime.live2dModels，从而让 coreAdapter / store.populate* 读到模型。
   */
  getLoadedModels(): Live2DModel[] {
    return [...subModels]
  },
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
    <button
      class="reset-view-btn"
      title="复制屏幕画面到剪贴板"
      aria-label="复制屏幕画面到剪贴板"
      @click="copyScreenToClipboard"
    >
      &#x1F4F7;
    </button>
    <button
      class="reset-view-btn"
      title="复制原图到剪贴板"
      aria-label="复制原图到剪贴板"
      @click="copyOriginalToClipboard"
    >
      &#x1F3A8;
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

/* 后续按钮相对前一个按钮偏移 32px，避免逐个硬编码 left */
.reset-view-btn + .reset-view-btn {
  left: 40px;
}

.reset-view-btn + .reset-view-btn + .reset-view-btn {
  left: 72px;
}
</style>
