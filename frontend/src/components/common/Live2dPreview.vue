<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { L2dwContainer, writeFilterStateToContainer } from '../../live2d/L2dwContainer'
import { toFileUrl } from '../../path_utils'
import type { FilterState } from '../../stores/previewStore'
import { DEFAULT_FILTER_STATE } from '../../stores/previewStore'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../../utils/consts'
import type { WmdlConfig, ParamCalc } from '../../stores/wmdlTypes'
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

// 模型组加载指纹：只有 id/jsonAbsPath 变化才重载，避免深层编辑（如 initParams）触发整体重建重置视口
let loadSeq = 0

watch(
  () => (props.wmdlConfig?.models ?? []).map((m) => `${m.id}:${m.jsonAbsPath}`).join('|'),
  async () => {
    if (!props.wmdlConfig) return
    if (!app) {
      await init()
    } else {
      await loadWmdlModels(props.wmdlConfig)
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
    preserveDrawingBuffer: true,
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
    const oldW = app.renderer.width
    const oldH = app.renderer.height
    app.renderer.resize(host.clientWidth, host.clientHeight)
    if (rootContainer) {
      // 按比例保留用户平移的视口位置，避免尺寸变化时被拉回中心
      if (oldW > 0 && oldH > 0) {
        rootContainer.x = (rootContainer.x / oldW) * host.clientWidth
        rootContainer.y = (rootContainer.y / oldH) * host.clientHeight
      } else {
        rootContainer.x = host.clientWidth / 2
        rootContainer.y = host.clientHeight / 2
      }
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

/**
 * 根据 calc 把 id/val 写入 Live2D coreModel。
 *  - cubism 3/4：原生支持 set/add/mult，优先调用专属方法
 *  - cubism 2：仅原生 set；add/mult 走 getParamFloat → 算术 → setParamFloat
 */
function writeParamByCalc(core: any, id: string, val: number, calc: ParamCalc): void {
  if (calc === 'set') {
    if (typeof core.setParameterValueById === 'function') {
      core.setParameterValueById(id, val)
    } else if (typeof core.setParamFloat === 'function') {
      core.setParamFloat(id, val)
    }
    return
  }

  if (calc === 'add' && typeof core.addParameterValueById === 'function') {
    core.addParameterValueById(id, val)
    return
  }
  if (calc === 'mult' && typeof core.multiplyParameterValueById === 'function') {
    core.multiplyParameterValueById(id, val)
    return
  }

  // cubism 2 兼容路径：手动 read-modify-write
  const cur =
    typeof core.getParameterValueById === 'function'
      ? core.getParameterValueById(id)
      : typeof core.getParamFloat === 'function'
        ? core.getParamFloat(id)
        : undefined
  if (typeof cur !== 'number') return
  const next = calc === 'add' ? cur + val : cur * val
  if (typeof core.setParameterValueById === 'function') {
    core.setParameterValueById(id, next)
  } else if (typeof core.setParamFloat === 'function') {
    core.setParamFloat(id, next)
  }
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
  const token = ++loadSeq

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

      // 加载期间发生了更新的重载请求，丢弃本次结果
      if (token !== loadSeq) {
        model.destroy()
        return
      }

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

/** 直接对 app.view 调用 toBlob，屏幕看到什么截什么。 */
async function copyScreenFromView() {
  if (!app) {
    msg.warning('模型尚未加载')
    return
  }
  const canvas = app.view as HTMLCanvasElement
  const blob = await canvasToBlob(canvas)
  if (!blob) return
  await saveBlobToDisk(blob, 'screen')
  await copyBlobToClipboard(blob)
}

/** 以 scale 倍分辨率离屏渲染 stageMain，无视口变换，保留透明通道。 */
async function copyOriginalFromView(scale: number) {
  if (!app || !stageMain) {
    msg.warning('模型尚未加载')
    return
  }
  const parent = stageMain.parent
  if (!parent) {
    msg.error('PIXI 抽帧失败：stageMain 未挂载')
    return
  }

  let tempRoot: PIXI.Container | null = null
  try {
    // 临时摘下 stageMain 挂到缩放容器上（同 tick 内即挂回，主画面无感知），
    // 再走与旧版一致的 extract.canvas(container) 路径（内部 generateTexture 自行处理）
    // Live2D 绘制依赖主 renderer 的 GL 上下文，不能另开 Renderer（会得到黑图/空图）
    // 缩放必须放在内层容器：extract/generateTexture 按 tempRoot 的局部包围盒（不含自身
    // scale）决定 RT 尺寸，scale 放外层只会放大内容导致裁剪
    tempRoot = new PIXI.Container()
    const scaleHolder = new PIXI.Container()
    scaleHolder.addChild(stageMain)
    scaleHolder.scale.set(scale)
    tempRoot.addChild(scaleHolder)

    const raw = (app.renderer as any).plugins.extract.canvas(tempRoot) as HTMLCanvasElement
    // 手动重绘到新 canvas 以保留透明通道（与旧版一致）
    const canvas = document.createElement('canvas')
    canvas.width = raw.width
    canvas.height = raw.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(raw, 0, 0)
    const blob = await canvasToBlob(canvas)
    if (!blob) return
    await saveBlobToDisk(blob, 'original')
    await copyBlobToClipboard(blob)
  } catch (err) {
    msg.error('PIXI 抽帧失败：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    // 挂回原父容器并释放临时容器
    if (stageMain && parent) parent.addChild(stageMain)
    tempRoot?.destroy({ children: true })
  }
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
   *
   * 每个参数携带 calc 合成方式：
   *   - set:  直接覆盖当前值（裸写 coreModel.setParameterValueById / setParamFloat）
   *   - add:  在当前值基础上叠加增量（cubism 2 用 read-modify-write）
   *   - mult: 在当前值基础上乘以倍数（cubism 2 用 read-modify-write）
   */
  applyParameters(params: Array<{ id: string; val: number; calc: ParamCalc }>) {
    if (!subModels.length) return
    for (const m of subModels) {
      const core: any = (m as any).internalModel?.coreModel
      if (!core) continue
      for (const { id, val, calc } of params) {
        writeParamByCalc(core, id, val, calc)
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
  /**
   * 抓取当前预览视口（app.view）画面到不透明底色的离屏 canvas。
   * 目标尺寸由 targetW/targetH 指定（等比缩放由调用方算好传入）；
   * 抓帧前先手动 render 一次，保证参数写入后画面即时生效。
   */
  captureViewportFrame(bgColor: string, targetW: number, targetH: number): HTMLCanvasElement | null {
    if (!app) return null
    try {
      app.renderer.render(app.stage)
    } catch (e) {
      console.warn('captureViewportFrame render error:', e)
      return null
    }
    const view = app.view as HTMLCanvasElement
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(targetW))
    canvas.height = Math.max(1, Math.round(targetH))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(view, 0, 0, canvas.width, canvas.height)
    return canvas
  },
  /** 当前视口画布的实际像素尺寸（含 devicePixelRatio）。 */
  getViewportPixelSize(): { width: number; height: number } | null {
    if (!app) return null
    return { width: app.renderer.width, height: app.renderer.height }
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
      @click="copyScreenFromView"
    >
      &#x1F4F7;
    </button>
    <button
      class="reset-view-btn"
      title="复制原图到剪贴板（2倍分辨率）"
      aria-label="复制原图到剪贴板（2倍分辨率）"
      @click="copyOriginalFromView(2)"
    >
      &#x1F3A8;
    </button>
    <button
      class="reset-view-btn"
      title="复制原图到剪贴板（3倍分辨率）"
      aria-label="复制原图到剪贴板（3倍分辨率）"
      @click="copyOriginalFromView(3)"
    >
      &#x1F3A8;<sup>3</sup>
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

/* 按 DOM 顺序固定按钮位置，避免相邻选择器链条错位 */
.reset-view-btn:nth-child(2) {
  left: 40px;
}

.reset-view-btn:nth-child(3) {
  left: 72px;
}

.reset-view-btn:nth-child(4) {
  left: 104px;
}
</style>
