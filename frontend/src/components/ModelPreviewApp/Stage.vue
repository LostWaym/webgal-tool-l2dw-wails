<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { LoaderResource } from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { useModelStore } from '../../stores/previewStore'
import type { FigureGroupEntry } from '../../stores/previewStore'
import { toFileUrl } from '../../path_utils'
import { L2dwContainer } from '../../live2d/L2dwContainer'
import { SpecialId } from '../../live2d/specialIds'
import { OpenEditor } from '../../../wailsjs/go/main/App'
import type { WmdlModelItem } from '../../stores/wmdlTypes'
import { getShortcutHints, resolveShortcutTargetType, runShortcutEntry, type ShortcutEntry, type ShortcutHint } from '../../composables/useShortcuts'
import { isSpecialId, isFigureGroupId } from '../../live2d/specialIds'
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

function onShortcutClick(e: MouseEvent, entry: ShortcutEntry) {
  e.stopPropagation()
  runShortcutEntry(entry)
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

// 立绘组变换用的"逐目标初始状态"快照
interface GroupTargetSnap {
  container: PIXI.Container
  /** reparent 前的父容器（结束时要扔回去） */
  parent: PIXI.Container
  /** reparent 前在父容器 children 中的索引（addChildAt 还原 zIndex） */
  parentIndex: number
  /** child 在原父坐标系下的真值 local x/y/scaleX/scaleY/rotation（cancel/commit 时写回） */
  localX: number
  localY: number
  scaleX: number
  scaleY: number
  rotation: number
}
let groupTargetSnapshots: GroupTargetSnap[] = []
// 立绘组变换开始的组中心（用于以中心为基准的旋转/缩放）
let groupStartCenterX = 0
let groupStartCenterY = 0
// 立绘组中心对应的屏幕坐标（用于 s/r 模式计算距离/方向）
let groupStartScreenMP = new PIXI.Point(0, 0)
// 立绘组变换开始时 groupContainer 的初始 scale/rotation（g 模式保持 identity）
let groupStartScaleX = 1
let groupStartScaleY = 1
let groupStartRotation = 0

function getTransformTarget(): PIXI.Container | undefined {
  const id = store.selectedId
  if (!id) return undefined
  if (isSpecialId(id)) {
    return previewRuntime.specialContainers.get(id)
  }
  return previewRuntime.modelWrappers.get(id)
}

/** 当前选中是否为立绘组 */
function isCurrentFigureGroup(): boolean {
  return !!store.selectedId && isFigureGroupId(store.selectedId)
}

/**
 * 取立绘组所有目标 wrapper（含嵌套立绘组展平）。
 * - includeBackground=true 时把背景容器也纳入
 * - 跳过未找到的 wrapper（已删除/加载失败）
 *
 * 收集到的容器在 startTransform 期间会被 reparent 到 groupContainer，
 * 并由 startTransform 保证 backgroundContainer 在组内 zIndex 最低。
 */
function getFigureGroupTargetContainers(): PIXI.Container[] {
  const id = store.selectedId
  if (!id || !isFigureGroupId(id)) return []
  const group = store.figureGroups.find((g) => g.id === id)
  if (!group) return []

  const figureIds = store.flattenFigureGroupTargets(id)
  const containers: PIXI.Container[] = []
  for (const fid of figureIds) {
    const c = previewRuntime.modelWrappers.get(fid)
    if (c) containers.push(c)
  }

  // includeBackground 时把背景容器也加进去（Bug 2 修复）
  if (group.includeBackground && backgroundContainer) {
    containers.push(backgroundContainer)
  }

  return containers
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
  const id = store.selectedId
  if (id && isFigureGroupId(id)) {
    // 立绘组：显示组中心
    const group = store.figureGroups.find((g) => g.id === id)
    if (group) {
      transformHint.x = group.x.toFixed(1)
      transformHint.y = group.y.toFixed(1)
    }
    transformHint.modeName =
      transformMode.value === 'g' ? '拖拽'
      : transformMode.value === 's' ? '缩放'
      : '旋转'
    transformHint.axis = axisLock.value === 'none' ? '无' : axisLock.value + ' 轴'
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
  transformMode.value = mode
  axisLock.value = 'none'
  baseInitialized = false

  const id = store.selectedId

  if (id && isFigureGroupId(id)) {
    // 立绘组：先清理无效目标
    store.cleanupInvalidFigureGroupTargets(id)

    const group = store.figureGroups.find((g) => g.id === id)
    if (!group) return

    // editAnchorOnly 时只改锚点本身：跳过 reparent + snapshot，让 endTransform 走 "仅 reset groupContainer" 分支
    const lockTarget = group.editAnchorOnly === true

    const containers = lockTarget ? [] : getFigureGroupTargetContainers()
    const groupContainer = ensureGroupContainer(group)

    // 先让所有 worldTransform 是新的（保证原父变换是最新的）
    stageMain?.updateTransform()

    if (!lockTarget) {
      // 缓存每个目标"reparent 前的父 / index / 本地 rts"
      // 关键：PIXI.addChild 不会处理 child 的本地坐标，reparent 后 c.position
      // 仍按原父坐标系解释，所以视觉位置 = groupContainer.localToWorld(c.position)。
      // groupContainer 此刻带 rts（identity，但 world position != 0），c.worldPos 不等于 c.position。
      // 因此 reparent 前必须把 c.position 转成"在 groupContainer 局部下、抵消 groupContainer 当前 rts"的坐标，
      // 这样 addChild 后视觉位置才保持不变。
      groupTargetSnapshots = containers.map((c) => {
        const parent = c.parent
        const parentIndex = parent ? parent.getChildIndex(c) : 0

        // 用 c.position 读真实 local（绕开 L2dwContainer.x getter 的 base 偏移）
        const oldX = c.position.x
        const oldY = c.position.y

        // 把 c.position 转成"抵消 groupContainer 当前世界变换"的新局部坐标
        // 用 position 而非 x/y，绕开 L2dwContainer 的 base 偏移重写
        c.position.x = oldX - groupContainer.position.x
        c.position.y = oldY - groupContainer.position.y

        const snap: GroupTargetSnap = {
          container: c,
          parent: parent!,
          parentIndex,
          localX: oldX,
          localY: oldY,
          scaleX: c.scale.x,
          scaleY: c.scale.y,
          rotation: c.rotation,
        }

        groupContainer.addChild(c)
        return snap
      })

      groupTargetSnapshots.sort((a, b) => a.parentIndex - b.parentIndex)

      // 组内排序：backgroundContainer 排最底，立绘 wrapper 按当前顺序递增，
      // crosshair（PIXI.Graphics）排最顶层。
      // 即便 groupContainer 整体被 bringGroupContainerToTop 提到最高，
      // 组内仍保持"背景在下、立绘在中、准心在上"的关系。
      let z = 0
      for (const c of groupContainer.children) {
        if (c === backgroundContainer) {
          c.zIndex = 0
        } else if (c instanceof PIXI.Graphics) {
          // crosshair：排最顶层，避免被立绘盖住
          c.zIndex = Number.MAX_SAFE_INTEGER
        } else {
          c.zIndex = ++z
        }
      }
      groupContainer.sortChildren()
    }

    // 组容器 reset：scale=1/rotation=0，x/y 同步为 group.x/y - 中心
    resetGroupContainer(id)
    // 把组容器推到 zIndex 最高，避免被其他立绘覆盖
    bringGroupContainerToTop(id)

    // 记录 g 模式起点（轴锁定重置时使用）
    groupStartCenterX = group.x
    groupStartCenterY = group.y
    // s/r 模式的起点：scale=1/rotation=0
    groupStartScaleX = 1
    groupStartScaleY = 1
    groupStartRotation = 0

    // 把"舞台中心"从 stageMain 局部坐标转到屏幕坐标（s/r 模式算距离/方向以此为中心）
    if (app && stageMain) {
      groupStartScreenMP = pixiToClientCoords(
        stageMain,
        { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 },
        app,
      )
    }

    emitter.emit(StageEvents.TransformStart, true)
    emitter.emit(StageEvents.TransformChange, store.selectedId)
    refreshTransformHint()
    updateFigureGroupCrosshair()

    groupStartScreenMP = pixiToClientCoords(
      groupContainer,
      { x: 0, y: 0 },
      app!,
    )
    return
  }

  const target = getTransformTarget()
  if (!target) return

  // 缓存模型的初始状态
  startX = target.x
  startY = target.y
  startScaleX = target.scale.x
  startScaleY = target.scale.y
  startRotation = target.rotation
  startScreenMP = pixiToClientCoords(target, { x: 0, y: 0 }, app!)

  emitter.emit(StageEvents.TransformStart, true)
  emitter.emit(StageEvents.TransformChange, store.selectedId)
  refreshTransformHint()
}

function cancelTransform() {
  const id = store.selectedId
  if (id && isFigureGroupId(id)) {
    // 立绘组：还原每个目标到原父原 local rts
    for (const snap of groupTargetSnapshots) {
      snap.parent.addChildAt(snap.container, snap.parentIndex)
      snap.container.position.set(snap.localX, snap.localY)
      snap.container.scale.set(snap.scaleX, snap.scaleY)
      snap.container.rotation = snap.rotation
    }
    // g 模式：把 store.group.x/y 还原到 start 前的值
    if (transformMode.value === 'g') {
      store.updateFigureGroup(id, { x: groupStartCenterX, y: groupStartCenterY })
    }
    // 重置 groupContainer（identity + 当前 store.group.x/y 作为 base）
    resetGroupContainer(id)
    groupTargetSnapshots = []
    endTransform()
    return
  }

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
  const id = store.selectedId
  if (id && isFigureGroupId(id)) {

    if (groupTargetSnapshots.length > 0)
    {
      // 立绘组结束变换（commit）：把 groupContainer 当前 rts"正向叠加"到每个 child 上，
      // 然后把 child 扔回原父。因为原父是 stageMain（identity），child 在 groupContainer 局部下的
      // 新 rts 直接就是它在 stageMain 局部下的最终 rts，视觉与变换结束时一致。
      //
      // 注意：要用 position 而非 x/y 操作位置，绕开 L2dwContainer 的 base 偏移重写。
      const groupContainer = groupContainers.get(id)

      stageMain?.updateTransform()
      for (const snap of groupTargetSnapshots) {
        if (groupContainer) {
          snap.container.scale.x *= groupContainer.scale.x
          snap.container.scale.y *= groupContainer.scale.y
          snap.container.rotation += groupContainer.rotation
          // 位置：用 toGlobal 读真世界位置（自动应用 groupContainer 的 s/r/p），
          // 再 toLocal 转回 snap.parent（原父）局部，保证 addChildAt 后视觉位置不变。
          const worldPos = groupContainer.toGlobal(snap.container.position)
          snap.container.position.copyFrom(snap.parent.toLocal(worldPos))
        }
        snap.parent.addChildAt(snap.container, snap.parentIndex)
      }

      void sortFigures()
    }

    // 重置 groupContainer（identity + 当前 store.group.x/y 作为 base）
    resetGroupContainer(id)
  }

  transformMode.value = 'none'
  axisLock.value = 'none'
  baseInitialized = false
  groupTargetSnapshots = []
  emitter.emit(StageEvents.TransformStart, false)
  emitter.emit(StageEvents.TransformChange, store.selectedId)
  refreshTransformHint()
  updateFigureGroupCrosshair()
}

interface MouseHint { keys: string; description: string }
interface HintsView {
  title: string
  mouse: MouseHint[]
  shortcuts: ShortcutHint[]
}

const TARGET_LABELS: Record<ReturnType<typeof resolveShortcutTargetType>, string> = {
  background: '背景',
  stage: '主场景',
  model: '立绘',
  figureGroup: '立绘组',
  none: '未选中',
}

// 通用操作：所有选中状态都会显示
const COMMON_MOUSE_HINTS: MouseHint[] = [
  { keys: '中键拖动', description: '平移舞台视图' },
  { keys: '鼠标滚轮', description: '缩放舞台视图' },
]
// F1 是真快捷键（舞台上独立监听），点击触发等价行为
const COMMON_SHORTCUT_HINTS: ShortcutHint[] = [
  {
    keys: 'F1',
    description: '打开模型编辑器窗口',
    entry: {
      key: 'F1',
      keys: 'F1',
      description: '打开模型编辑器窗口',
      targets: ['model', 'background', 'stage', 'figureGroup', 'none'],
      handlerKey: 'openEditor',
      run: () => {
        const wmdlPath = store.selectedModel?.wmdlConfig?.wmdlFilePath ?? ''
        OpenEditor(wmdlPath).catch((err) => console.error('OpenEditor failed:', err))
      },
    },
  },
]

// 各类型专属的鼠标提示
const MOUSE_HINTS_BY_TYPE: Record<ReturnType<typeof resolveShortcutTargetType>, MouseHint[]> = {
  background: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转'}],
  stage: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转'}],
  model: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转'}],
  figureGroup: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转（按组中心）'}],
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
const ZOOM_FACTOR = 1.08        // 滚轮缩放因子（每次滚动乘/除 ~8%）
const MIN_SCALE = 0.1           // 最小缩放
const MAX_SCALE = 10            // 最大缩放

let rootContainer: PIXI.Container | null = null
let stageMain: PIXI.Container | null = null
let backgroundContainer: L2dwContainer | null = null
let figureContainer: PIXI.Container | null = null
let frameContainer: PIXI.Container | null = null
/** groupId -> 该立绘组专属 L2dwContainer（始终挂在 stageMain 下） */
const groupContainers = new Map<string, L2dwContainer>()

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
  previewRuntime.previewStore = useModelStore()

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

  // 为已存在的立绘组创建对应的 groupContainer（若 init 前 watcher 已创建 orphan，需挂上）
  for (const g of store.figureGroups) {
    const existing = groupContainers.get(g.id)
    if (!existing) {
      const c = new L2dwContainer()
      c.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
      c.x = g.x
      c.y = g.y
      c.scale.set(1, 1)
      c.rotation = 0
      stageMain.addChild(c)
      groupContainers.set(g.id, c)
    } else if (!existing.parent) {
      // init 前 watcher 创建的 orphan，挂到 stageMain
      stageMain.addChild(existing)
    }
  }

  void loadDefaultBackground()
}

/**
 * 取（或懒创建）立绘组专属 L2dwContainer。
 * 始终挂在 stageMain 下，与 figureContainer/backgroundContainer 同级，zIndex 最高。
 * base 位置 = 舞台中心 (STAGE_WIDTH/2, STAGE_HEIGHT/2)；groupContainer.x/y 存的就是组的世界坐标，
 * 这样 s/r 模式天然围绕舞台中心，g 模式改 x/y 即可。
 */
function ensureGroupContainer(group: FigureGroupEntry): L2dwContainer {
  const existing = groupContainers.get(group.id)
  if (existing) return existing
  const c = new L2dwContainer()
  c.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  c.x = group.x
  c.y = group.y
  c.scale.set(1, 1)
  c.rotation = 0

  // 准心作为 groupContainer 的子节点，始终在原点（随容器同步变换）
  const crosshair = buildFigureGroupCrosshair()
  crosshair.visible = false
  c.addChild(crosshair)

  if (!stageMain) {
    // init 尚未完成；直接存一个孤儿容器，等 init 完再挂上
    groupContainers.set(group.id, c)
    return c
  }
  stageMain.addChild(c)
  groupContainers.set(group.id, c)
  return c
}

/** 把 groupContainer 的本地 rts 重置为 identity（rotation=0, scale=1）并把 x/y 同步到 group.x/y */
function resetGroupContainer(groupId: string): void {
  const c = groupContainers.get(groupId)
  if (!c) return
  c.scale.set(1, 1)
  c.rotation = 0
  const g = store.figureGroups.find((x) => x.id === groupId)
  if (g) {
    c.x = g.x
    c.y = g.y
  } else {
    c.x = 0
    c.y = 0
  }
}

/** 把 groupContainer 移到 stageMain 中 zIndex 最高位置 */
function bringGroupContainerToTop(groupId: string): void {
  if (!stageMain) return
  const c = groupContainers.get(groupId)
  if (!c) return
  c.zIndex = 9999
  stageMain.sortChildren()
}

/** 销毁 groupContainer（store 删除组时调用） */
function destroyGroupContainer(groupId: string): void {
  const c = groupContainers.get(groupId)
  if (!c) return
  c.destroy({ children: true })
  groupContainers.delete(groupId)
}

/**
 * 构建立绘组准心 graphics：CS1.6 风十字准心（淡黄主线 + 黑描边，中间空心）
 * @param mainWidth 主线线宽
 * @param extraWidth 描边比主线粗多少（描边线宽 = mainWidth + extraWidth）
 */
function buildFigureGroupCrosshair(
  mainWidth = 8,
  extraWidth = 8,
): PIXI.Graphics {
  const g = new PIXI.Graphics()
  const COLOR = 0xFFFF66   // 淡黄主线
  const OUTLINE = 0x000000 // 黑描边
  const W = 32              // 半长
  const GAP = 16             // 中间空隙
  const outlineWidth = mainWidth + extraWidth

  // 黑描边：与主线同样的四段，先画粗底
  g.lineStyle(outlineWidth, OUTLINE)
  g.moveTo(-W-4, 0); g.lineTo(-GAP+4, 0)
  g.moveTo(GAP-4, 0); g.lineTo(W+4, 0)
  g.moveTo(0, -W-4); g.lineTo(0, -GAP+4)
  g.moveTo(0, GAP-4); g.lineTo(0, W+4)

  // 淡黄主线：叠在描边中央
  g.lineStyle(mainWidth, COLOR)
  g.moveTo(-W, 0); g.lineTo(-GAP, 0)
  g.moveTo(GAP, 0); g.lineTo(W, 0)
  g.moveTo(0, -W); g.lineTo(0, -GAP)
  g.moveTo(0, GAP); g.lineTo(0, W)

  return g
}

/** 同步准心：选中立绘组时显示其 groupContainer 上的准心；g/s/r 过程中准心跟随组同步变换 */
function updateFigureGroupCrosshair() {
  // 先全部隐藏
  for (const c of groupContainers.values()) {
    const ch = c.children.find((ch) => ch instanceof PIXI.Graphics) as PIXI.Graphics | undefined
    if (ch) ch.visible = false
  }
  const id = store.selectedId
  if (id && isFigureGroupId(id)) {
    const c = groupContainers.get(id)
    if (c) {
      const ch = c.children.find((ch) => ch instanceof PIXI.Graphics) as PIXI.Graphics | undefined
      if (ch) ch.visible = true
    }
  }
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

function sortFigures() {
  if (!figureContainer) return;
  let index = 0
  containersById.forEach((wrapper, id) => {
    wrapper.zIndex = index
    index++
  })
  figureContainer.sortChildren()
}

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
    updateFigureGroupCrosshair()
  },
  { immediate: true },
)

// 监听选中立绘组的 x/y 变化（用户在面板编辑锚点时实时更新准心）
watch(
  () => {
    const id = store.selectedId
    if (!id || !isFigureGroupId(id)) return null
    const g = store.figureGroups.find((x) => x.id === id)
    return g ? { x: g.x, y: g.y } : null
  },
  () => updateFigureGroupCrosshair(),
  { immediate: true, deep: true },
)

// 监听立绘组增删（同步 groupContainer 池）
watch(
  () => store.figureGroups.map((g) => g.id),
  (newIds) => {
    const newSet = new Set(newIds)
    for (const id of newIds) {
      const g = store.figureGroups.find((x) => x.id === id)
      if (!g) continue
      const existing = groupContainers.get(id)
      if (!existing) {
        ensureGroupContainer(g)
      } else {
        existing.x = g.x
        existing.y = g.y
      }
    }
    for (const id of [...groupContainers.keys()]) {
      if (!newSet.has(id)) destroyGroupContainer(id)
    }
  },
  { immediate: true },
)

// 监听所有立绘组 x/y 变化（同步 groupContainer 的 x/y；base 始终为舞台中心）
watch(
  () => store.figureGroups.map((g) => ({ id: g.id, x: g.x, y: g.y })),
  (entries) => {
    for (const { id, x, y } of entries) {
      const c = groupContainers.get(id)
      if (!c) continue
      c.x = x
      c.y = y
    }
  },
  { deep: true, immediate: true },
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
      if (!rootContainer) return

      // 立绘组：按"组中心为基准"应用 GRS 到所有目标
      if (isCurrentFigureGroup()) {
        handleFigureGroupPointerMove(e)
        emitter.emit(StageEvents.TransformChange, store.selectedId)
        refreshTransformHint()
        return
      }

      const target = getTransformTarget()
      if (target) {
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
        }
        emitter.emit(StageEvents.TransformChange, store.selectedId)
        refreshTransformHint()
      }
      return
    }
  }

  /**
   * 立绘组模式下的鼠标移动处理：只改 groupContainer 的 rts，所有目标自动跟随。
   *
   * - g：groupContainer.x/y += dx；同步更新 store.group.x/y 和 base
   * - s：groupContainer.scale *= factor（围绕 base 锚点放大）
   * - r：groupContainer.rotation += deltaAngle（围绕 base 锚点旋转）
   */
  function handleFigureGroupPointerMove(e: PointerEvent) {
    if (!rootContainer) return

    const id = store.selectedId
    if (!id || !isFigureGroupId(id)) return
    const groupContainer = groupContainers.get(id)
    if (!groupContainer) return

    // 首次移动时记录 s/r 模式用的"起点距离 / 方向"
    if (!baseInitialized) {
      tStartMouseX = e.clientX
      tStartMouseY = e.clientY
      if (transformMode.value === 's') {
        const p = toScreen(e.clientX, e.clientY)
        const dx = p.x - groupStartScreenMP.x
        const dy = p.y - groupStartScreenMP.y
        startDist = Math.sqrt(dx * dx + dy * dy) || 1
      } else if (transformMode.value === 'r') {
        const p = toScreen(e.clientX, e.clientY)
        const dx = p.x - groupStartScreenMP.x
        const dy = p.y - groupStartScreenMP.y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        startDirX = dx / len
        startDirY = dy / len
      }
      baseInitialized = true
    }

    const scale = rootContainer.scale.x

    if (transformMode.value === 'g') {
      const dx = (e.clientX - tStartMouseX) / scale
      const dy = (e.clientY - tStartMouseY) / scale
      // g 模式：把 dx/dy 加到 groupContainer.x/y + 同步 store.group.x/y
      // base 始终固定为舞台中心，s/r 基准不受影响
      const g = store.figureGroups.find((gg) => gg.id === id)
      if (!g) return
      if (axisLock.value === 'x') {
        groupContainer.x = groupStartCenterX + dx
        store.updateFigureGroup(id, { x: groupContainer.x, y: groupStartCenterY })
      } else if (axisLock.value === 'y') {
        groupContainer.y = groupStartCenterY + dy
        store.updateFigureGroup(id, { x: groupStartCenterX, y: groupContainer.y })
      } else {
        groupContainer.x = groupStartCenterX + dx
        groupContainer.y = groupStartCenterY + dy
        store.updateFigureGroup(id, { x: groupContainer.x, y: groupContainer.y })
      }
      return
    }

    if (transformMode.value === 's') {
      const p = toScreen(e.clientX, e.clientY)
      const dx = p.x - groupStartScreenMP.x
      const dy = p.y - groupStartScreenMP.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const factor = dist > 0 ? dist / startDist : 1
      if (axisLock.value === 'x') {
        groupContainer.scale.x = groupStartScaleX * factor
      } else if (axisLock.value === 'y') {
        groupContainer.scale.y = groupStartScaleY * factor
      } else {
        groupContainer.scale.x = groupStartScaleX * factor
        groupContainer.scale.y = groupStartScaleY * factor
      }
      return
    }

    if (transformMode.value === 'r') {
      const p = toScreen(e.clientX, e.clientY)
      const dx = p.x - groupStartScreenMP.x
      const dy = p.y - groupStartScreenMP.y
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const curDirX = dx / len
      const curDirY = dy / len
      const cosA = startDirX * curDirX + startDirY * curDirY
      const sinA = startDirX * curDirY - startDirY * curDirX
      const deltaAngle = Math.atan2(sinA, cosA)
      groupContainer.rotation = groupStartRotation + deltaAngle
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

  // 滚轮缩放 Root（乘法因子：scale 大小时手感一致）
  const onWheel = (e: WheelEvent) => {
    if (!rootContainer) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rootContainer.scale.x * factor))
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
      if (axisLock.value === e.key) {
        axisLock.value = 'none'
      } else {
        axisLock.value = e.key as AxisLock
      }
      if (isCurrentFigureGroup()) {
        // 立绘组模式：把 groupContainer 的"未锁定轴"回滚到起点
        const gid = store.selectedId
        if (gid && isFigureGroupId(gid)) {
          const gc = groupContainers.get(gid)
          if (gc) {
            // 回滚后强制让 PIXI 重新计算 child 的世界矩阵，方便后续 mouse move 继续作用
            if (transformMode.value === 'g') {
              // 把 groupContainer.x/y 重置回拖动开始时的位置
              gc.x = groupStartCenterX
              gc.y = groupStartCenterY
            } else if (transformMode.value === 's') {
              gc.scale.x = groupStartScaleX
              gc.scale.y = groupStartScaleY
            } else if (transformMode.value === 'r') {
              gc.rotation = groupStartRotation
            }
            if (stageMain) stageMain.updateTransform()
          }
        }
        e.preventDefault()
        return
      }
      const target = getTransformTarget()
      if (target) {
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
  for (const c of groupContainers.values()) {
    c.destroy({ children: true })
  }
  groupContainers.clear()
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
          <h4 class="stage__hints-heading">快捷键  - 可点击触发</h4>
          <ul class="stage__hints-list">
            <li v-for="item in hints.shortcuts" :key="item.entry.handlerKey + '-' + item.keys">
              <button
                type="button"
                class="stage__hints-item"
                :title="`点击触发 ${item.keys}`"
                @click="onShortcutClick($event, item.entry)"
              >
                <span class="stage__hints-keys">{{ item.keys }}</span>
                <span class="stage__hints-desc">{{ item.description }}</span>
              </button>
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

.stage__hints-item {
  pointer-events: auto;
  display: flex;
  gap: 8px;
  align-items: baseline;
  width: 100%;
  padding: 2px 6px;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  border-radius: 3px;
  cursor: pointer;
  text-shadow: inherit;
}

.stage__hints-item:hover,
.stage__hints-item:focus-visible {
  background: rgba(255, 255, 255, 0.12);
  outline: none;
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
