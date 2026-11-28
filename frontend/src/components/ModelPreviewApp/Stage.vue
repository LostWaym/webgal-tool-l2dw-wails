<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { LoaderResource } from 'pixi.js'
import { OutlineFilter } from 'pixi-filters'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { useModelStore } from '../../stores/previewStore'
import type { FigureGroupEntry, FocusState } from '../../stores/previewStore'
import { toFileUrl } from '../../path_utils'
import { L2dwContainer } from '../../live2d/L2dwContainer'
import { SpecialId, MIN_CAMERA_SCALE } from '../../live2d/specialIds'
import { OpenEditor, OpenActorEditor, OpenMotionEditor, GetNextArgMode, SetNextArgMode } from '../../../wailsjs/go/main/App'
import type { WmdlModelItem } from '../../stores/wmdlTypes'
import { STAGE_WIDTH, STAGE_HEIGHT, FOCUS_BOX_SIZE } from '../../utils/consts'
import { getShortcutHints, resolveShortcutTargetType, runShortcutEntry, type ShortcutEntry, type ShortcutHint, getNextMode, setNextMode, NEXT_ARG_MODE_OPTIONS, type NextArgMode } from '../../composables/useShortcuts'
import ThemeSelect from '../common/ThemeSelect.vue'
import { useMessage } from '../../composables/useMessage'
import { currentTheme, themeColor } from '../../themes/appearance'
import { isSpecialId, isFigureGroupId, getSpecialName } from '../../live2d/specialIds'
import emitter, { StageEvents } from '../../stores/emitter'
import defaultBackgroundUrl from '../../assets/backgrounds/default.jpg'
import { previewRuntime } from '../../utils/runtimeRegistry'
import { usePreviewFrameRateLimit } from '../../composables/usePreviewFrameRateLimit'
import { usePreviewFocusBoxOffset } from '../../composables/usePreviewFocusBoxOffset'
import { usePreviewRotationSnap } from '../../composables/usePreviewRotationSnap'
import { PREVIEW_GUIDE_VISIBILITY_KEYS, usePreviewGuideVisibility } from '../../composables/usePreviewGuideVisibility'
import { usePreviewGuideOverflow } from '../../composables/usePreviewGuideOverflow'
import { getDevicePixelRatio, observePixiViewport } from '../../live2d/viewport'
import { GUIDE_SNAP_PX, PREVIEW_FRAME, hitPreviewGuide, placePreviewGuide, previewGuideEnds, previewGuideKey, snapPreviewGuide, type GuideAxis, type PreviewGuide } from '../../utils/previewGuides'
import UiIcon from '../common/UiIcon.vue'
import StageRadialMenu from './StageRadialMenu.vue'
import { getStageRadialActions, radialMenuIndex, radialMenuPosition, type StageRadialActionId } from '../../utils/stageRadialMenu'
import { useFilterPresetModal } from '../../composables/useFilterPresetModal'
import { useTransformSnapshotModal } from '../../composables/useTransformSnapshotModal'
import { usePreviewModelReload } from '../../composables/usePreviewModelReload'

const store = useModelStore()
const props = defineProps<{ interactionDisabled?: boolean; guideManagerVisible?: boolean }>()
const { frameRateLimit } = usePreviewFrameRateLimit()
const { offsetY: focusBoxOffsetY } = usePreviewFocusBoxOffset()
const { interval: rotationSnap } = usePreviewRotationSnap()
const { alwaysShowGuides } = usePreviewGuideVisibility()
const { length: guideOverflow } = usePreviewGuideOverflow()

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

const nextMode = ref<NextArgMode>(getNextMode())
let nextModeChanged = false
let nextModeSave = Promise.resolve()
GetNextArgMode().then((savedMode) => {
  if (nextModeChanged) return
  const option = NEXT_ARG_MODE_OPTIONS.find((item) => item.value === savedMode)
  if (option) {
    setNextMode(option.value)
    nextMode.value = option.value
  }
}).catch((err) => {
  console.error('读取 next 后处理设置失败', err)
  useMessage().warning('读取 next 后处理设置失败，使用当前选项')
})

function onNextModeChange(value: string | number) {
  const v = value as NextArgMode
  nextModeChanged = true
  setNextMode(v)
  nextMode.value = v
  nextModeSave = nextModeSave.then(() => SetNextArgMode(v)).catch((err) => {
    console.error('保存 next 后处理设置失败', err)
    useMessage().warning('保存 next 后处理设置失败，当前选项仅在本次会话有效')
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Blender 风格变换操作（g/s/r + x/y 轴锁定）
// ─────────────────────────────────────────────────────────────────────────────
type TransformMode = 'none' | 'g' | 's' | 'r' | 'l'
type AxisLock = 'none' | GuideAxis
type GuideMode = 'none' | 'delete' | GuideAxis

const transformMode = ref<TransformMode>('none')
const axisLock = ref<AxisLock>('none')
const isTransforming = computed(() => transformMode.value !== 'none')
const guideMode = ref<GuideMode>('none')
const guideCandidate = shallowRef<PreviewGuide>()
const snappedGuides = shallowRef<readonly PreviewGuide[]>([])
const altHeldInMove = ref(false)
const isGuideMove = computed(() => transformMode.value === 'g' && !!store.selectedId)
const isMoveAltActive = computed(() => isGuideMove.value && altHeldInMove.value)
const guidesVisible = computed(() =>
  alwaysShowGuides.value || props.guideManagerVisible || guideMode.value !== 'none' || isMoveAltActive.value,
)
const guideCursor = computed(() => {
  if (guideMode.value === 'none') return
  if (guideMode.value === 'delete') return 'stage__canvas--guide-delete'
  return guideCandidate.value ? 'stage__canvas--guide-add' : 'stage__canvas--guide-blocked'
})

function setGuideMode(mode: GuideMode) {
  guideMode.value = mode
  guideCandidate.value = undefined
}

function updateSnappedGuides(guides: readonly PreviewGuide[] = []) {
  const current = snappedGuides.value
  if (guides.length !== current.length || guides.some((guide, i) => guide !== current[i])) {
    snappedGuides.value = guides
  }
}

type TargetOption = { id: string; name: string }
const targetMenu = ref<{ options: TargetOption[]; x: number; y: number } | null>(null)
const targetMenuRef = ref<HTMLElement | null>(null)
const targetMenuActive = ref(0)
const targetOutlines = new Map<string, { wrapper: L2dwContainer; filter: OutlineFilter }>()
const filterPresetModal = useFilterPresetModal()
const snapshotModal = useTransformSnapshotModal()
const modelReload = usePreviewModelReload()
const radialMenu = ref<{
  id: string
  name: string
  x: number
  y: number
  scale: number
  actions: ReturnType<typeof getStageRadialActions>
  active: number
  dx: number
  dy: number
} | null>(null)

function closeRadialMenu() {
  radialMenu.value = null
}

function openRadialMenu(event: PointerEvent) {
  closeTargetMenu()
  const id = store.selectedId
  if (!id) {
    useMessage().info('请先选中立绘或舞台对象')
    return
  }
  const actions = getStageRadialActions(id, store.selectedModel?.kind)
  if (!actions.length) {
    useMessage().info('当前对象暂无可用的轮盘操作')
    return
  }
  const position = radialMenuPosition(event.clientX, event.clientY, window.innerWidth, window.innerHeight)
  radialMenu.value = {
    id,
    name: isSpecialId(id) ? getSpecialName(id) : store.selectedModel?.name ?? store.selectedFigureGroup?.name ?? id,
    ...position,
    actions,
    active: -1,
    dx: 0,
    dy: 0,
  }
  updateRadialPointer(event)
}

function updateRadialPointer(event: PointerEvent) {
  const menu = radialMenu.value
  if (!menu) return
  menu.dx = event.clientX - menu.x
  menu.dy = event.clientY - menu.y
  menu.active = radialMenuIndex(menu.dx, menu.dy, menu.actions)
}

async function runRadialAction(action: StageRadialActionId, id: string) {
  // 弹窗消费当前选择；手势期间切换或删除目标时不对新目标执行。
  if (store.selectedId !== id || !getStageRadialActions(id, store.selectedModel?.kind).some(item => item.id === action)) return
  try {
    if (action === 'filter') filterPresetModal.open()
    else if (action === 'snapshot') {
      store.syncTransformFromModel(id)
      snapshotModal.open()
    } else if (action === 'reloadConfig') modelReload.reloadConfig(id)
    else await modelReload.reloadTextures(id)
  } catch (error) {
    useMessage().error(`轮盘操作失败：${error}`)
  }
}

watch(() => store.selectedId, closeRadialMenu, { flush: 'sync' })

function clearTargetOutline(id: string) {
  const entry = targetOutlines.get(id)
  if (!entry) return
  const filters = entry.wrapper.filters
  if (filters) entry.wrapper.filters = filters.filter(filter => filter !== entry.filter)
  entry.filter.destroy()
  targetOutlines.delete(id)
}

function syncTargetOutlines() {
  const desired = new Map<string, number>()
  const menu = targetMenu.value
  if (menu) {
    const selected = store.models.find(model => model.id === store.selectedId && model.visible)
    if (selected) desired.set(selected.id, 0xffd34d)
    const hovered = menu.options[targetMenuActive.value]
    if (hovered && hovered.id !== selected?.id && store.models.some(model => model.id === hovered.id && model.visible)) {
      desired.set(hovered.id, 0x65e68b)
    }
  }
  const radialTarget = radialMenu.value && store.models.find(model => model.id === radialMenu.value?.id && model.visible)
  if (radialTarget) desired.set(radialTarget.id, 0xffd34d)
  for (const [id, entry] of targetOutlines) {
    if (!desired.has(id) || containersById.get(id) !== entry.wrapper) clearTargetOutline(id)
  }
  for (const [id, color] of desired) {
    const wrapper = containersById.get(id)
    if (!wrapper || !wrapper.visible || wrapper.destroyed || !wrapper.children.length) continue
    const existing = targetOutlines.get(id)
    if (existing) {
      existing.filter.color = color
      continue
    }
    const filter = new OutlineFilter(3, color, 0.15)
    wrapper.filters = [...(wrapper.filters ?? []), filter]
    targetOutlines.set(id, { wrapper, filter })
  }
}

watch(
  [targetMenu, targetMenuActive, radialMenu, () => store.selectedId, () => store.models.map(model => `${model.id}:${model.visible}`)],
  syncTargetOutlines,
  { flush: 'sync' },
)

function closeTargetMenu() {
  targetMenu.value = null
}

function chooseTarget(index: number) {
  const option = targetMenu.value?.options[index]
  if (!option) return
  closeTargetMenu()
  store.select(option.id)
}

function onTargetMenuPointerMove(event: PointerEvent) {
  const option = (event.target as Element).closest<HTMLElement>('[data-target-index]')
  targetMenuActive.value = option ? Number(option.dataset.targetIndex) : -1
}

function onTargetMenuKeydown(event: KeyboardEvent) {
  const menu = targetMenu.value
  if (!menu) return
  event.stopPropagation()
  if (event.key === 'Escape') closeTargetMenu()
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    targetMenuActive.value = targetMenuActive.value < 0
      ? (event.key === 'ArrowDown' ? 0 : menu.options.length - 1)
      : (targetMenuActive.value + (event.key === 'ArrowDown' ? 1 : -1) + menu.options.length) % menu.options.length
    nextTick(() => targetMenuRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
  } else if (event.key === 'Home') targetMenuActive.value = 0
  else if (event.key === 'End') targetMenuActive.value = menu.options.length - 1
  else if (event.key === 'Enter' || event.key === ' ') chooseTarget(targetMenuActive.value)
  else if (event.key === 'Tab') closeTargetMenu()
  else return
  event.preventDefault()
}

function containsLocalBounds(object: PIXI.DisplayObject, point: PIXI.Point): boolean {
  if (!object.visible || !object.renderable || object.worldAlpha <= 0) return false
  const local = object.toLocal(point)
  return object.getLocalBounds().contains(local.x, local.y)
}

async function openTargetMenu(event: PointerEvent, canvas: HTMLCanvasElement) {
  if (!app) return
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const point = new PIXI.Point(
    (event.clientX - rect.left) * app.screen.width / rect.width,
    (event.clientY - rect.top) * app.screen.height / rect.height,
  )
  const options: TargetOption[] = [{ id: SpecialId.StageMain, name: getSpecialName(SpecialId.StageMain) }]
  if (backgroundSprite.value && backgroundContainer?.visible && containsLocalBounds(backgroundSprite.value, point)) {
    options.push({ id: SpecialId.BgContainer, name: getSpecialName(SpecialId.BgContainer) })
  }
  options.push({ id: SpecialId.Camera, name: getSpecialName(SpecialId.Camera) })
  for (const model of [...store.models].reverse()) {
    const wrapper = containersById.get(model.id)
    if (!model.visible || !wrapper?.visible || wrapper.alpha <= 0) continue
    if (wrapper.children.some(child => containsLocalBounds(child, point))) {
      options.push({ id: model.id, name: model.name })
    }
  }
  targetMenuActive.value = -1
  targetMenu.value = { options, x: event.clientX, y: event.clientY }
  await nextTick()
  const menu = targetMenuRef.value
  if (!menu || !targetMenu.value) return
  const bounds = menu.getBoundingClientRect()
  targetMenu.value.x = Math.max(4, Math.min(event.clientX, window.innerWidth - bounds.width - 4))
  targetMenu.value.y = Math.max(4, Math.min(event.clientY, window.innerHeight - bounds.height - 4))
  menu.focus()
}

watch(() => props.interactionDisabled, disabled => {
  if (!disabled) return
  if (isTransforming.value) cancelTransform()
  setGuideMode('none')
  closeTargetMenu()
  closeRadialMenu()
}, { flush: 'sync' })

// 注视模式（l）状态
let focusTargetId: string | null = null
let focusSavedState: FocusState | null = null
let focusBox: PIXI.Graphics | null = null

// 变换操作的初始值（用于右键取消时还原）
let startX = 0
let startY = 0
let startScaleX = 1
let startScaleY = 1
let startRotation = 0
let rotationDelta = 0

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

interface TransformVisual {
  mode: 'g' | 'r' | 's'
  origin: PIXI.Point
  current: PIXI.Point
  start?: PIXI.Point
  end?: PIXI.Point
  arc?: string
  arrow?: string
  axis?: string
}

const transformVisual = shallowRef<TransformVisual>()
let visualParent: PIXI.Container | undefined
let visualOrigin: PIXI.IPointData | undefined
let visualPointer: PIXI.Point | undefined

function beginTransformVisual(target: PIXI.Container) {
  if (!target.parent) return
  visualParent = target.parent
  visualOrigin = target.parent.toLocal(target.toGlobal(target.pivot))
  visualPointer = undefined
  updateTransformVisual()
}

function updateTransformVisual() {
  const mode = transformMode.value
  const target = getTransformTarget()
  const canvas = app?.view as HTMLCanvasElement | undefined
  if (!app || !canvas || !target || !visualParent || !visualOrigin ||
      (mode !== 'g' && mode !== 'r' && mode !== 's')) {
    transformVisual.value = undefined
    return
  }
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height || !app.screen.width || !app.screen.height) return
  const toCanvas = (point: PIXI.IPointData) => new PIXI.Point(
    point.x * rect.width / app!.screen.width,
    point.y * rect.height / app!.screen.height,
  )
  const origin = toCanvas(visualParent.toGlobal(visualOrigin))
  const current = toCanvas(target.toGlobal(target.pivot))
  if (![origin.x, origin.y, current.x, current.y].every(Number.isFinite)) {
    transformVisual.value = undefined
    return
  }
  const visual: TransformVisual = { mode, origin, current }
  if (mode !== 'g' && baseInitialized && visualPointer) {
    const pointer = new PIXI.Point(visualPointer.x - rect.left, visualPointer.y - rect.top)
    const dx = pointer.x - origin.x
    const dy = pointer.y - origin.y
    const distance = Math.hypot(dx, dy)
    if (mode === 's' && startDist >= 8 && distance >= 1) {
      const group = isCurrentFigureGroup()
      const startScale = axisLock.value === 'y'
        ? (group ? groupStartScaleY : startScaleY)
        : (group ? groupStartScaleX : startScaleX)
      const scale = axisLock.value === 'y' ? target.scale.y : target.scale.x
      const factor = startScale !== 0 ? Math.abs(scale / startScale) : 1
      const ux = dx / distance
      const uy = dy / distance
      visual.start = new PIXI.Point(origin.x + ux * startDist, origin.y + uy * startDist)
      visual.end = new PIXI.Point(origin.x + ux * startDist * factor, origin.y + uy * startDist * factor)
      visual.axis = axisLock.value === 'none' ? undefined : axisLock.value.toUpperCase()
    } else if (mode === 'r' && Math.hypot(startDirX, startDirY) > 0.5) {
      const radius = Math.max(36, Math.min(72, distance))
      const startAngle = Math.atan2(startDirY, startDirX)
      const initialRotation = isCurrentFigureGroup() ? groupStartRotation : startRotation
      const delta = target.rotation - initialRotation
      const matrix = visualParent.worldTransform
      const sx = rect.width / app.screen.width
      const sy = rect.height / app.screen.height
      const a = matrix.a * sx, b = matrix.b * sy, c = matrix.c * sx, d = matrix.d * sy
      const determinant = a * d - b * c
      let endAngle = startAngle + delta
      if (Math.abs(determinant) > 1e-10) {
        const x = (d * startDirX - c * startDirY) / determinant
        const y = (-b * startDirX + a * startDirY) / determinant
        const rotatedX = x * Math.cos(delta) - y * Math.sin(delta)
        const rotatedY = x * Math.sin(delta) + y * Math.cos(delta)
        endAngle = Math.atan2(b * rotatedX + d * rotatedY, a * rotatedX + c * rotatedY)
      }
      const screenDelta = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle))
      visual.start = new PIXI.Point(origin.x + Math.cos(startAngle) * radius, origin.y + Math.sin(startAngle) * radius)
      visual.end = new PIXI.Point(origin.x + Math.cos(endAngle) * radius, origin.y + Math.sin(endAngle) * radius)
      if (Math.abs(screenDelta) > 0.04) {
        visual.arc = `M ${visual.start.x} ${visual.start.y} A ${radius} ${radius} 0 0 ${screenDelta > 0 ? 1 : 0} ${visual.end.x} ${visual.end.y}`
        const direction = Math.sign(screenDelta)
        const tx = -Math.sin(endAngle) * direction, ty = Math.cos(endAngle) * direction
        const bx = visual.end.x - tx * 8, by = visual.end.y - ty * 8
        visual.arrow = `${visual.end.x},${visual.end.y} ${bx - ty * 4},${by + tx * 4} ${bx + ty * 4},${by - tx * 4}`
      }
    }
  }
  transformVisual.value = visual
}

function clearTransformVisual() {
  transformVisual.value = undefined
  visualParent = undefined
  visualOrigin = undefined
  visualPointer = undefined
}

// 立绘组变换用的 dummy 映射（不再 reparent 目标，而是创建 dummy 跟随 groupContainer）
interface GroupDummyEntry {
  dummy: PIXI.Container
  target: PIXI.Container
  id: string
  parent: PIXI.Container
  parentIndex: number
  // target 在 startTransform 前的 rts 快照（cancelTransform 时还原用）
  originalLocalX: number
  originalLocalY: number
  originalScaleX: number
  originalScaleY: number
  originalRotation: number
}
let groupDummyEntries: GroupDummyEntry[] = []
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
  return isFigureGroupId(id) ? groupContainers.get(id) : previewRuntime.modelWrappers.get(id)
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
function getFigureGroupTargetContainers(): { containers: PIXI.Container[]; ids: string[] } {
  const id = store.selectedId
  if (!id || !isFigureGroupId(id)) return { containers: [], ids: [] }
  const group = store.figureGroups.find((g) => g.id === id)
  if (!group) return { containers: [], ids: [] }

  const figureIds = store.flattenFigureGroupTargets(id)
  const containers: PIXI.Container[] = []
  for (const fid of figureIds) {
    const c = previewRuntime.modelWrappers.get(fid)
    if (c) containers.push(c)
  }

  const ids: string[] = [...figureIds]

  // includeBackground 时把背景容器也加进去（Bug 2 修复）
  if (group.includeBackground && backgroundContainer) {
    containers.push(backgroundContainer)
    ids.push(SpecialId.BgContainer)
  }

  return { containers, ids }
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
  updateTransformVisual()
  // 注视模式：显示注视坐标
  if (transformMode.value === 'l' && focusTargetId) {
    const f = store.getFocusState(focusTargetId)
    transformHint.modeName = '注视'
    transformHint.axis = '无'
    transformHint.x = f.x.toFixed(2)
    transformHint.y = f.y.toFixed(2)
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
  // 注视模式（l）：仅 live2d 立绘支持，单独初始化
  if (mode === 'l') {
    const id = store.selectedId
    const model = store.selectedModel
    if (!id || !model || model.kind !== 'live2d') {
      msg.warning('仅 Live2D 立绘支持注视调整')
      return
    }
    const target = getTransformTarget()
    if (!target) return

    transformMode.value = mode
    axisLock.value = 'none'
    baseInitialized = false

    // 快照当前注视状态（取消时完整复原，含 enabled）
    focusTargetId = id
    const cur = store.getFocusState(id)
    focusSavedState = { ...cur }
    // 自动启用注视
    if (!cur.enabled) {
      store.setFocusState(id, { enabled: true })
    }

    // 画注视方框（挂 wrapper 下，天然跟随模型 rts）
    const half = FOCUS_BOX_SIZE / 2
    focusBox = new PIXI.Graphics()
    focusBox.y = focusBoxOffsetY.value
    focusBox.tint = themeColor('link')
    focusBox.lineStyle(4, 0xffffff, 0.9)
    focusBox.drawRect(-half, -half, FOCUS_BOX_SIZE, FOCUS_BOX_SIZE)
    focusBox.lineStyle(2, 0xffffff, 0.5)
    focusBox.moveTo(-half, 0)
    focusBox.lineTo(half, 0)
    focusBox.moveTo(0, -half)
    focusBox.lineTo(0, half)
    target.addChild(focusBox)

    emitter.emit(StageEvents.TransformStart, true)
    refreshTransformHint()
    return
  }

  transformMode.value = mode
  axisLock.value = 'none'
  baseInitialized = false
  rotationDelta = 0

  const id = store.selectedId

  if (id && isFigureGroupId(id)) {
    // 立绘组：先清理无效目标
    store.cleanupInvalidFigureGroupTargets(id)

    const group = store.figureGroups.find((g) => g.id === id)
    if (!group) return

    // editAnchorOnly 时只改锚点本身：跳过 reparent + snapshot，让 endTransform 走 "仅 reset groupContainer" 分支
    const lockTarget = group.editAnchorOnly === true

    const { containers: containerList, ids } = lockTarget ? { containers: [], ids: [] } : getFigureGroupTargetContainers()
    const containers = containerList
    const groupContainer = ensureGroupContainer(group)

    // 先让所有 worldTransform 是新的（保证原父变换是最新的）
    stageMain?.updateTransform()

    if (!lockTarget) {
      // 创建 dummy（rts 与 target 视觉一致）并 addChild 到 groupContainer。
      // 不再 reparent target，target 的 rts 在 pointMove 中由 syncDummyToTarget 实时同步。
      // 位置转换走 toGlobal/toLocal，自动处理 parent chain 的 rts，避免与 L2dwContainer base 偏移耦合。
      groupDummyEntries = containers.map((c, i) => {
        const parent = c.parent
        const parentIndex = parent ? parent.getChildIndex(c) : 0

        // 用 c.position 读真实 local（绕开 L2dwContainer.x getter 的 base 偏移）
        const oldX = c.position.x
        const oldY = c.position.y
        const oldScaleX = c.scale.x
        const oldScaleY = c.scale.y
        const oldRotation = c.rotation

        const dummy = new PIXI.Container()
        dummy.position.copyFrom(c.position)
        dummy.position.x -= groupContainer.position.x
        dummy.position.y -= groupContainer.position.y
        dummy.scale.x = oldScaleX
        dummy.scale.y = oldScaleY
        dummy.rotation = oldRotation

        groupContainer.addChild(dummy)

        return {
          dummy,
          target: c,
          id: ids[i],
          parent: parent!,
          parentIndex,
          originalLocalX: oldX,
          originalLocalY: oldY,
          originalScaleX: oldScaleX,
          originalScaleY: oldScaleY,
          originalRotation: oldRotation,
        }
      })

      // 组内排序：backgroundContainer 排最底，立绘 dummy 按当前顺序递增，
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
    beginTransformVisual(groupContainer)
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

  beginTransformVisual(target)
  emitter.emit(StageEvents.TransformStart, true)
  emitter.emit(StageEvents.TransformChange, store.selectedId)
  refreshTransformHint()
}

function cancelTransform() {
  // 注视模式：复原快照（含 enabled）
  if (transformMode.value === 'l') {
    if (focusTargetId && focusSavedState) {
      store.setFocusState(focusTargetId, { ...focusSavedState })
    }
    cleanupFocusMode()
    return
  }

  const id = store.selectedId
  if (id && isFigureGroupId(id)) {
    // 立绘组：还原每个 target 到 startTransform 前的 rts（其 parent 未变）
    for (const entry of groupDummyEntries) {
      entry.target.position.set(entry.originalLocalX, entry.originalLocalY)
      entry.target.scale.set(entry.originalScaleX, entry.originalScaleY)
      entry.target.rotation = entry.originalRotation
    }
    // 销毁所有 dummy
    for (const entry of groupDummyEntries) {
      entry.dummy.destroy()
    }
    // g 模式：把 store.group.x/y 还原到 start 前的值
    if (transformMode.value === 'g') {
      store.updateFigureGroup(id, { x: groupStartCenterX, y: groupStartCenterY })
    }
    // 重置 groupContainer（identity + 当前 store.group.x/y 作为 base）
    resetGroupContainer(id)
    groupDummyEntries = []
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
  // 注视模式结束：仅清理，保留当前注视值
  if (transformMode.value === 'l') {
    cleanupFocusMode()
    return
  }

  const id = store.selectedId
  if (id && isFigureGroupId(id)) {

    if (groupDummyEntries.length > 0)
    {
      // 立绘组结束变换：target 的 rts 在 pointMove 中已被实时同步（包含 groupContainer 的整体贡献），
      // 此处只需销毁 dummy 并把每个 target 的最终 rts 同步到 store。
      // target 物理上一直在原父下，无需 reparent。
      // 先同步所有 target 的 rts 到 store
      for (const entry of groupDummyEntries) {
        store.syncTransformFromModel(entry.id)
      }
      // 再销毁所有 dummy
      for (const entry of groupDummyEntries) {
        entry.dummy.destroy()
      }
      groupDummyEntries = []
    }

    // 重置 groupContainer（identity + 当前 store.group.x/y 作为 base）
    resetGroupContainer(id)
  }

  transformMode.value = 'none'
  clearTransformVisual()
  altHeldInMove.value = false
  updateSnappedGuides()
  updateMoveCrosshair()
  axisLock.value = 'none'
  baseInitialized = false
  groupDummyEntries = []
  emitter.emit(StageEvents.TransformStart, false)
  emitter.emit(StageEvents.TransformChange, store.selectedId)
  // 同步变换到 store
  if (store.selectedId) {
    store.syncTransformFromModel(store.selectedId)
  }
  refreshTransformHint()
  updateFigureGroupCrosshair()
}

/** 清理注视模式：销毁方框并复位模式状态（不改动注视值） */
function cleanupFocusMode() {
  if (focusBox) {
    focusBox.destroy()
    focusBox = null
  }
  focusTargetId = null
  focusSavedState = null
  transformMode.value = 'none'
  axisLock.value = 'none'
  baseInitialized = false
  emitter.emit(StageEvents.TransformStart, false)
  refreshTransformHint()
}

/**
 * 注视模式：把鼠标位置经 wrapper toLocal 映射到 [-1,1]（自动含模型 rts）。
 * y 取反：focus 参数向上为正（与 FocusPicker 一致）。
 */
function applyFocusFromPointer(clientX: number, clientY: number) {
  if (!app || !focusTargetId) return
  const wrapper = previewRuntime.modelWrappers.get(focusTargetId)
  if (!wrapper) return

  const canvas = app.view as HTMLCanvasElement
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const px = (clientX - rect.left) * (app.screen.width / rect.width)
  const py = (clientY - rect.top) * (app.screen.height / rect.height)

  const local = wrapper.toLocal(new PIXI.Point(px, py))
  const half = FOCUS_BOX_SIZE / 2
  // 中心→鼠标线段与方框边界的交点（框内即鼠标本身，框外取边交点）
  const offsetLocalY = local.y - focusBoxOffsetY.value
  const k = Math.min(half / Math.max(Math.abs(local.x), Math.abs(offsetLocalY)), 1)
  const nx = (local.x * k) / half
  const ny = (-offsetLocalY * k) / half
  store.setFocusState(focusTargetId, {
    x: Math.round(nx * 100) / 100,
    y: Math.round(ny * 100) / 100,
  })
  refreshTransformHint()
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
  camera: '镜头',
  model: '立绘',
  figureGroup: '立绘组',
  none: '未选中',
}

// 通用操作：所有选中状态都会显示
const COMMON_MOUSE_HINTS: MouseHint[] = [
  { keys: '中键拖动', description: '平移舞台视图' },
  { keys: '鼠标滚轮', description: '缩放舞台视图' },
  { keys: 'M', description: '进入 / 退出游标模式' },
  { keys: PREVIEW_GUIDE_VISIBILITY_KEYS, description: '切换常驻显示游标' },
]
// F1 / F2 都是数据驱动的快捷键提示，仅可点击触发（点击等价于按下 F1/F2）
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
  {
    keys: 'F2',
    description: '打开表情编辑器窗口',
    entry: {
      key: 'F2',
      keys: 'F2',
      description: '打开表情编辑器窗口',
      targets: ['model', 'background', 'stage', 'figureGroup', 'none'],
      handlerKey: 'openActorEditor',
      run: () => {
        const msg = useMessage()
        const entry = store.selectedModel
        if (!entry) {
          msg.warning('请先选中一个立绘')
          return
        }
        if (entry.kind !== 'live2d') {
          msg.warning('仅 Live2D 模型支持此操作')
          return
        }
        const wmdlPath = entry.wmdlConfig?.wmdlFilePath
        if (!wmdlPath) {
          msg.error('未找到对应的 wmdl 文件')
          return
        }
        OpenActorEditor(wmdlPath).catch((err: unknown) =>
          msg.error(`打开失败：${err}`),
        )
      },
    },
  },
  {
    keys: 'F3',
    description: '打开动作编辑器窗口',
    entry: {
      key: 'F3',
      keys: 'F3',
      description: '打开动作编辑器窗口',
      targets: ['model', 'background', 'stage', 'figureGroup', 'none'],
      handlerKey: 'openMotionEditor',
      run: () => {
        const msg = useMessage()
        const entry = store.selectedModel
        if (!entry) {
          msg.warning('请先选中一个立绘')
          return
        }
        if (entry.kind !== 'live2d') {
          msg.warning('仅 Live2D 模型支持此操作')
          return
        }
        const wmdlPath = entry.wmdlConfig?.wmdlFilePath
        if (!wmdlPath) {
          msg.error('未找到对应的 wmdl 文件')
          return
        }
        OpenMotionEditor(wmdlPath).catch((err: unknown) =>
          msg.error(`打开失败：${err}`),
        )
      },
    },
  },
]

// 各类型专属的鼠标提示
const MOUSE_HINTS_BY_TYPE: Record<ReturnType<typeof resolveShortcutTargetType>, MouseHint[]> = {
  background: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转'}],
  stage: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转'}],
  camera: [{keys: '变换操作', description: 'G-拖拽 S-等比缩放 R-旋转'}],
  model: [{keys: '变换操作', description: 'G-拖拽 S-缩放 R-旋转'}, {keys: '注视操作', description: 'L-鼠标调整注视方向'}],
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

const msg = useMessage()

let app: PIXI.Application | null = null
const live2dById = new Map<string, Live2DModel>()
const containersById = new Map<string, L2dwContainer>()
let stopObservingViewport: (() => void) | null = null
const backgroundSprite = shallowRef<PIXI.Sprite | null>(null)

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
let guideGraphics: PIXI.Graphics | null = null
let moveCrosshair: PIXI.Graphics | null = null
/** groupId -> 该立绘组专属 L2dwContainer（始终挂在 stageMain 下） */
const groupContainers = new Map<string, L2dwContainer>()

let isMiddleDown = false
let lastMouseX = 0
let lastMouseY = 0

function getGuideViewport() {
  if (!app || !rootContainer || !frameContainer) return
  const frame = frameContainer
  const rect = app.view.getBoundingClientRect()
  if (!rect.width || !rect.height || !app.screen.width || !app.screen.height) return
  const cssX = rect.width / app.screen.width
  const cssY = rect.height / app.screen.height
  return {
    frame,
    cssScale: { x: cssX, y: cssY },
    pixels: { x: cssX * rootContainer.scale.x, y: cssY * rootContainer.scale.y },
    toFrame: (clientX: number, clientY: number) => frame.toLocal(
      new PIXI.Point((clientX - rect.left) / cssX, (clientY - rect.top) / cssY),
    ),
  }
}

type GuideViewport = NonNullable<ReturnType<typeof getGuideViewport>>

function getParentMoveAnchor(target: PIXI.Container, x = target.x, y = target.y) {
  return { x: target.position.x + (x - target.x), y: target.position.y + (y - target.y) }
}

function snapMovePosition(target: PIXI.Container, x: number, y: number, lock: AxisLock, viewport: GuideViewport) {
  const parent = target.parent
  if (!parent) return
  const { frame, pixels } = viewport
  const local = getParentMoveAnchor(target, x, y)
  const anchor = frame.toLocal(local, parent)
  const snapped = snapPreviewGuide(store.guides, anchor, pixels, lock, guideOverflow.value)
  if (!snapped) return

  if (lock === 'none') {
    const position = parent.toLocal(snapped.point, frame)
    if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
      return { position: { x: x + (position.x - local.x), y: y + (position.y - local.y) }, guides: snapped.guides }
    }
    return
  }

  // 父容器可能已旋转：只沿对象的可动轴移动，求它和绝对游标的交点。
  const step = frame.toLocal({ ...local, [lock]: local[lock] + 1 }, parent)
  const projection = step[lock] - anchor[lock]
  const length = Math.hypot(step.x - anchor.x, step.y - anchor.y)
  if (Math.abs(projection) <= length * 1e-6) return
  const delta = (snapped.point[lock] - anchor[lock]) / projection
  if (Number.isFinite(delta)) {
    return { position: { x, y, [lock]: (lock === 'x' ? x : y) + delta }, guides: snapped.guides }
  }
}

function updateMoveCrosshair(target?: PIXI.Container, viewport?: GuideViewport) {
  const crosshair = moveCrosshair
  if (!crosshair) return
  crosshair.visible = false
  if (!isMoveAltActive.value) return
  target ??= getTransformTarget()
  viewport ??= getGuideViewport()
  if (!target?.parent || !viewport) return

  const anchor = target.parent.toGlobal(getParentMoveAnchor(target))
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return
  crosshair.position.copyFrom(anchor)
  const screenScale = 0.28
  crosshair.scale.set(screenScale / viewport.cssScale.x, screenScale / viewport.cssScale.y)
  crosshair.visible = true
}

function drawGuides() {
  const graphics = guideGraphics
  if (!graphics) return
  graphics.visible = guidesVisible.value
  if (!graphics.visible) return
  const viewport = getGuideViewport()
  if (!viewport) return
  const unit = 1 / Math.min(viewport.pixels.x, viewport.pixels.y)
  const candidate = guideCandidate.value
  const deleting = guideMode.value === 'delete'
  const draw = (guide: PreviewGuide, color: number, alpha: number, width = 1) => {
    const [a, b] = previewGuideEnds(guide)
    const drawLayer = (layerColor: number, layerAlpha: number, lineWidth: number, radius: number) => {
      graphics.lineStyle(lineWidth * unit, layerColor, layerAlpha)
      graphics.moveTo(a.x, a.y)
      graphics.lineTo(b.x, b.y)
      if (guideOverflow.value > 0) {
        const dx = guide.axis === 'y' ? guideOverflow.value : 0
        const dy = guide.axis === 'x' ? guideOverflow.value : 0
        graphics.moveTo(a.x, a.y)
        graphics.lineTo(a.x - dx, a.y - dy)
        graphics.moveTo(b.x, b.y)
        graphics.lineTo(b.x + dx, b.y + dy)
      }
      graphics.lineStyle(0)
      graphics.beginFill(layerColor, layerAlpha)
      graphics.drawCircle(a.x, a.y, radius * unit)
      graphics.drawCircle(b.x, b.y, radius * unit)
      graphics.endFill()
    }
    drawLayer(0x000000, alpha * 0.7, width + 2, 4)
    drawLayer(color, alpha, width, 3)
  }
  graphics.clear()
  const matched = snappedGuides.value.filter(guide => store.guides.includes(guide))
  for (const guide of store.guides) {
    if (!matched.includes(guide)) draw(guide, themeColor(deleting && guide === candidate ? 'danger' : 'link'), 0.95)
  }
  for (const guide of matched) draw(guide, themeColor('success'), 1, 2.2)
  if (candidate && !deleting) {
    const key = previewGuideKey(candidate)
    if (!store.guides.some(guide => previewGuideKey(guide) === key)) draw(candidate, themeColor('link'), 0.5)
  }
}

watch([() => store.guides, guideMode, guideCandidate, guidesVisible, snappedGuides, guideOverflow, currentTheme], drawGuides, { deep: true })

let frameLines: PIXI.Graphics | null = null
let cameraLines: PIXI.Graphics | null = null
function tintOverlays() {
  if (frameLines) frameLines.tint = themeColor('success')
  if (cameraLines) cameraLines.tint = themeColor('warning')
  if (focusBox) focusBox.tint = themeColor('link')
  if (moveCrosshair) moveCrosshair.tint = themeColor('text')
  for (const c of groupContainers.values()) {
    const cross = c.children.find(ch => ch instanceof PIXI.Graphics) as PIXI.Graphics | undefined
    if (cross) cross.tint = themeColor('warning')
  }
}
watch(currentTheme, tintOverlays)

watch(frameRateLimit, (limit) => {
  if (app) app.ticker.maxFPS = limit
})

watch(focusBoxOffsetY, (offset) => {
  if (focusBox) focusBox.y = offset
})

onMounted(() => {
  void init()
  emitter.on(StageEvents.ReloadModel, reloadOne)
})

onBeforeUnmount(() => {
  emitter.off(StageEvents.ReloadModel, reloadOne)
  clearTransformVisual()
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
    resolution: getDevicePixelRatio(),
  })
  app.ticker.maxFPS = frameRateLimit.value
  previewRuntime.app = app
  previewRuntime.previewStore = useModelStore()

  // The plugin's auto-update reads window.PIXI.Ticker.
  ;(window as any).PIXI = PIXI

  container.appendChild(app.view as HTMLCanvasElement)

  // 创建 Root 容器（用户通过中键拖拽和滚轮缩放操作它）
  rootContainer = new PIXI.Container()
  rootContainer.x = app.screen.width / 2
  rootContainer.y = app.screen.height / 2
  rootContainer.scale.set(0.33)
  store.rootContainerScale = 0.33

  // 创建主容器结构
  stageMain = new L2dwContainer()
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
  const frame = frameLines = new PIXI.Graphics()
  const { left, right, top, bottom } = PREVIEW_FRAME
  frame.lineStyle(2, 0xffffff)
  frame.drawRect(left, top, right - left, bottom - top)
  // 四个顶点处的横竖延伸线（向外溢出边框）
  const ext = 1280
  for (const [x, dx] of [[left, -ext], [right, ext]]) {
    for (const [y, dy] of [[top, -ext], [bottom, ext]]) {
      frame.moveTo(x + dx, y)
      frame.lineTo(x, y)
      frame.lineTo(x, y + dy)
    }
  }
  guideGraphics = new PIXI.Graphics()
  frameContainer.addChild(frame, guideGraphics)
  rootContainer.addChild(frameContainer)

  const camera = new PIXI.Container()
  const cameraFrame = cameraLines = new PIXI.Graphics()
  cameraFrame.lineStyle(16, 0xffffff)
  cameraFrame.drawRect(-STAGE_WIDTH / 2, -STAGE_HEIGHT / 2, STAGE_WIDTH, STAGE_HEIGHT)
  cameraFrame.moveTo(0, -STAGE_HEIGHT / 2)
  cameraFrame.lineTo(0, -STAGE_HEIGHT / 2 - 100)
  cameraFrame.drawCircle(0, -STAGE_HEIGHT / 2 - 130, 30)
  camera.addChild(cameraFrame)
  const cameraSelected = store.selectedId === SpecialId.Camera
  camera.visible = cameraSelected || store.cameraFrameVisible
  camera.alpha = cameraSelected ? 1 : 0.5
  rootContainer.addChild(camera)
  previewRuntime.specialContainers.set(SpecialId.Camera, camera)

  moveCrosshair = buildStageCrosshair(6, 8)
  tintOverlays()
  moveCrosshair.visible = false
  app.stage.addChild(moveCrosshair)

  stopObservingViewport = observePixiViewport(app, container, rootContainer, () => {
    fitBackground()
    guideCandidate.value = undefined
    drawGuides()
    updateMoveCrosshair()
    updateTransformVisual()
  })
  drawGuides()

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

  const applyTransform = (container: PIXI.Container, state: typeof store.stageState) => {
    container.x = state.x
    container.y = state.y
    container.scale.set(state.scale.x, state.scale.y)
    container.rotation = state.rotation * Math.PI / 180
  }
  applyTransform(stageMain, store.stageState)
  applyTransform(backgroundContainer, store.bgState)
  applyTransform(camera, store.cameraState)
  store.setFilterState(SpecialId.StageMain, store.stageFilterState)
  store.setFilterState(SpecialId.BgContainer, store.bgFilterState)
  if (store.backgroundUrl) void loadBackground(store.backgroundUrl)
  else void loadDefaultBackground()
  for (const entry of store.models) await loadOne(entry.id)
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
  const crosshair = buildStageCrosshair()
  crosshair.tint = themeColor('warning')
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
 * 构建空心十字准星（主线 + 黑描边）
 * @param mainWidth 主线线宽
 * @param extraWidth 描边比主线粗多少（描边线宽 = mainWidth + extraWidth）
 */
function buildStageCrosshair(
  mainWidth = 8,
  extraWidth = 8,
): PIXI.Graphics {
  const g = new PIXI.Graphics()
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

  // 主线叠在描边中央
  g.lineStyle(mainWidth, 0xffffff)
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
  if (isMoveAltActive.value) return
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
  [() => store.selectedId, isMoveAltActive],
  updateFigureGroupCrosshair,
  { immediate: true },
)

watch(
  [() => store.selectedId, () => store.cameraFrameVisible],
  ([id, pinned]) => {
    const camera = previewRuntime.specialContainers.get(SpecialId.Camera)
    if (!camera) return
    const selected = id === SpecialId.Camera
    camera.visible = selected || pinned
    camera.alpha = selected ? 1 : 0.5
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

async function restoreLoadedFigure(id: string) {
  const entry = store.models.find(m => m.id === id)
  if (!entry) return
  const wrapper = containersById.get(id)
  if (wrapper) {
    wrapper.visible = entry.visible
    wrapper.zIndex = store.models.findIndex(m => m.id === id)
    figureContainer?.sortChildren()
  }
  if (entry.kind !== 'live2d') return
  store.setFocusState(id, store.figureFocusStates[id] ?? {})
  store.setBlinkState(id, store.figureBlinkStates[id] ?? {})
  if (entry.playing.motion) await store.playMotion(id, entry.playing.motion.group, entry.playing.motion.index, entry.playing.motion.name)
  if (entry.playing.expression) await store.playExpression(id, entry.playing.expression.index, entry.playing.expression.name)
}

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

    try { await restoreLoadedFigure(id) }
    catch (err) { console.warn('Failed to restore figure state:', err) }
    store.selectedId = id
  } catch (err) {
    console.error('Failed to load figure:', err)
    removeOne(id)
  }
}

/**
 * 加载图片立绘：PIXI.Sprite + FitInside（Math.min），
 * 让 sprite 在 stageMain 坐标系下被等比缩放至长边刚好贴齐 STAGE 边界，
 * 再交给外层 wrapper 接管用户主动的 x/y/scale/rotation/alpha。
 */
async function loadImageFigure(entry: NonNullable<ReturnType<typeof store.models.find>>) {
  if (!app || !entry.imageUrl) return

  const wrapper = new L2dwContainer()
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

  wrapper.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT - sprite.height / 2)
  wrapper.x = entry.state.x ?? 0
  wrapper.y = entry.state.y ?? 0
  wrapper.scale.x = entry.state.scale?.x ?? 1
  wrapper.scale.y = entry.state.scale?.y ?? 1
  wrapper.rotation = ((entry.state.rotation ?? 0) * Math.PI) / 180

  wrapper.addChild(sprite)
  store.applyFilterToContainer(entry.id, wrapper)
}

async function loadWmdlModels(entry: NonNullable<ReturnType<typeof store.models.find>>) {
  const wmdlModels = entry.wmdlModels ?? []
  if (wmdlModels.length === 0) return

  // 创建主 wrapper（wmdl 整体容器）
  const mainWrapper = new L2dwContainer()
  mainWrapper.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
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
  previewRuntime.wmdlSubModels.set(entry.id, { subModelIds, mainWrapper })

  // 每个子模型用独立的 wrapper，最后装入主 wrapper
  const bounds = entry.wmdlConfig?.bounds
  const overrideBounds = bounds && bounds.some((v) => v !== 0) ? bounds : null
  for (const wmdlModel of wmdlModels) {
    const url = toFileUrl(wmdlModel.jsonAbsPath)
    const model = await Live2DModel.from(url, {
      idleMotionGroup: '',
      autoInteract: false,
      ...(overrideBounds ? { overWriteBounds: { x0: overrideBounds[0], y0: overrideBounds[1], x1: overrideBounds[2], y1: overrideBounds[3] } } : {}),
    })

    const scaleX = STAGE_WIDTH / model.width
    const scaleY = STAGE_HEIGHT / model.height
    const targetScale = Math.min(scaleX, scaleY) * 1.25
    const targetHeight = model.height * targetScale

    model.scale.x = targetScale
    model.scale.y = targetScale
    model.anchor.set(0.5)
    if (overrideBounds) {
      model.pivot.x += (overrideBounds[0] + overrideBounds[2]) * 0.5
      model.pivot.y += (overrideBounds[1] + overrideBounds[3]) * 0.5
    }
    model.position.x = 0 + wmdlModel.offsetX;
    model.position.y = STAGE_HEIGHT / 1.8 + wmdlModel.offsetY;

    mainWrapper.addChild(model)
    live2dById.set(wmdlModel.id, model)
    subModelIds.push(wmdlModel.id)
  }

  // 存储子模型 ID 映射
  previewRuntime.wmdlSubModels.set(entry.id, { subModelIds, mainWrapper })

  // 暴露给外部组件访问
  previewRuntime.live2dModels = live2dById
  previewRuntime.modelWrappers = containersById

  // 新建 wrapper 立即同步滤镜（按当前 rootContainer.scale 补偿）
  store.applyFilterToContainer(entry.id, mainWrapper)
}

const reloadingModels = new Set<string>()

async function reloadOne(id: string) {
  const entry = store.models.find((m) => m.id === id)
  if (!entry || entry.kind !== 'live2d' || !entry.wmdlModels.length) {
    msg.error('无法重载模型：未找到 Live2D 模型')
    return
  }
  if (reloadingModels.has(id)) return
  reloadingModels.add(id)

  let restoreSelection = false
  let rebuilding = false
  try {
    const hasConfigFile = !!entry.wmdlConfig?.wmdlFilePath
    if (hasConfigFile && !(await store.reloadWmdlConfig(id))) throw new Error('未找到模型配置文件')
    restoreSelection = store.selectedId === id
    if (restoreSelection) store.selectedId = null
    removeOne(id)
    rebuilding = true
    await loadWmdlModels(entry)
    await restoreLoadedFigure(id)
    rebuilding = false
    msg.success(hasConfigFile ? '已从磁盘重新加载配置' : '已重新加载 Live2D 模型')
  } catch (error) {
    if (rebuilding) removeOne(id)
    msg.error(`重载模型失败：${error}`)
  } finally {
    reloadingModels.delete(id)
    if (restoreSelection && store.selectedId === null && store.models.some(model => model.id === id)) {
      store.selectedId = id
    }
  }
}

function removeOne(id: string) {
  clearTargetOutline(id)
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
  let movePointer: PIXI.Point | undefined
  let guidePointer: PIXI.Point | undefined

  const toScreen = (clientX: number, clientY: number): PIXI.Point => {
    return new PIXI.Point(clientX, clientY)
  }

  const trackGuidePointer = (e: MouseEvent) => {
    guidePointer = e.target === canvas ? toScreen(e.clientX, e.clientY) : undefined
  }

  const editGuideAtPointer = (commit = false) => {
    const mode = guideMode.value
    const viewport = mode !== 'none' && guidePointer ? getGuideViewport() : undefined
    if (mode === 'none' || !guidePointer || !viewport) {
      guideCandidate.value = undefined
      return
    }
    const point = viewport.toFrame(guidePointer.x, guidePointer.y)
    const candidate = mode === 'delete'
      ? hitPreviewGuide(store.guides, point, viewport.pixels, guideOverflow.value)
      : placePreviewGuide(mode, point)
    guideCandidate.value = candidate
    if (!commit || !candidate) return
    if (mode === 'delete') {
      store.deleteGuide(candidate)
      guideCandidate.value = hitPreviewGuide(store.guides, point, viewport.pixels, guideOverflow.value)
    } else {
      store.saveGuide(candidate)
    }
  }

  const onCanvasEnter = (e: PointerEvent) => {
    if (radialMenu.value || props.interactionDisabled || isMiddleDown) return
    trackGuidePointer(e)
    editGuideAtPointer()
  }

  const onCanvasLeave = () => {
    guidePointer = undefined
    guideCandidate.value = undefined
  }

  function applyMove(alt: boolean) {
    if (!rootContainer || !store.selectedId) {
      updateSnappedGuides()
      updateMoveCrosshair()
      return
    }
    const id = store.selectedId
    const group = isFigureGroupId(id)
    const target = getTransformTarget()
    if (!target) {
      updateSnappedGuides()
      updateMoveCrosshair()
      return
    }
    const originX = group ? groupStartCenterX : startX
    const originY = group ? groupStartCenterY : startY
    const pointer = baseInitialized ? movePointer : undefined
    const scale = rootContainer.scale.x
    const lock = axisLock.value
    const x = originX + (pointer && lock !== 'y' ? (pointer.x - tStartMouseX) / scale : 0)
    const y = originY + (pointer && lock !== 'x' ? (pointer.y - tStartMouseY) / scale : 0)
    const viewport = isMoveAltActive.value ? getGuideViewport() : undefined
    const snapped = alt && viewport && store.guides.length ? snapMovePosition(target, x, y, lock, viewport) : undefined
    target.x = snapped?.position.x ?? x
    target.y = snapped?.position.y ?? y
    updateSnappedGuides(snapped?.guides)
    if (group) {
      store.updateFigureGroup(id, { x: target.x, y: target.y })
      syncDummyToTarget(target)
    }
    updateMoveCrosshair(target, viewport)
    emitter.emit(StageEvents.TransformChange, id)
    refreshTransformHint()
  }

  function updateMoveAlt(e: MouseEvent | KeyboardEvent) {
    altHeldInMove.value = e.altKey
    applyMove(e.altKey && !e.ctrlKey && !e.metaKey)
  }

  function applyRotation(alt: boolean) {
    const id = store.selectedId
    if (!id) return
    const group = isCurrentFigureGroup()
    const target = getTransformTarget()
    if (!target) return
    const angle = (group ? groupStartRotation : startRotation) + rotationDelta
    const degrees = angle * 180 / Math.PI
    target.rotation = alt
      ? Math.round(degrees / rotationSnap.value) * rotationSnap.value * Math.PI / 180
      : angle
    if (group) syncDummyToTarget(target)
    emitter.emit(StageEvents.TransformChange, id)
    refreshTransformHint()
  }

  const isRadialTrigger = (e: PointerEvent) =>
    !props.interactionDisabled && !isTransforming.value && guideMode.value === 'none' &&
    (e.ctrlKey || e.metaKey) && e.button === 2 && e.target === canvas && !isMiddleDown

  const onPointerDown = (e: PointerEvent) => {
    if (props.interactionDisabled) return
    if (isRadialTrigger(e)) {
      e.preventDefault()
      suppressRadialContextMenu = true
      openRadialMenu(e)
      return
    }
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

    if (e.button === 2 && guideMode.value !== 'none') {
      setGuideMode('none')
      e.preventDefault()
      return
    }
    if (e.button === 2 && e.target === canvas && !isMiddleDown) {
      e.preventDefault()
      void openTargetMenu(e, canvas)
      return
    }

    if (guideMode.value !== 'none' && e.button === 0 && e.target === canvas) {
      trackGuidePointer(e)
      editGuideAtPointer(true)
      e.preventDefault()
      return
    }

    // 中键优先：中键按下即标记拖拽
    if (e.button === 1 && rootContainer) {
      isMiddleDown = true
      guideCandidate.value = undefined
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      e.preventDefault()
      return
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (radialMenu.value) {
      updateRadialPointer(e)
      return
    }
    if (targetMenu.value) {
      const bounds = targetMenuRef.value?.getBoundingClientRect()
      if (bounds && (e.clientX < bounds.left - 32 || e.clientX > bounds.right + 32 ||
          e.clientY < bounds.top - 32 || e.clientY > bounds.bottom + 32)) closeTargetMenu()
      else if (bounds && (e.clientX < bounds.left || e.clientX > bounds.right ||
          e.clientY < bounds.top || e.clientY > bounds.bottom)) targetMenuActive.value = -1
      return
    }
    if (props.interactionDisabled) return
    if (transformMode.value === 'r' || transformMode.value === 's') {
      visualPointer = new PIXI.Point(e.clientX, e.clientY)
    }
    trackGuidePointer(e)
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
    if (guideMode.value !== 'none') editGuideAtPointer()

    // Blender 风格变换操作中：鼠标移动实时应用
    if (isTransforming.value) {
      if (!rootContainer) return

      // 注视模式：鼠标位置映射到方框内的 [-1,1]
      if (transformMode.value === 'l') {
        applyFocusFromPointer(e.clientX, e.clientY)
        return
      }

      if (transformMode.value === 'g') {
        if (!baseInitialized) {
          tStartMouseX = e.clientX
          tStartMouseY = e.clientY
          baseInitialized = true
        }
        movePointer = toScreen(e.clientX, e.clientY)
        updateMoveAlt(e)
        return
      }

      // 立绘组：按"组中心为基准"应用 GRS 到所有目标
      if (isCurrentFigureGroup()) {
        handleFigureGroupPointerMove(e)
        if (transformMode.value === 'r') return
        emitter.emit(StageEvents.TransformChange, store.selectedId)
        refreshTransformHint()
        return
      }

      const target = getTransformTarget()
      if (target) {
        // 首次移动时记录起点 / 起点距离 / 起点方向
        if (!baseInitialized) {
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

        if (transformMode.value === 's') {
          // s：鼠标到模型距离 / 起点距离 = 缩放倍数
          const p = toScreen(e.clientX, e.clientY)
          const dx = p.x - startScreenMP.x
          const dy = p.y - startScreenMP.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const factor = dist > 0 && startDist > 0 ? dist / startDist : 1
          if (store.selectedId === SpecialId.Camera) {
            target.scale.set(Math.max(MIN_CAMERA_SCALE, startScaleX * factor))
          } else if (axisLock.value === 'x') {
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
          rotationDelta = Math.atan2(sinA, cosA)
          applyRotation(e.altKey)
          return
        }
        emitter.emit(StageEvents.TransformChange, store.selectedId)
        refreshTransformHint()
      }
      return
    }
  }

  /**
   * 同步所有 dummy 的当前 rts 给对应的 target。
   * 通过 toGlobal/toLocal 转换位置，自动处理 parent chain rts；
   * scale/rotation 直接复制。
   */
  function syncDummyToTarget(gc: PIXI.Container) {
    if (groupDummyEntries.length === 0) return
    stageMain?.updateTransform()
    for (const entry of groupDummyEntries) {
      const t = entry.target
      const d = entry.dummy
      const worldPos = gc.toGlobal(d.position)
      t.position.copyFrom(t.parent.toLocal(worldPos))
      t.scale.x = d.scale.x * gc.scale.x
      t.scale.y = d.scale.y * gc.scale.y
      t.rotation = d.rotation + gc.rotation
    }
    stageMain?.updateTransform()
  }

  /**
   * 立绘组模式下的鼠标移动处理：只改 groupContainer 的 rts，然后同步给所有 target。
   *
   * - s：groupContainer.scale *= factor
   * - r：groupContainer.rotation += deltaAngle
   */
  function handleFigureGroupPointerMove(e: PointerEvent) {
    if (!rootContainer) return

    const id = store.selectedId
    if (!id || !isFigureGroupId(id)) return
    const groupContainer = groupContainers.get(id)
    if (!groupContainer) return

    // 首次移动时记录 s/r 模式用的"起点距离 / 方向"
    if (!baseInitialized) {
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
      syncDummyToTarget(groupContainer)
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
      rotationDelta = Math.atan2(sinA, cosA)
      applyRotation(e.altKey)
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    if (radialMenu.value) return
    if (e.type === 'pointercancel' && targetMenu.value) {
      closeTargetMenu()
    } else if (e.button === 2 && targetMenu.value) {
      const element = document.elementFromPoint(e.clientX, e.clientY)
      const option = element?.closest<HTMLElement>('[data-target-index]')
      const index = option && targetMenuRef.value?.contains(option) ? Number(option.dataset.targetIndex) : -1
      if (index >= 0) chooseTarget(index)
      else closeTargetMenu()
      e.preventDefault()
    }
    // pointerup 一定触发（任意按钮），统一清空中键状态
    if (isMiddleDown && !props.interactionDisabled && e.type !== 'pointercancel') {
      trackGuidePointer(e)
      editGuideAtPointer()
    }
    isMiddleDown = false
  }

  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  let suppressRadialContextMenu = false
  const stopRadialEvent = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  // 捕获阶段隔离 Pixi 和其他面板，普通右键仍走原有冒泡处理。
  const onRadialPointerDown = (event: PointerEvent) => {
    if (radialMenu.value) {
      stopRadialEvent(event)
      return
    }
    suppressRadialContextMenu = false
    if (isRadialTrigger(event)) {
      onPointerDown(event)
      stopRadialEvent(event)
    }
  }
  const onRadialPointerMove = (event: PointerEvent) => {
    if (!radialMenu.value) return
    updateRadialPointer(event)
    stopRadialEvent(event)
  }
  const onRadialPointerUp = (event: PointerEvent) => {
    const menu = radialMenu.value
    if (!menu) return
    stopRadialEvent(event)
    if (event.type === 'pointercancel') closeRadialMenu()
    else if (event.button === 2) {
      updateRadialPointer(event)
      const action = menu.actions[menu.active]
      closeRadialMenu()
      if (action) void runRadialAction(action.id, menu.id)
    }
  }
  const onRadialKeyDown = (event: KeyboardEvent) => {
    if (!radialMenu.value) return
    stopRadialEvent(event)
    if (event.key === 'Escape') closeRadialMenu()
  }
  const onRadialKeyUp = (event: KeyboardEvent) => {
    if (radialMenu.value) stopRadialEvent(event)
  }
  const onRadialWheel = (event: WheelEvent) => {
    if (radialMenu.value) stopRadialEvent(event)
  }
  const onRadialContextMenu = (event: MouseEvent) => {
    // WebView 可能在 pointerup 之后才发送 contextmenu。
    if (radialMenu.value || suppressRadialContextMenu) stopRadialEvent(event)
  }
  const onRadialClick = (event: MouseEvent) => {
    if (radialMenu.value || (event.button === 2 && suppressRadialContextMenu)) stopRadialEvent(event)
  }
  window.addEventListener('pointerdown', onRadialPointerDown, true)
  window.addEventListener('pointermove', onRadialPointerMove, true)
  window.addEventListener('pointerup', onRadialPointerUp, true)
  window.addEventListener('pointercancel', onRadialPointerUp, true)
  window.addEventListener('keydown', onRadialKeyDown, true)
  window.addEventListener('keyup', onRadialKeyUp, true)
  window.addEventListener('wheel', onRadialWheel, { capture: true, passive: false })
  window.addEventListener('contextmenu', onRadialContextMenu, true)
  window.addEventListener('click', onRadialClick, true)
  window.addEventListener('auxclick', onRadialClick, true)
  window.addEventListener('blur', closeRadialMenu)
  window.addEventListener('resize', closeRadialMenu)

  // 滚轮缩放 Root（乘法因子：scale 大小时手感一致）
  const onWheel = (e: WheelEvent) => {
    if (radialMenu.value) {
      e.preventDefault()
      return
    }
    if (targetMenu.value || props.interactionDisabled) return
    if (!rootContainer || !app) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
    const oldScale = rootContainer.scale.x
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor))
    const rect = canvas.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const x = (e.clientX - rect.left) * app.screen.width / rect.width
      const y = (e.clientY - rect.top) * app.screen.height / rect.height
      const ratio = newScale / oldScale
      rootContainer.x = x - (x - rootContainer.x) * ratio
      rootContainer.y = y - (y - rootContainer.y) * ratio
    }
    rootContainer.scale.set(newScale)
    store.applyRootScaleToAllContainers(newScale)
    trackGuidePointer(e)
    if (guideMode.value !== 'none') editGuideAtPointer()
    drawGuides()
    updateMoveCrosshair()
  }

  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerenter', onCanvasEnter)
  canvas.addEventListener('pointerleave', onCanvasLeave)

  // 检测输入框焦点
  const isInputFocused = () => {
    const active = document.activeElement
    if (!active) return false
    const tag = active.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || tag === 'select' || active.getAttribute('role') === 'combobox' || (active as HTMLElement).isContentEditable
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (radialMenu.value) return
    if (targetMenu.value) return
    if (props.interactionDisabled) return
    if (e.key === 'F1') {
      e.preventDefault()
      // 若当前选中了模型，把对应 wmdl 文件路径透传给编辑器进程，启动后自动加载
      const wmdlPath = store.selectedModel?.wmdlConfig?.wmdlFilePath ?? ''
      OpenEditor(wmdlPath).catch((err) => console.error('OpenEditor failed:', err))
      return
    }

    if (e.key === 'F2') {
      e.preventDefault()
      const entry = store.selectedModel
      if (!entry) {
        useMessage().warning('请先选中一个立绘')
        return
      }
      if (entry.kind !== 'live2d') {
        useMessage().warning('仅 Live2D 模型支持此操作')
        return
      }
      const wmdlPath = entry.wmdlConfig?.wmdlFilePath
      if (!wmdlPath) {
        useMessage().error('未找到对应的 wmdl 文件')
        return
      }
      OpenActorEditor(wmdlPath).catch((err: unknown) =>
        useMessage().error(`打开失败：${err}`),
      )
      return
    }

    if (e.key === 'F3') {
      e.preventDefault()
      const msg = useMessage()
      const entry = store.selectedModel
      if (!entry) {
        msg.warning('请先选中一个立绘')
        return
      }
      if (entry.kind !== 'live2d') {
        msg.warning('仅 Live2D 模型支持此操作')
        return
      }
      const wmdlPath = entry.wmdlConfig?.wmdlFilePath
      if (!wmdlPath) {
        msg.error('未找到对应的 wmdl 文件')
        return
      }
      OpenMotionEditor(wmdlPath).catch((err: unknown) =>
        msg.error(`打开失败：${err}`),
      )
      return
    }

    // 输入框焦点时不响应舞台快捷键
    if (isInputFocused()) return
    if (transformMode.value === 'g' && e.key === 'Alt') {
      if (!e.repeat) updateMoveAlt(e)
      e.preventDefault()
      return
    }
    if (transformMode.value === 'r' && e.key === 'Alt') {
      if (!e.repeat) applyRotation(true)
      e.preventDefault()
      return
    }
    if (e.ctrlKey || e.metaKey) return

    const key = e.key.toLowerCase()
    const isAxisKey = key === 'x' || key === 'y'
    if (e.altKey && !(isGuideMove.value && (isAxisKey || key === 'enter' || key === 'escape')) &&
        !(transformMode.value === 'r' && (key === 'enter' || key === 'escape' || key === ' '))) return

    if (key === 'm' && !isTransforming.value) {
      if (!e.repeat) {
        setGuideMode(guideMode.value === 'none' ? 'delete' : 'none')
        editGuideAtPointer()
      }
      e.preventDefault()
      return
    }
    if (guideMode.value !== 'none') {
      if (isAxisKey) {
        if (!e.repeat) {
          setGuideMode(guideMode.value === key ? 'delete' : key)
          editGuideAtPointer()
        }
        e.preventDefault()
      }
      return
    }

    // g / s / r / l 进入变换模式（l = 注视）
    if (e.key === 'g' || e.key === 's' || e.key === 'r' || e.key === 'l') {
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

    // 注视模式下：屏蔽轴锁定 / 其它模式切换（l 键已在上面处理）
    if (transformMode.value === 'l') {
      if (e.key === 'x' || e.key === 'y' || e.key === 'g' || e.key === 's' || e.key === 'r') {
        e.preventDefault()
      }
      return
    }

    // 变换中：x / y 锁定轴，并把未锁轴回滚到起点
    if (isTransforming.value && isAxisKey) {
      if (store.selectedId === SpecialId.Camera && transformMode.value === 's') {
        e.preventDefault()
        return
      }
      e.preventDefault()
      if (e.repeat) return
      axisLock.value = axisLock.value === key ? 'none' : key
      if (transformMode.value === 'g') {
        updateMoveAlt(e)
        return
      }
      if (isCurrentFigureGroup()) {
        // 立绘组模式：把 groupContainer 的"未锁定轴"回滚到起点
        const gid = store.selectedId
        if (gid && isFigureGroupId(gid)) {
          const gc = groupContainers.get(gid)
          if (gc) {
            // 回滚后强制让 PIXI 重新计算 child 的世界矩阵，方便后续 mouse move 继续作用
            if (transformMode.value === 's') {
              gc.scale.x = groupStartScaleX
              gc.scale.y = groupStartScaleY
            } else if (transformMode.value === 'r') {
              gc.rotation = groupStartRotation
            }
            if (stageMain) stageMain.updateTransform()
            updateTransformVisual()
          }
        }
        return
      }
      const target = getTransformTarget()
      if (target) {
        if (transformMode.value === 's') {
          if (axisLock.value === 'x') target.scale.y = startScaleY
          else if (axisLock.value === 'y') target.scale.x = startScaleX
          else {
            target.scale.x = startScaleX
            target.scale.y = startScaleY
          }
        }
      }
      updateTransformVisual()
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

  const onKeyUp = (e: KeyboardEvent) => {
    if (!props.interactionDisabled && transformMode.value === 'g' && e.key === 'Alt') {
      updateMoveAlt(e)
      e.preventDefault()
    }
    if (!props.interactionDisabled && transformMode.value === 'r' && e.key === 'Alt') {
      applyRotation(false)
      e.preventDefault()
    }
  }

  const onBlur = () => {
    isMiddleDown = false
    onCanvasLeave()
    if (altHeldInMove.value) {
      altHeldInMove.value = false
      if (!props.interactionDisabled && isGuideMove.value) applyMove(false)
      else updateMoveCrosshair()
    }
    if (!props.interactionDisabled && transformMode.value === 'r') applyRotation(false)
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('blur', closeTargetMenu)
  window.addEventListener('resize', closeTargetMenu)

  // Save for cleanup
  previewRuntime.cleanup = () => {
    closeRadialMenu()
    window.removeEventListener('pointerdown', onRadialPointerDown, true)
    window.removeEventListener('pointermove', onRadialPointerMove, true)
    window.removeEventListener('pointerup', onRadialPointerUp, true)
    window.removeEventListener('pointercancel', onRadialPointerUp, true)
    window.removeEventListener('keydown', onRadialKeyDown, true)
    window.removeEventListener('keyup', onRadialKeyUp, true)
    window.removeEventListener('wheel', onRadialWheel, true)
    window.removeEventListener('contextmenu', onRadialContextMenu, true)
    window.removeEventListener('click', onRadialClick, true)
    window.removeEventListener('auxclick', onRadialClick, true)
    window.removeEventListener('blur', closeRadialMenu)
    window.removeEventListener('resize', closeRadialMenu)
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('pointerenter', onCanvasEnter)
    canvas.removeEventListener('pointerleave', onCanvasLeave)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('blur', closeTargetMenu)
    window.removeEventListener('resize', closeTargetMenu)
  }
}

function fitBackground() {
  const sprite = backgroundSprite.value
  if (!sprite || !backgroundContainer) return
  const w = STAGE_WIDTH
  const h = STAGE_HEIGHT
  const texture = sprite.texture.baseTexture

  // 原始图片尺寸
  const imgW = texture.width
  const imgH = texture.height

  // 计算等比缩放，保证填满 backgroundContainer，短边刚好顶到边缘
  const scale = Math.max(w / imgW, h / imgH)

  sprite.width = imgW * scale
  sprite.height = imgH * scale

  // 居中
  sprite.x = w / 2
  sprite.y = h / 2
}

function applyBackgroundTexture(texture: PIXI.Texture) {
  if (!backgroundContainer) return
  if (backgroundSprite.value) {
    backgroundContainer.removeChild(backgroundSprite.value)
    backgroundSprite.value.destroy({ texture: true, baseTexture: true })
    backgroundSprite.value = null
  }
  const sprite = new PIXI.Sprite(texture)
  sprite.anchor.set(0.5)
  backgroundContainer.addChildAt(sprite, 0)
  backgroundSprite.value = sprite
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
    } else await loadDefaultBackground()
  },
  { immediate: true }
)

function dispose() {
  closeTargetMenu()
  stopObservingViewport?.()
  stopObservingViewport = null

  if (backgroundSprite.value) {
    backgroundSprite.value.parent?.removeChild(backgroundSprite.value)
    backgroundSprite.value.destroy({ texture: true, baseTexture: true })
    backgroundSprite.value = null
  }

  for (const id of [...containersById.keys()]) {
    removeOne(id)
  }

  // 兜底销毁任何遗留的 dummy（正常流程 endTransform/cancelTransform 时已清空）
  for (const entry of groupDummyEntries) {
    entry.dummy.destroy()
  }
  groupDummyEntries = []

  for (const c of groupContainers.values()) {
    c.destroy({ children: true })
  }
  groupContainers.clear()
  if (frameContainer) {
    frameContainer.destroy({ children: true })
    frameContainer = null
  }
  guideGraphics = null
  frameLines = cameraLines = null
  moveCrosshair = null

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
  isMiddleDown = false

  previewRuntime.specialContainers.clear()
  previewRuntime.wmdlSubModels.clear()
  previewRuntime.app = null
  previewRuntime.cleanup = () => {}
}
</script>

<template>
  <section class="stage" @contextmenu.prevent>
    <div ref="containerRef" class="stage__canvas" :class="guideCursor" />
    <StageRadialMenu v-if="radialMenu" v-bind="radialMenu" />
    <Teleport to="body">
      <div v-if="targetMenu" class="target-menu-backdrop" @pointerdown.stop.prevent @click.stop.prevent @contextmenu.prevent />
      <Transition name="target-menu">
        <div
          v-if="targetMenu"
          ref="targetMenuRef"
          class="target-menu"
          :style="{ left: `${targetMenu.x}px`, top: `${targetMenu.y}px` }"
          role="listbox"
          aria-label="选择舞台对象"
          tabindex="0"
          @pointerdown.stop
          @pointermove="onTargetMenuPointerMove"
          @contextmenu.prevent
          @keydown="onTargetMenuKeydown"
        >
          <div class="target-menu__title">移至目标后松开右键选择</div>
          <div
            v-for="(option, index) in targetMenu.options"
            :key="option.id"
            class="target-menu__option"
            :class="{ 'is-active': index === targetMenuActive, 'is-selected': option.id === store.selectedId }"
            :data-active="index === targetMenuActive"
            :data-target-index="index"
            role="option"
            :aria-selected="option.id === store.selectedId"
            @click.stop.prevent
          >
            <span class="target-menu__name" :title="option.name">{{ option.name }}</span>
            <span v-if="option.id === store.selectedId" class="target-menu__check" aria-hidden="true">✓</span>
          </div>
        </div>
      </Transition>
    </Teleport>
    <svg v-if="transformVisual" class="stage__transform-visual" aria-hidden="true">
      <template v-if="transformVisual.mode === 'g'">
        <line v-if="Math.hypot(transformVisual.current.x - transformVisual.origin.x, transformVisual.current.y - transformVisual.origin.y) > 1"
          class="transform-visual__line transform-visual__line--dashed"
          :x1="transformVisual.origin.x" :y1="transformVisual.origin.y"
          :x2="transformVisual.current.x" :y2="transformVisual.current.y" />
        <circle v-if="Math.hypot(transformVisual.current.x - transformVisual.origin.x, transformVisual.current.y - transformVisual.origin.y) > 8"
          class="transform-visual__point" :cx="transformVisual.current.x" :cy="transformVisual.current.y" r="4" />
      </template>
      <template v-else-if="transformVisual.start && transformVisual.end">
        <line class="transform-visual__line transform-visual__line--reference"
          :x1="transformVisual.origin.x" :y1="transformVisual.origin.y"
          :x2="transformVisual.start.x" :y2="transformVisual.start.y" />
        <line class="transform-visual__line"
          :x1="transformVisual.origin.x" :y1="transformVisual.origin.y"
          :x2="transformVisual.end.x" :y2="transformVisual.end.y" />
        <template v-if="transformVisual.mode === 'r'">
          <path v-if="transformVisual.arc" class="transform-visual__line" :d="transformVisual.arc" />
          <polygon v-if="transformVisual.arrow" class="transform-visual__point" :points="transformVisual.arrow" />
        </template>
        <template v-else>
          <circle class="transform-visual__reference" :cx="transformVisual.start.x" :cy="transformVisual.start.y" r="7" />
          <circle class="transform-visual__point" :cx="transformVisual.end.x" :cy="transformVisual.end.y" r="4" />
          <text v-if="transformVisual.axis" class="transform-visual__axis" :x="transformVisual.end.x + 10" :y="transformVisual.end.y - 8">{{ transformVisual.axis }}</text>
        </template>
      </template>
      <circle class="transform-visual__origin" :cx="transformVisual.origin.x" :cy="transformVisual.origin.y" r="6" />
    </svg>
    <!-- 变换操作遮罩 -->
    <div
      v-if="isTransforming"
      class="stage__overlay"
    />
    <!-- 变换操作提示（替换原有 hints） -->
    <div v-if="isTransforming" class="stage__transform-hint">
      <div class="transform-hint__title">正在{{ transformHint.modeName }}</div>
      <div class="transform-hint__line">移动鼠标调整 · <kbd>左键</kbd> 确定 · <kbd>右键</kbd> 取消</div>
      <div v-if="transformMode !== 'r'" class="transform-hint__line"><kbd>X</kbd> / <kbd>Y</kbd> 锁轴，未锁轴回滚到起点</div>
      <div v-if="isGuideMove" class="transform-hint__line"><kbd>Alt</kbd> 显示准星与游标并吸附（{{ GUIDE_SNAP_PX }} px）</div>
      <div v-if="transformMode === 'r'" class="transform-hint__line"><kbd>Alt</kbd> 按 {{ rotationSnap }}° 间隔吸附</div>
      <dl class="transform-hint__values">
        <template v-if="transformMode !== 'r'"><dt>锁定轴</dt><dd>{{ transformHint.axis }}</dd></template>
        <dt>X</dt><dd>{{ transformHint.x }}</dd>
        <dt>Y</dt><dd>{{ transformHint.y }}</dd>
        <template v-if="transformMode !== 'g'">
          <dt>缩放 X</dt><dd>{{ transformHint.scaleX }}</dd>
          <dt>缩放 Y</dt><dd>{{ transformHint.scaleY }}</dd>
          <dt>旋转</dt><dd>{{ transformHint.rotationDeg }}°</dd>
        </template>
      </dl>
    </div>
    <div v-else-if="guideMode !== 'none'" class="stage__transform-hint stage__guide-hint">
      <div class="transform-hint__title">舞台游标</div>
      <div v-if="guideMode === 'delete'" class="transform-hint__line">删除模式：左键点中游标删除</div>
      <div v-else class="transform-hint__line">在绿框内左键放置{{ guideMode === 'x' ? '竖线（X）' : '横线（Y）' }}</div>
      <div class="transform-hint__line">X / Y 切换放置，再按同键回到删除；M 或右键退出</div>
    </div>
    <!-- 左上角：复制指令的 -next 后处理模式 -->
    <div v-if="!isTransforming" class="stage__next-mode">
      <label class="stage__next-mode-label" for="stage-next-mode-select">next 后处理:</label>
      <ThemeSelect
        id="stage-next-mode-select"
        class="stage__next-mode-select"
        :model-value="nextMode"
        :options="NEXT_ARG_MODE_OPTIONS"
        compact
        @update:model-value="onNextModeChange"
      />
    </div>
    <div v-if="!store.models.length && (!backgroundSprite || !store.backgroundUrl) && !isTransforming && guideMode === 'none'" class="stage__empty">
      <div class="stage__empty-card">
        <UiIcon name="model" />
        <strong>开始搭建你的舞台</strong>
        <p>加载模型或图片，也可从左侧「项目」打开已有项目。</p>
        <div class="stage__empty-actions">
          <button class="ui-button ui-button--primary" @click="store.addFromPicker()"><UiIcon name="model" />加载模型</button>
          <button class="ui-button" @click="store.addImageFigure()"><UiIcon name="image" />加载图片</button>
        </div>
      </div>
    </div>
    <div v-if="!isTransforming && guideMode === 'none'" class="stage__bottom-blocks">
      <div class="stage__hints">
        <button
          type="button"
          class="ui-button stage__hints-toggle"
          :aria-expanded="hintsExpanded"
          :aria-label="hintsExpanded ? '收起操作提示' : '展开操作提示'"
          @click="toggleHints"
        >
          <span class="stage__hints-toggle-text">{{ hints.title }}</span>
          <UiIcon :name="hintsExpanded ? 'down' : 'right'" />
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
            <h4 class="stage__hints-heading">快捷键 · 可点击触发</h4>
            <ul class="stage__hints-list">
              <li v-for="item in hints.shortcuts" :key="item.entry.handlerKey + '-' + item.keys">
                <button
                  type="button"
                  class="stage__hints-item"
                  :title="`点击触发 ${item.keys}`"
                  @click="onShortcutClick($event, item.entry)"
                >
                  <kbd class="stage__hints-keys">{{ item.keys }}</kbd>
                  <span class="stage__hints-desc">{{ item.description }}</span>
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.target-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 19998;
}
.target-menu {
  position: fixed;
  z-index: 19999;
  width: min(240px, calc(100vw - 8px));
  max-height: min(320px, calc(100vh - 8px));
  overflow-y: auto;
  padding: 6px;
  color: var(--ui-text);
  background: var(--ui-menu-fill);
  border: 1px solid var(--ui-edge);
  border-radius: var(--ui-radius-control);
  box-shadow: var(--ui-panel-shadow);
  outline: none;
  transform-origin: top left;
}
.target-menu__title {
  padding: 5px 10px 7px;
  font-size: 12px;
  opacity: 0.65;
}
.target-menu__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: var(--ui-radius-compact);
  cursor: pointer;
}
.target-menu__option.is-active { background: var(--ui-hover); }
.target-menu__option.is-selected { color: var(--ui-link); }
.target-menu__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.target-menu__check { flex: none; }
.target-menu-enter-active, .target-menu-leave-active { transition: opacity 120ms ease, transform 120ms ease; }
.target-menu-enter-from, .target-menu-leave-to { opacity: 0; transform: scale(0.97); }
.target-menu-leave-active { pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .target-menu-enter-active, .target-menu-leave-active { transition: none; }
}
.stage {
  position: relative;
  height: 100%;
  background: var(--ui-stage-fill);
  overflow: hidden;
}

.stage__canvas {
  position: absolute;
  inset: 0;
  cursor: default;
}

.stage__canvas :deep(canvas) {
  display: block;
}

.stage__transform-visual {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 4;
  pointer-events: none;
  overflow: hidden;
  filter: drop-shadow(0 0 2px #000) drop-shadow(0 0 1px #000);
}

.transform-visual__line {
  fill: none;
  stroke: var(--ui-warning);
  stroke-width: 2;
  stroke-linecap: round;
}

.transform-visual__line--dashed {
  stroke-dasharray: 7 5;
}

.transform-visual__line--reference {
  opacity: 0.55;
  stroke-dasharray: 3 4;
}

.transform-visual__origin,
.transform-visual__point {
  fill: var(--ui-warning);
  stroke: #fff;
  stroke-width: 1.5;
}

.transform-visual__reference {
  fill: var(--ui-stage-fill);
  stroke: #fff;
  stroke-width: 2;
}

.transform-visual__axis {
  fill: #fff;
  font-size: 13px;
  font-weight: 700;
}

.stage__canvas--guide-add {
  cursor: url('../../assets/cursors/guide-add.svg') 12 12, crosshair;
}

.stage__canvas--guide-delete {
  cursor: url('../../assets/cursors/guide-delete.svg') 3 3, pointer;
}

.stage__canvas--guide-blocked {
  cursor: not-allowed;
}

.stage__overlay {
  position: absolute;
  inset: 0;
  background: transparent;
  z-index: 5;
  cursor: crosshair;
}

.stage__transform-hint {
  font-variant-numeric: tabular-nums;
  box-sizing: border-box;
  max-width: calc(100% - 32px - var(--preview-stage-left-inset, 0px) - var(--preview-action-obstruction, var(--preview-action-width, 0px)));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  position: absolute;
  left: calc(16px + var(--preview-stage-left-inset, 0px));
  bottom: 16px;
  padding: 12px 16px;
  background: var(--ui-floating);
  border: 1px solid var(--ui-control-line);
  border-radius: var(--ui-radius-panel);
  box-shadow: var(--ui-panel-shadow);
  color: var(--ui-text);
  font-size: 13px;
  line-height: 1.6;
  z-index: 10;
  text-shadow: none;
  user-select: none;
}

.stage__guide-hint {
  pointer-events: none;
}

.transform-hint__title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--ui-warning);
}

.transform-hint__line + .transform-hint__line {
  margin-top: 2px;
}

.stage__empty {
  position: absolute;
  inset: 0;
  right: var(--preview-action-obstruction, var(--preview-action-width, 0px));
  display: grid;
  place-items: center;
  pointer-events: none;
  padding: 24px;
}
.stage__empty-card {
  max-width: 340px;
  padding: 22px;
  border: 1px solid var(--ui-control-line);
  border-radius: var(--ui-radius-panel);
  background: var(--ui-stage-glass);
  box-shadow: var(--ui-panel-shadow);
  color: var(--ui-muted);
  font-size: 13px;
  text-align: center;
}
.stage__empty-card > .ui-symbol { font-size: 28px; color: var(--ui-link); margin-bottom: 10px; }
.stage__empty-card strong { display: block; color: var(--ui-text); font-size: 16px; }
.stage__empty-card p { line-height: 1.7; }
.stage__empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.stage__empty-actions button { pointer-events: auto; padding: 8px 12px; }
.transform-hint__line kbd {
  padding: 1px 5px;
  border: 1px solid var(--ui-control-line);
  border-radius: var(--ui-radius-compact);
  background: var(--ui-control);
  color: var(--ui-link);
  font: inherit;
  font-size: 11px;
}
.transform-hint__values { display: grid; grid-template-columns: auto minmax(70px, 1fr); gap: 2px 24px; margin: 10px 0 0; padding-top: 8px; border-top: 1px solid var(--ui-line); }
.transform-hint__values dt { color: var(--ui-muted); }
.transform-hint__values dd { margin: 0; text-align: right; }

.stage__next-mode {
  position: absolute;
  top: 12px;
  left: calc(12px + var(--preview-stage-left-inset, 0px));
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 12px;
  background: var(--ui-floating);
  border: 1px solid var(--ui-control-line);
  border-radius: var(--ui-radius-control);
  box-shadow: var(--ui-control-shadow);
  font-size: 13px;
  line-height: 1.5;
  color: var(--ui-text);
  text-shadow: none;
  user-select: none;
}

.stage__next-mode-label {
  font-weight: 600;
}

.stage__next-mode-select {
  pointer-events: auto;
  font: inherit;
  width: 130px;
}

.stage__bottom-blocks {
  position: absolute;
  left: calc(16px + var(--preview-stage-left-inset, 0px));
  bottom: 16px;
  max-width: calc(100% - 32px - var(--preview-stage-left-inset, 0px) - var(--preview-action-obstruction, var(--preview-action-width, 0px)));
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  pointer-events: none; /* 正文不拦截舞台操作，仅按钮可点击 */
}

.stage__hints {
  max-width: 100%;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ui-text);
  text-shadow: none;
  user-select: none;
}

.stage__hints-toggle {
  pointer-events: auto;
  padding: 7px 10px;
  font: inherit;
}

.stage__hints-toggle-text {
  font-weight: 600;
}

.stage__hints-body {
  box-sizing: border-box;
  max-height: calc(100vh - 140px);
  overflow-y: auto;
  overscroll-behavior: contain;
  pointer-events: auto;
  margin-top: 6px;
  padding: 12px 15px;
  background: var(--ui-stage-glass);
  backdrop-filter: blur(6px);
  border: 1px solid var(--ui-control-line);
  border-radius: var(--ui-radius-panel);
  box-shadow: 0 5px 18px var(--ui-shadow);
  width: 424px;
  max-width: 100%;
}

.stage__hints-group + .stage__hints-group {
  margin-top: 6px;
  padding-top: 5px;
  border-top: 1px solid var(--ui-control-line);
}

.stage__hints-heading {
  margin: 0 0 4px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-warning);
  letter-spacing: 0.5px;
}

.stage__hints-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.stage__hints-list li:has(> .stage__hints-keys),
.stage__hints-item {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
}

.stage__hints-item {
  pointer-events: auto;
  width: 100%;
  padding: 3px 0;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  border-radius: var(--ui-radius-compact);
  cursor: pointer;
  text-shadow: none;
}

.stage__hints-item:hover,
.stage__hints-item:focus-visible {
  background: var(--ui-hover);
}

.stage__hints-keys {
  font-weight: 600;
  color: var(--ui-link);
}

.stage__hints-item kbd {
  justify-self: start;
  min-width: 38px;
  padding: 0 8px;
  border-radius: var(--ui-radius-pill);
  background: var(--ui-selected);
  color: var(--ui-shortcut-ink);
  font-family: inherit;
}
</style>
