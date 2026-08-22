<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { LoaderResource } from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { useModelStore } from '../../stores/previewStore'
import { toFileUrl } from '../../path_utils'
import { L2dwContainer } from '../../live2d/L2dwContainer'
import { SpecialId } from '../../live2d/specialIds'
import { OpenEditor } from '../../../wailsjs/go/main/App'
import type { WmdlModelItem } from '../../stores/wmdlTypes'
import { getShortcutHints, resolveShortcutTargetType } from '../../composables/useShortcuts'
import { isSpecialId } from '../../live2d/specialIds'
import emitter, { StageEvents } from '../../stores/emitter'
import defaultBackgroundUrl from '../../assets/backgrounds/default.jpg'
import { previewRuntime } from '../../utils/runtimeRegistry'

const store = useModelStore()

const containerRef = ref<HTMLDivElement | null>(null)

// 左下操作提示：折叠状态独立于选择结果，由用户手工切换
const hintsExpanded = ref(true)
function toggleHints() {
  hintsExpanded.value = !hintsExpanded.value
}

// ─────────────────────────────────────────────────────────────────────────────
// Blender 风格变换操作（g/s/r + x/y 轴锁定）
// ─────────────────────────────────────────────────────────────────────────────
type TransformMode = 'none' | 'g' | 's' | 'r'
type AxisLock = 'none' | 'x' | 'y'

const transformMode = ref<TransformMode>('none')
const axisLock = ref<AxisLock>('none')
const isTransforming = computed(() => transformMode.value !== 'none')

// 变换操作的初始值（用于右键取消时还原）
let startX = 0
let startY = 0
let startScaleX = 1
let startScaleY = 1
let startRotation = 0

// 变换开始时鼠标的屏幕坐标
let tStartMouseX = 0
let tStartMouseY = 0

// s 模式：鼠标到模型初始位置的距离
let startDist = 0
// r 模式：鼠标指向模型的初始方向（已标准化）
let startDirX = 0
let startDirY = 0
let startScreenMP = new PIXI.Point(0, 0)
// 鼠标起点/起点距离/方向是否已记录（首次 onPointerMove 时记录）
let baseInitialized = false

function getTransformTarget(): PIXI.Container | undefined {
  const id = store.selectedId
  if (!id) return undefined
  if (isSpecialId(id)) {
    return previewRuntime.specialContainers.get(id)
  }
  return previewRuntime.modelWrappers.get(id)
}

function pixiToClientCoords(displayObject: PIXI.DisplayObject, localPoint: { x: number; y: number }, app: PIXI.Application): PIXI.Point {
  // 获取旋转中心（pivot）, 默认为 (0,0)
  let pivot = { x: 0, y: 0 };
  // @ts-ignore
  if ('pivot' in displayObject && displayObject.pivot) {
    // @ts-ignore
    pivot = { x: displayObject.pivot.x, y: displayObject.pivot.y };
  }
  // 取得旋转中心的全局坐标
  const globalPoint = displayObject.toGlobal(pivot);

  // 获取 Canvas 在 DOM 视口中的实际渲染边界
  const canvas = app.view;
  const rect = canvas.getBoundingClientRect();

  // 计算 CSS 缩放比例
  const scaleX = rect.width / app.screen.width;
  const scaleY = rect.height / app.screen.height;

  // 映射到 DOM clientX/clientY
  const clientX = rect.left + globalPoint.x * scaleX;
  const clientY = rect.top + globalPoint.y * scaleY;

  return new PIXI.Point(clientX, clientY);
}

const transformHint = reactive({
  modeName: '',
  axis: '无',
  x: '0',
  y: '0',
  scaleX: '1.000',
  scaleY: '1.000',
  rotationDeg: '0.0',
})

function refreshTransformHint() {
  if (!isTransforming.value) {
    transformHint.modeName = ''
    return
  }
  const target = getTransformTarget()
  if (!target) return

  transformHint.x = target.x.toFixed(1)
  transformHint.y = target.y.toFixed(1)
  transformHint.scaleX = target.scale.x.toFixed(3)
  transformHint.scaleY = target.scale.y.toFixed(3)
  transformHint.rotationDeg = ((target.rotation * 180) / Math.PI).toFixed(1)
  transformHint.modeName =
    transformMode.value === 'g' ? '拖拽'
    : transformMode.value === 's' ? '缩放'
    : '旋转'
  transformHint.axis = axisLock.value === 'none' ? '无' : axisLock.value + ' 轴'
}

function startTransform(mode: TransformMode) {
  const target = getTransformTarget()
  if (!target) return

  transformMode.value = mode
  axisLock.value = 'none'

  // 缓存模型的初始状态
  startX = target.x
  startY = target.y
  startScaleX = target.scale.x
  startScaleY = target.scale.y
  startRotation = target.rotation
  startScreenMP = pixiToClientCoords(target, { x: 0, y: 0 }, app!)

  // 标记鼠标起点尚未记录，首次 onPointerMove 时记录
  baseInitialized = false

  emitter.emit(StageEvents.TransformStart, true)
  emitter.emit(StageEvents.TransformChange, store.selectedId)
  refreshTransformHint()
}

function cancelTransform() {
  const target = getTransformTarget()
  if (target) {
    if (transformMode.value === 'g') {
      target.x = startX
      target.y = startY
    } else if (transformMode.value === 's') {
      target.scale.x = startScaleX
      target.scale.y = startScaleY
    } else if (transformMode.value === 'r') {
      target.rotation = startRotation
    }
  }
  endTransform()
}

function endTransform() {
  transformMode.value = 'none'
  axisLock.value = 'none'
  baseInitialized = false
  emitter.emit(StageEvents.TransformStart, false)
  emitter.emit(StageEvents.TransformChange, store.selectedId)
  refreshTransformHint()
}

interface MouseHint { keys: string; description: string }
interface HintsView {
  title: string
  mouse: MouseHint[]
  shortcuts: MouseHint[]
}

const TARGET_LABELS: Record<ReturnType<typeof resolveShortcutTargetType>, string> = {
  background: '背景',
  stage: '主场景',
  model: '立绘',
  none: '未选中',
}

// 通用操作：所有选中状态都会显示
const COMMON_MOUSE_HINTS: MouseHint[] = [
  { keys: '中键拖动', description: '平移舞台视图' },
  { keys: '鼠标滚轮', description: '缩放舞台视图' },
]
const COMMON_SHORTCUT_HINTS: MouseHint[] = [
  { keys: 'F1', description: '打开模型编辑器窗口' },
]

// 各类型专属的鼠标提示
const MOUSE_HINTS_BY_TYPE: Record<ReturnType<typeof resolveShortcutTargetType>, MouseHint[]> = {
  background: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转'}],
  stage: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转'}],
  model: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转'}],
  none: [],
}

const hints = computed<HintsView>(() => {
  const type = resolveShortcutTargetType(store.selectedId)
  return {
    title: `操作提示 · ${TARGET_LABELS[type]}`,
    mouse: [...MOUSE_HINTS_BY_TYPE[type], ...COMMON_MOUSE_HINTS],
    shortcuts: [...getShortcutHints(type), ...COMMON_SHORTCUT_HINTS],
  }
})

let app: PIXI.Application | null = null
const live2dById = new Map<string, Live2DModel>()
const containersById = new Map<string, L2dwContainer>()
let resizeObserver: ResizeObserver | null = null
let backgroundSprite: PIXI.Sprite | null = null

const STAGE_WIDTH = 2560
const STAGE_HEIGHT = 1440

// Root 容器交互常量
const DRAG_SENSITIVITY = 1      // 中键拖拽灵敏度
const ZOOM_SENSITIVITY = 0.0001  // 滚轮缩放灵敏度（每像素 deltaY）
const MIN_SCALE = 0.1           // 最小缩放
const MAX_SCALE = 10            // 最大缩放

let rootContainer: PIXI.Container | null = null
let stageMain: PIXI.Container | null = null
let backgroundContainer: L2dwContainer | null = null
let figureContainer: PIXI.Container | null = null
let frameContainer: PIXI.Container | null = null

let isMiddleDown = false
let lastMouseX = 0
let lastMouseY = 0

onMounted(() => {
  void init()
  emitter.on(StageEvents.ReloadModel, reloadOne)
})

onBeforeUnmount(() => {
  emitter.off(StageEvents.ReloadModel, reloadOne)
  dispose()
})

async function init() {
  const container = containerRef.value
  if (!container) return

  app = new PIXI.Application({
    width: container.clientWidth || 1024,
    height: container.clientHeight || 768,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  })
  app.ticker.maxFPS = 60
  previewRuntime.app = app

  // The plugin's auto-update reads window.PIXI.Ticker.
  ;(window as any).PIXI = PIXI

  container.appendChild(app.view as HTMLCanvasElement)

  // 创建 Root 容器（用户通过中键拖拽和滚轮缩放操作它）
  rootContainer = new PIXI.Container()
  rootContainer.x = app.renderer.width / 2
  rootContainer.y = app.renderer.height / 2
  rootContainer.scale.set(0.33)

  // 创建主容器结构
  stageMain = new PIXI.Container()
  stageMain.width = STAGE_WIDTH
  stageMain.height = STAGE_HEIGHT
  stageMain.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  stageMain.x = 0
  stageMain.y = 0

  // 创建子容器
  backgroundContainer = new L2dwContainer()
  backgroundContainer.width = STAGE_WIDTH
  backgroundContainer.height = STAGE_HEIGHT
  backgroundContainer.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  backgroundContainer.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)

  figureContainer = new PIXI.Container()
  figureContainer.width = STAGE_WIDTH
  figureContainer.height = STAGE_HEIGHT

  // 添加到舞台（背景容器在最下，立绘在上）
  stageMain.addChild(backgroundContainer)
  stageMain.addChild(figureContainer)
  rootContainer.addChild(stageMain)
  app.stage.addChild(rootContainer)

  // 创建边框容器（rootContainer 的子节点，渲染层级最高）
  frameContainer = new PIXI.Container()
  const frame = new PIXI.Graphics()
  frame.lineStyle(2, 0x00FF00)
  frame.drawRect(-STAGE_WIDTH / 2, -STAGE_HEIGHT / 2, STAGE_WIDTH, STAGE_HEIGHT)
  frameContainer.addChild(frame)
  rootContainer.addChild(frameContainer)

  resizeObserver = new ResizeObserver(() => {
    if (!app || !containerRef.value || !rootContainer) return
    const w = containerRef.value.clientWidth
    const h = containerRef.value.clientHeight

    const oldW = app.renderer.width
    const oldH = app.renderer.height
    const relX = rootContainer.x / oldW
    const relY = rootContainer.y / oldH

    app.renderer.resize(w, h)
    rootContainer.x = relX * w
    rootContainer.y = relY * h
    fitBackground()
  })
  resizeObserver.observe(container)

  attachDomHandlers()

  // 暴露特殊容器（StageMain / BGContainer），供 ModelActionPanel 直接做变换
  previewRuntime.specialContainers.set(SpecialId.StageMain, stageMain!)
  previewRuntime.specialContainers.set(SpecialId.BgContainer, backgroundContainer!)

  void loadDefaultBackground()
}

watch(
  () => store.models.map((m) => m.id),
  async (newIds, oldIds) => {
    if (!app) return
    const newSet = new Set(newIds)
    const oldSet = new Set(oldIds ?? [])

    for (const id of newIds) {
      if (!oldSet.has(id) && !containersById.has(id)) {
        await loadOne(id)
      }
    }

    for (const id of oldIds ?? []) {
      if (!newSet.has(id)) {
        removeOne(id)
      }
    }
  },
  { immediate: true },
)

// 监听模型顺序变化，同步更新渲染层级
watch(
  () => store.models.map((m) => m.id),
  (newIds) => {
    if (!figureContainer) return
    newIds.forEach((id, index) => {
      const wrapper = containersById.get(id)
      if (wrapper) {
        wrapper.zIndex = index
      }
    })
    figureContainer.sortChildren()
  },
)

// 监听模型可见性变化
watch(
  () => store.models.map((m) => ({ id: m.id, visible: m.visible })),
  (newList) => {
    if (!app) return
    for (const { id, visible } of newList) {
      const wrapper = containersById.get(id)
      if (wrapper) {
        wrapper.visible = visible
      }
    }
  },
  { deep: true },
)

watch(
  () => store.selectedId,
  (id) => {
    setCursor('default')
  },
  { immediate: true },
)

// baseX/baseY 锚定的是 stageMain 内部坐标系的中心，与画布像素无关，
// 在 loadOne 里 setBasePosition 一次即可，无需随 resize 更新。

async function loadOne(id: string) {
  if (!app) return
  const entry = store.models.find((m) => m.id === id)
  if (!entry) return

  try {
    if (entry.kind === 'image') {
      await loadImageFigure(entry)
    } else {
      await loadWmdlModels(entry)
    }

    store.selectedId = id
  } catch (err) {
    console.error('Failed to load figure:', err)
    await store.remove(id)
  }
}

/**
 * 加载图片立绘：PIXI.Sprite + FitInside（Math.min），
 * 让 sprite 在 stageMain 坐标系下被等比缩放至长边刚好贴齐 STAGE 边界，
 * 再交给外层 wrapper 接管用户主动的 x/y/scale/rotation/alpha。
 */
async function loadImageFigure(entry: NonNullable<ReturnType<typeof store.models.find>>) {
  if (!app || !entry.imageUrl) return

  // 同步 state 到 wrapper
  const wrapper = new L2dwContainer()
  wrapper.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  wrapper.x = entry.state.x ?? 0
  wrapper.y = entry.state.y ?? 0
  wrapper.scale.x = entry.state.scale?.x ?? 1
  wrapper.scale.y = entry.state.scale?.y ?? 1
  wrapper.rotation = ((entry.state.rotation ?? 0) * Math.PI) / 180

  figureContainer?.addChild(wrapper)
  containersById.set(entry.id, wrapper)
  previewRuntime.modelWrappers = containersById

  // 加载图片纹理：复用 loadBackground 的 PIXI.Loader 模式（避免 baseTexture 竞态）
  const texture = await new Promise<PIXI.Texture>((resolve, reject) => {
    const loader = new PIXI.Loader()
    loader.add('image', toFileUrl(entry.imageUrl!), {
      loadType: LoaderResource.LOAD_TYPE.IMAGE,
    })
    loader.onError.add((_, __, err) => reject(err))
    loader.load((_, resources) => {
      if (resources.image?.texture) resolve(resources.image.texture)
      else reject(resources.image?.error || new Error('Failed to load image'))
    })
  })

  const sprite = new PIXI.Sprite(texture)
  sprite.anchor.set(0.5)
  // FitInside: 长边贴齐 stage 边界，整体不被裁剪
  const imgW = texture.baseTexture.width
  const imgH = texture.baseTexture.height
  const scale = Math.min(STAGE_WIDTH / imgW, STAGE_HEIGHT / imgH)
  sprite.width = imgW * scale
  sprite.height = imgH * scale

  wrapper.addChild(sprite)
}

async function loadWmdlModels(entry: NonNullable<ReturnType<typeof store.models.find>>) {
  const wmdlModels = entry.wmdlModels ?? []
  if (wmdlModels.length === 0) return

  // 创建主 wrapper（wmdl 整体容器）
  const mainWrapper = new L2dwContainer()
  mainWrapper.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 1.8)
  mainWrapper.pivot.set(0, STAGE_HEIGHT / 2);
  figureContainer?.addChild(mainWrapper)
  containersById.set(entry.id, mainWrapper)

  // 同步 state 到 container
  if (entry.state) {
    mainWrapper.x = entry.state.x ?? 0
    mainWrapper.y = entry.state.y ?? 0
    mainWrapper.scale.x = entry.state.scale?.x ?? 1
    mainWrapper.scale.y = entry.state.scale?.y ?? 1
    mainWrapper.rotation = ((entry.state.rotation ?? 0) * Math.PI) / 180
  }

  const subModelIds: string[] = []

  // 每个子模型用独立的 wrapper，最后装入主 wrapper
  for (const wmdlModel of wmdlModels) {
    const url = toFileUrl(wmdlModel.jsonAbsPath)
    const model = await Live2DModel.from(url, { idleMotionGroup: '', autoInteract: false })

    const scaleX = STAGE_WIDTH / model.width
    const scaleY = STAGE_HEIGHT / model.height
    const targetScale = Math.min(scaleX, scaleY) * 1.25
    const targetHeight = model.height * targetScale

    model.scale.x = targetScale
    model.scale.y = targetScale
    model.anchor.set(0.5)
    model.position.x = 0 + wmdlModel.offsetX;
    model.position.y = STAGE_HEIGHT / 2 + wmdlModel.offsetY;

    mainWrapper.addChild(model)
    live2dById.set(wmdlModel.id, model)
    subModelIds.push(wmdlModel.id)
  }

  // 存储子模型 ID 映射
  previewRuntime.wmdlSubModels.set(entry.id, { subModelIds, mainWrapper })

  // 暴露给外部组件访问
  previewRuntime.live2dModels = live2dById
  previewRuntime.modelWrappers = containersById
}

async function reloadOne(id: string) {
  const entry = store.models.find((m) => m.id === id)
  if (!entry) return
  // 图片立绘没有 wmdl 可重载
  if (entry.kind === 'image') return
  if (!entry.wmdlConfig?.wmdlFilePath) return

  const ok = await store.reloadWmdlConfig(id)
  if (!ok) return

  store.selectedId = null
  removeOne(id)
  await loadWmdlModels(entry)
  store.selectedId = id
}

function removeOne(id: string) {
  const entry = store.models.find((m) => m.id === id)
  // 图片立绘不走 wmdlSubModels
  if (entry?.kind !== 'image') {
    const wmdlInfo = previewRuntime.wmdlSubModels.get(id)
    wmdlInfo?.subModelIds.forEach((subId: string) => {
      live2dById.delete(subId)
    })
    previewRuntime.wmdlSubModels.delete(id)
  }

  const wrapper = containersById.get(id)
  if (wrapper) {
    figureContainer?.removeChild(wrapper)
    wrapper.destroy({ children: true })
    containersById.delete(id)
  }

  // 更新全局引用
  previewRuntime.live2dModels = live2dById
  previewRuntime.modelWrappers = containersById
}

// Pixi v6's pointer events go through the InteractionManager plugin and use
// InteractionEvent (with data: InteractionData). For drag handling we listen
// on the canvas DOM element directly — simpler and works regardless of the
// InteractionManager state.
function attachDomHandlers() {
  if (!app) return
  const canvas = app.view as HTMLCanvasElement

  const toScreen = (clientX: number, clientY: number): PIXI.Point => {
    return new PIXI.Point(clientX, clientY)
  }

  const onPointerDown = (e: PointerEvent) => {
    // 点击 canvas 时移除输入框焦点，避免快捷键被拦截
    if (document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        (document.activeElement as HTMLElement)?.isContentEditable) {
      ;(document.activeElement as HTMLElement).blur()
    }

    // 变换操作中：左键确认结束，右键取消并回滚
    if (isTransforming.value) {
      if (e.button === 0) {
        endTransform()
        e.preventDefault()
        return
      }
      if (e.button === 2) {
        cancelTransform()
        e.preventDefault()
        return
      }
    }

    // 中键优先：中键按下即标记拖拽
    if (e.button === 1 && rootContainer) {
      isMiddleDown = true
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      e.preventDefault()
      return
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    // 中键拖拽 Root
    if (!isTransforming.value && isMiddleDown && rootContainer) {
      const dx = (e.clientX - lastMouseX) * DRAG_SENSITIVITY
      const dy = (e.clientY - lastMouseY) * DRAG_SENSITIVITY
      rootContainer.x += dx
      rootContainer.y += dy
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      return
    }
    // Blender 风格变换操作中：鼠标移动实时应用
    if (isTransforming.value) {
      const target = getTransformTarget()
      if (target && rootContainer) {
        // 首次移动时记录起点 / 起点距离 / 起点方向
        if (!baseInitialized) {
          tStartMouseX = e.clientX
          tStartMouseY = e.clientY
          // target 在屏幕坐标系下的锚点（canvas 中心 + target 偏移 × rootContainer scale）
          startScreenMP = pixiToClientCoords(target, { x: 0, y: 0 }, app!)

          if (transformMode.value === 's') {
            const p = toScreen(e.clientX, e.clientY)
            const dx = p.x - startScreenMP.x
            const dy = p.y - startScreenMP.y
            startDist = Math.sqrt(dx * dx + dy * dy)
          } else if (transformMode.value === 'r') {
            const p = toScreen(e.clientX, e.clientY)
            const dx = p.x - startScreenMP.x
            const dy = p.y - startScreenMP.y
            const len = Math.sqrt(dx * dx + dy * dy) || 1
            startDirX = dx / len
            startDirY = dy / len
          }
          baseInitialized = true
        }

        const scale = rootContainer.scale.x

        if (transformMode.value === 'g') {
          // g：相对起点的位移差值
          const dx = (e.clientX - tStartMouseX) / scale
          const dy = (e.clientY - tStartMouseY) / scale
          if (axisLock.value === 'x') {
            target.x = startX + dx
          } else if (axisLock.value === 'y') {
            target.y = startY + dy
          } else {
            target.x = startX + dx
            target.y = startY + dy
          }
        } else if (transformMode.value === 's') {
          // s：鼠标到模型距离 / 起点距离 = 缩放倍数
          const p = toScreen(e.clientX, e.clientY)
          const dx = p.x - startScreenMP.x
          const dy = p.y - startScreenMP.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const factor = dist > 0 ? dist / startDist : 1
          if (axisLock.value === 'x') {
            target.scale.x = startScaleX * factor
          } else if (axisLock.value === 'y') {
            target.scale.y = startScaleY * factor
          } else {
            target.scale.x = startScaleX * factor
            target.scale.y = startScaleY * factor
          }
        } else if (transformMode.value === 'r') {
          // r：当前鼠标→模型向量与起点向量之间的角度差
          const p = toScreen(e.clientX, e.clientY)
          const dx = p.x - startScreenMP.x
          const dy = p.y - startScreenMP.y
          const len = Math.sqrt(dx * dx + dy * dy) || 1
          const curDirX = dx / len
          const curDirY = dy / len
          const cosA = startDirX * curDirX + startDirY * curDirY
          const sinA = startDirX * curDirY - startDirY * curDirX
          const deltaAngle = Math.atan2(sinA, cosA)
          target.rotation = startRotation + deltaAngle

          // 计算 startDir 和 curDir 的角度（以弧度为单位，转为角度）
          const startAngle = Math.atan2(startDirY, startDirX) * 180 / Math.PI
          const curAngle = Math.atan2(curDirY, curDirX) * 180 / Math.PI
          console.log('mp:', startScreenMP)
          console.log('p:', p)
          console.log('startDir:', startDirX, startDirY, 'angle:', startAngle)
          console.log('curDir:', curDirX, curDirY, 'angle:', curAngle)
          console.log('deltaAngle:', deltaAngle)
     
        }
        emitter.emit(StageEvents.TransformChange, store.selectedId)
        refreshTransformHint()
      }
      return
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    // pointerup 一定触发（任意按钮），统一清空中键状态
    isMiddleDown = false
  }

  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  // 滚轮缩放 Root
  const onWheel = (e: WheelEvent) => {
    if (!rootContainer) return
    e.preventDefault()
    const delta = -e.deltaY * ZOOM_SENSITIVITY
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rootContainer.scale.x + delta))
    rootContainer.scale.set(newScale)
  }

  canvas.addEventListener('wheel', onWheel, { passive: false })

  // 检测输入框焦点
  const isInputFocused = () => {
    const active = document.activeElement
    if (!active) return false
    const tag = active.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'F1') {
      e.preventDefault()
      // 若当前选中了模型，把对应 wmdl 文件路径透传给编辑器进程，启动后自动加载
      const wmdlPath = store.selectedModel?.wmdlConfig?.wmdlFilePath ?? ''
      OpenEditor(wmdlPath).catch((err) => console.error('OpenEditor failed:', err))
      return
    }

    // 输入框焦点时不响应变换快捷键
    if (isInputFocused()) return

    // g / s / r 进入变换模式
    if (e.key === 'g' || e.key === 's' || e.key === 'r') {
      if (!store.selectedId) return
      if (transformMode.value === e.key) {
        // 按同键：取消并回滚
        cancelTransform()
      } else if (transformMode.value === 'none') {
        startTransform(e.key as TransformMode)
      } else {
        // 切换模式：先回滚当前模式的所有修改，再以回滚后的状态为新起点
        cancelTransform()
        startTransform(e.key as TransformMode)
      }
      e.preventDefault()
      return
    }

    // 变换中：x / y 锁定轴，并把未锁轴回滚到起点
    if (isTransforming.value && (e.key === 'x' || e.key === 'y')) {
      const target = getTransformTarget()
      if (target) {
        if (axisLock.value === e.key) {
          axisLock.value = 'none'
        } else {
          axisLock.value = e.key as AxisLock
        }
        if (transformMode.value === 'g') {
          if (axisLock.value === 'x') target.y = startY
          else if (axisLock.value === 'y') target.x = startX
          else {
            target.x = startX
            target.y = startY
          }
        } else if (transformMode.value === 's') {
          if (axisLock.value === 'x') target.scale.y = startScaleY
          else if (axisLock.value === 'y') target.scale.x = startScaleX
          else {
            target.scale.x = startScaleX
            target.scale.y = startScaleY
          }
        }
      }
      e.preventDefault()
      return
    }

    // Escape 取消；Enter / 空格 确认
    if (isTransforming.value) {
      if (e.key === 'Escape') {
        cancelTransform()
        e.preventDefault()
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        endTransform()
        e.preventDefault()
        return
      }
    }
  }

  window.addEventListener('keydown', onKeyDown)

  // Save for cleanup
  previewRuntime.cleanup = () => {
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKeyDown)
  }
}

function setCursor(c: string) {
  if (containerRef.value) {
    containerRef.value.style.cursor = c
  }
}

function fitBackground() {
  if (!backgroundSprite || !backgroundContainer) return
  const w = STAGE_WIDTH
  const h = STAGE_HEIGHT
  const texture = backgroundSprite.texture.baseTexture

  // 原始图片尺寸
  const imgW = texture.width
  const imgH = texture.height

  // 计算等比缩放，保证填满 backgroundContainer，短边刚好顶到边缘
  const scale = Math.max(w / imgW, h / imgH)

  backgroundSprite.width = imgW * scale
  backgroundSprite.height = imgH * scale

  // 居中
  backgroundSprite.x = w / 2
  backgroundSprite.y = h / 2
}

function applyBackgroundTexture(texture: PIXI.Texture) {
  if (!backgroundContainer) return
  if (backgroundSprite) {
    backgroundContainer.removeChild(backgroundSprite)
    backgroundSprite.destroy({ texture: true, baseTexture: true })
    backgroundSprite = null
  }
  const sprite = new PIXI.Sprite(texture)
  sprite.anchor.set(0.5)
  backgroundContainer.addChildAt(sprite, 0)
  backgroundSprite = sprite
  fitBackground()
}

async function loadBackground(url: string) {
  if (!app || !backgroundContainer) return

  try {
    const texture = await new Promise<PIXI.Texture>((resolve, reject) => {
      const loader = new PIXI.Loader()
      loader.add('background', toFileUrl(url), {
        loadType: LoaderResource.LOAD_TYPE.IMAGE,
      })
      loader.onError.add((_, __, err) => {
        console.error('PIXI Loader error:', err)
        reject(err)
      })
      loader.load((_, resources) => {
        if (resources.background?.texture) {
          resolve(resources.background.texture)
        } else {
          const err = resources.background?.error || new Error('Failed to load background image')
          console.error('Resource error:', err)
          reject(err)
        }
      })
    })
    applyBackgroundTexture(texture)
  } catch (err) {
    console.error('Failed to load background image:', err)
  }
}

async function loadDefaultBackground() {
  if (!app || !backgroundContainer) return
  try {
    const texture = await new Promise<PIXI.Texture>((resolve, reject) => {
      const resolved = PIXI.Texture.from(defaultBackgroundUrl)
      if (resolved.baseTexture.valid) {
        resolve(resolved)
        return
      }
      resolved.baseTexture.once('loaded', () => resolve(resolved))
      resolved.baseTexture.once('error', (err) => reject(err))
    })
    applyBackgroundTexture(texture)
  } catch (err) {
    console.error('Failed to load default background:', err)
  }
}

watch(
  () => store.backgroundUrl,
  async (url) => {
    if (!backgroundContainer) return
    if (url) {
      await loadBackground(url)
    } else if (backgroundSprite) {
      backgroundContainer.removeChild(backgroundSprite)
      backgroundSprite.destroy({ texture: true, baseTexture: true })
      backgroundSprite = null
    }
  },
  { immediate: true }
)

function dispose() {
  resizeObserver?.disconnect()
  resizeObserver = null

  if (backgroundSprite) {
    backgroundSprite.destroy({ texture: true, baseTexture: true })
    backgroundSprite = null
  }

  for (const id of [...containersById.keys()]) {
    removeOne(id)
  }

  if (app) {
    if (typeof previewRuntime.cleanup === 'function') previewRuntime.cleanup()
    try {
      app.destroy(true, { children: true, texture: true, baseTexture: true })
    } catch (e) {
      console.warn('Pixi destroy error:', e)
    }
    app = null
  }

  rootContainer = null
  stageMain = null
  backgroundContainer = null
  figureContainer = null
  if (frameContainer) {
    frameContainer.destroy({ children: true })
    frameContainer = null
  }
  isMiddleDown = false

  previewRuntime.specialContainers.clear()
  previewRuntime.wmdlSubModels.clear()
  previewRuntime.app = null
  previewRuntime.cleanup = () => {}
}
</script>

<template>
  <section class="stage" @contextmenu.prevent>
    <div ref="containerRef" class="stage__canvas" />
    <!-- 变换操作遮罩 -->
    <div
      v-if="isTransforming"
      class="stage__overlay"
    />
    <!-- 变换操作提示（替换原有 hints） -->
    <div v-if="isTransforming" class="stage__transform-hint">
      <div class="transform-hint__title">正在{{ transformHint.modeName }}</div>
      <div class="transform-hint__line">鼠标移动控制{{ transformHint.modeName }}，左键确定，右键取消</div>
      <div class="transform-hint__line">按 X / Y 锁定对应轴（未锁轴会回滚到起点）</div>
      <div class="transform-hint__line" v-if="transformMode !== 'r'">当前锁定轴：{{ transformHint.axis }}</div>
      <div class="transform-hint__line">当前 X={{ transformHint.x }}，Y={{ transformHint.y }}</div>
      <div class="transform-hint__line" v-if="transformMode !== 'g'">缩放 X={{ transformHint.scaleX }}，Y={{ transformHint.scaleY }}</div>
      <div class="transform-hint__line" v-if="transformMode !== 'g'">旋转 {{ transformHint.rotationDeg }}°</div>
    </div>
    <!-- <p v-if="!store.models.length && !backgroundSprite" class="stage__hint">
      点击左上角 “加载模型” 按钮选择 Live2D 模型文件 (.model.json 或 .model3.json)
    </p> -->
    <div v-if="!isTransforming" class="stage__hints" :class="{ 'is-collapsed': !hintsExpanded }">
      <button
        type="button"
        class="stage__hints-toggle"
        :aria-expanded="hintsExpanded"
        :aria-label="hintsExpanded ? '收起操作提示' : '展开操作提示'"
        @click="toggleHints"
      >
        <span class="stage__hints-toggle-text">{{ hints.title }}</span>
        <span class="stage__hints-toggle-icon" aria-hidden="true">{{ hintsExpanded ? '▾' : '▸' }}</span>
      </button>
      <div v-show="hintsExpanded" class="stage__hints-body">
        <section v-if="hints.mouse.length" class="stage__hints-group">
          <h4 class="stage__hints-heading">鼠标</h4>
          <ul class="stage__hints-list">
            <li v-for="item in hints.mouse" :key="`m-${item.keys}`">
              <span class="stage__hints-keys">{{ item.keys }}</span>
              <span class="stage__hints-desc">{{ item.description }}</span>
            </li>
          </ul>
        </section>
        <section v-if="hints.shortcuts.length" class="stage__hints-group">
          <h4 class="stage__hints-heading">快捷键</h4>
          <ul class="stage__hints-list">
            <li v-for="item in hints.shortcuts" :key="`s-${item.keys}`">
              <span class="stage__hints-keys">{{ item.keys }}</span>
              <span class="stage__hints-desc">{{ item.description }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stage {
  position: relative;
  height: 100%;
  background: #181a20;
  overflow: hidden;
}

.stage__canvas {
  position: absolute;
  inset: 0;
}

.stage__canvas :deep(canvas) {
  display: block;
}

.stage__overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 5;
  cursor: crosshair;
}

.stage__transform-hint {
  position: absolute;
  left: 16px;
  bottom: 16px;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  line-height: 1.6;
  z-index: 10;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  user-select: none;
}

.transform-hint__title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #ffe082;
}

.transform-hint__line + .transform-hint__line {
  margin-top: 2px;
}

.stage__hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: #6b7280;
  font-size: 14px;
  pointer-events: none;
  text-align: center;
  padding: 24px;
}

.stage__hints {
  position: absolute;
  left: 16px;
  bottom: 16px;
  max-width: calc(100% - 32px);
  z-index: 10;
  font-size: 12px;
  line-height: 1.5;
  color: #fff;
  pointer-events: none; /* 正文不拦截舞台操作，仅折叠按钮可点击 */
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000,
    0 0 2px rgba(0, 0, 0, 0.85);
  user-select: none;
}

.stage__hints-toggle {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-shadow: inherit;
}

.stage__hints-toggle:hover {
  background: rgba(0, 0, 0, 0.55);
}

.stage__hints-toggle-text {
  font-weight: 600;
}

.stage__hints-toggle-icon {
  font-size: 12px;
}

.stage__hints-body {
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  width: max-content;
  max-width: calc(100vw - 32px);
}

.stage__hints-group + .stage__hints-group {
  margin-top: 6px;
}

.stage__hints-heading {
  margin: 0 0 4px 0;
  font-size: 11px;
  font-weight: 600;
  color: #ffe082;
  letter-spacing: 0.5px;
}

.stage__hints-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.stage__hints-list li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  white-space: nowrap;
}

.stage__hints-keys {
  flex: 0 0 auto;
  min-width: 96px;
  font-weight: 600;
  color: #b3e5fc;
}

.stage__hints-desc {
  flex: 1 1 auto;
}

.stage__hints.is-collapsed .stage__hints-toggle {
  background: rgba(0, 0, 0, 0.55);
}
</style>
