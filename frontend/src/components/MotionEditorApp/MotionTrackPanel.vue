<script setup lang="ts">
/**
 * 动作编辑器的轨道面板：参数列表与时间轴的合并视图。
 *
 * 结构：左右两列。
 *   左列（固定宽 260px）= 行头（标尺信息 + 参数卡片），overflow: hidden，
 *     垂直滚动通过响应右列 scroll 事件用 translateY 同步。
 *   右列 = 标尺 + 车道，双向 overflow: auto，横向滚动只影响车道。
 * 播放头是外层覆盖层（不参与滚动），left 随右列 scrollLeft 修正。
 *
 * 帧制：底层一切以整数帧号运算（fps/durationFrames 存于 store.lanim）。
 *  - 拖拽车道/标尺 → 播放头帧吸附
 *  - 双击车道 → 当前帧插关键帧（值 = 当前采样值）
 *  - 拖拽关键帧 → 帧吸附；右键删除
 *  - 拖动参数卡片 → 实时写模型预览 + 当前帧打帧（已有轨道时）
 *  - 行头显示值：有轨道时 = 当前帧采样值，随播放头刷新
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SearchInput from '../common/SearchInput.vue'
import EditRangeCard from '../ModelEditApp/EditRangeCard.vue'
import ResizeHandle from '../ModelEditApp/ResizeHandle.vue'
import { listParameters, type ParamEntry } from '../../live2d/coreAdapter'
import { filterBySearch } from '../../utils/searchUtils'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { useMotionEditorStore, sampleTrack } from '../../stores/motionEditor'
import { useFrameSettingsModal } from '../../composables/useFrameSettingsModal'

const wmdlStore = useWmdlModelEditorStore()
const store = useMotionEditorStore()
const frameModal = useFrameSettingsModal()

const search = ref('')
const params = ref<ParamEntry[]>([])

const pollTimer = window.setInterval(refreshParams, 500)

function refreshParams() {
  if (!wmdlStore.currentWmdl.models.length) return
  const next = listParameters(wmdlStore.selectedModelId)
  const prev = params.value
  if (
    prev.length !== next.length ||
    (prev.length && (prev[0].id !== next[0].id || prev[prev.length - 1].id !== next[next.length - 1].id))
  ) {
    params.value = next
    const ranges: Record<string, [number, number]> = {}
    for (const p of next) ranges[p.id] = [p.min, p.max]
    store.paramRanges = ranges
    store.sortTracksByParamOrder(next.map((p) => p.id))
  }
  for (const p of next) {
    if (!(p.id in store.liveValues)) store.liveValues[p.id] = p.value
  }
}

onBeforeUnmount(() => window.clearInterval(pollTimer))

const filtered = computed(() => filterBySearch(params.value, search.value, (p) => p.id))

function isTracked(id: string): boolean {
  return store.trackParamIds.has(id)
}

function trackOf(id: string) {
  return store.lanim.tracks.find((tr) => tr.paramId === id) ?? null
}

/** 行头卡片显示值：有轨道 → 当前帧采样值；无轨道 → 实时值。 */
function displayValue(p: ParamEntry): number {
  const track = trackOf(p.id)
  if (track && track.keys.length) return sampleTrack(track.keys, store.playhead)
  return store.liveValues[p.id] ?? p.value
}

function onValueChange(p: ParamEntry, v: number) {
  store.applyLiveValue(p.id, v)
}

function onToggleTrack(p: ParamEntry) {
  if (isTracked(p.id)) {
    store.removeTrack(p.id)
  } else {
    store.addTrack(p.id)
    store.upsertKeyframe(p.id, store.playhead, displayValue(p))
  }
}

/** 当前播放头帧上该参数轨道是否有关键帧（控制行头删帧按钮显隐）。 */
function hasKeyAtPlayhead(p: ParamEntry): boolean {
  const track = trackOf(p.id)
  if (!track) return false
  return track.keys.some((k) => k.frame === store.playhead)
}

function onRemoveKeyAtPlayhead(p: ParamEntry) {
  store.removeKeyframeNear(p.id, store.playhead)
}

/** 双击帧点：把播放头移动到该帧。 */
function onKeyframeDblClick(frame: number, e: MouseEvent) {
  e.stopPropagation()
  store.playhead = frame
}

// ── 帧几何 ──────────────────────────────────────────────────────────────────

/** 行头宽度（可拖拽调整）。 */
const HEAD_MIN = 180
const HEAD_MAX = 460
const headWidth = ref(260)
/** 行高固定像素，保证左右两列一一平齐。 */
const RULER_H = 26
const ROW_H = 70

const lanesEl = ref<HTMLElement | null>(null)
const lanesInnerWidth = ref(800)
/** 右列横向滚动量（播放头覆盖层坐标修正用）。 */
const scrollLeft = ref(0)
/** lanes 容器相对 body 的横向起点（含 ResizeHandle 宽度，布局变化时自动刷新）。 */
const lanesOffsetX = ref(0)

/** 车道右侧安全距离（px），不参与帧映射。 */
const SAFE_TAIL_PX = 120

/** 像素/帧缩放；null = 自动适配面板宽度。Ctrl 滚轮缩放后为固定值。 */
const PPF_MIN = 0.5
const PPF_MAX = 40
const pxPerFrame = ref<number | null>(null)
const userZoomed = ref(false)

const durationFrames = computed(() => Math.max(1, store.lanim.durationFrames))

function fitPxPerFrame(): number {
  return Math.max(PPF_MIN, (lanesInnerWidth.value - SAFE_TAIL_PX) / durationFrames.value)
}

function effectivePpf(): number {
  return pxPerFrame.value ?? fitPxPerFrame()
}

function refreshWidth() {
  const el = lanesEl.value
  if (!el) return
  lanesInnerWidth.value = Math.max(200, el.clientWidth)
  lanesOffsetX.value = el.offsetLeft
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  refreshWidth()
  if (typeof ResizeObserver !== 'undefined' && lanesEl.value) {
    resizeObserver = new ResizeObserver(refreshWidth)
    resizeObserver.observe(lanesEl.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('mousemove', onWindowMove)
  window.removeEventListener('mouseup', onWindowUp)
})

function onLanesScroll() {
  const el = lanesEl.value
  if (!el) return
  scrollLeft.value = el.scrollLeft
  // 同步左列垂直滚动
  if (headEl.value) headEl.value.style.transform = `translateY(${-el.scrollTop}px)`
}

// 时长变化时，非手动缩放状态下重新适配面板宽度
watch(durationFrames, () => {
  if (!userZoomed.value) pxPerFrame.value = null
})

/** 车道内层总宽 = 帧区（缩放后）+ 右侧安全距离。 */
const laneContentWidth = computed(() => durationFrames.value * effectivePpf() + SAFE_TAIL_PX)

/** 帧 → 车道内横向像素（基于帧区，不含安全距离）。 */
function f2x(f: number): number {
  return f * effectivePpf()
}

/** 客户端 X → 帧号（整数吸附，clamp 到 [0, durationFrames]）。 */
function x2f(clientX: number): number {
  const el = lanesEl.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
  const f = (x + scrollLeft.value) / Math.max(0.0001, effectivePpf())
  return Math.max(0, Math.min(durationFrames.value, Math.round(f)))
}

/** 刻度帧间隔：从 1/2/5×10ⁿ 序列中取使每格 ≥ 80px 的最小档位（密度固定，不随宽度变）。 */
const tickStep = computed(() => {
  const ppf = effectivePpf()
  const minPx = 80
  let base = 1
  for (;;) {
    for (const m of [1, 2, 5]) {
      if (base * m * ppf >= minPx) return base * m
    }
    base *= 10
  }
})

/** 标尺刻度：固定密度（tickStep 档位），覆盖到帧区末尾。 */
const ticks = computed(() => {
  const out: number[] = []
  const step = tickStep.value
  for (let f = 0; f <= durationFrames.value; f += step) out.push(f)
  return out
})

/** Ctrl + 滚轮：以鼠标所在帧为中心缩放刻度密度。 */
function onLanesWheel(e: WheelEvent) {
  if (!e.ctrlKey) return
  e.preventDefault()
  const el = lanesEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  // 鼠标下的帧（缩放锚点）
  const anchorX = e.clientX - rect.left
  const anchorFrame = (anchorX + el.scrollLeft) / Math.max(0.0001, effectivePpf())
  const old = effectivePpf()
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
  const next = Math.max(PPF_MIN, Math.min(PPF_MAX, old * factor))
  if (next === old) return
  userZoomed.value = true
  pxPerFrame.value = next
  // 补偿 scrollLeft：锚点帧保持在鼠标下方
  el.scrollLeft = anchorFrame * next - anchorX
  scrollLeft.value = el.scrollLeft
}

function fmtTime(frame: number): string {
  const fps = store.lanim.fps || 60
  return (frame / fps).toFixed(2)
}

// ── 拖拽（播放头 / 关键帧） ─────────────────────────────────────────────────

interface DragState {
  kind: 'key' | 'playhead'
  paramId?: string
  fromFrame?: number
}

let drag: DragState | null = null

function onWindowMove(e: MouseEvent) {
  if (!drag) return
  const f = x2f(e.clientX)
  if (drag.kind === 'playhead') {
    store.playhead = f
  } else if (drag.kind === 'key' && drag.paramId !== undefined && drag.fromFrame !== undefined) {
    store.moveKeyframe(drag.paramId, drag.fromFrame, f)
    drag.fromFrame = f
  }
}

function onWindowUp() {
  drag = null
  window.removeEventListener('mousemove', onWindowMove)
  window.removeEventListener('mouseup', onWindowUp)
}

function beginDrag(state: DragState, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  drag = state
  window.addEventListener('mousemove', onWindowMove)
  window.addEventListener('mouseup', onWindowUp)
  if (state.kind === 'playhead') {
    store.playhead = x2f(e.clientX)
  }
}

function onRulerDown(e: MouseEvent) {
  beginDrag({ kind: 'playhead' }, e)
}

function onLaneDblClick(paramId: string, e: MouseEvent) {
  const track = trackOf(paramId)
  if (!track) return
  const f = x2f(e.clientX)
  if (track.keys.some((k) => k.frame === f)) return
  store.selectedTrackId = paramId
  store.upsertKeyframe(paramId, f, sampleTrack(track.keys, f))
}

function onKeyframeDown(paramId: string, frame: number, e: MouseEvent) {
  store.selectedTrackId = paramId
  beginDrag({ kind: 'key', paramId, fromFrame: frame }, e)
}

function onKeyframeContext(paramId: string, frame: number, e: MouseEvent) {
  e.preventDefault()
  store.removeKeyframeNear(paramId, frame)
}

// 左列垂直同步目标
const headEl = ref<HTMLElement | null>(null)

function onHeadDrag(dx: number) {
  headWidth.value = Math.max(HEAD_MIN, Math.min(HEAD_MAX, headWidth.value + dx))
}
</script>

<template>
  <div class="track-panel">
    <div class="track-panel__search">
      <SearchInput v-model="search" variant="edit" placeholder="搜索参数..." />
      <button
        type="button"
        class="track-panel__settings"
        title="帧率与时长设置"
        @click="frameModal.open()"
      >
        {{ store.lanim.fps }}fps · {{ store.lanim.durationFrames }}帧 ({{ fmtTime(store.lanim.durationFrames) }}s)
      </button>
    </div>
    <div class="track-panel__body">
      <!-- 左列：行头（垂直滚动由右列 scroll 事件同步） -->
      <div class="track-panel__heads" :style="{ width: headWidth + 'px' }">
        <div ref="headEl" class="track-panel__heads-inner">
          <div class="head-row head-row--ruler" :style="{ height: RULER_H + 'px' }">
            <span class="head-row__ruler-info">{{ store.playhead }}帧 ({{ fmtTime(store.playhead) }}s)</span>
          </div>
          <div
            v-for="p in filtered"
            :key="p.id"
            class="head-row"
            :class="{ 'is-selected': store.selectedTrackId === p.id }"
            :style="{ height: ROW_H + 'px' }"
          >
            <EditRangeCard
              :name="p.id"
              :min="p.min"
              :max="p.max"
              :model-value="displayValue(p)"
              :highlight="isTracked(p.id)"
              @update:model-value="onValueChange(p, $event)"
            />
            <button
              v-if="hasKeyAtPlayhead(p)"
              type="button"
              class="head-row__btn head-row__btn--del"
              :title="`移除第 ${store.playhead} 帧的关键帧`"
              @click.stop="onRemoveKeyAtPlayhead(p)"
            >
              ✕
            </button>
            <button
              type="button"
              class="head-row__btn"
              :class="{ 'is-tracked': isTracked(p.id) }"
              :title="isTracked(p.id) ? '移除轨道' : '添加为轨道（当前帧插帧）'"
              @click.stop="onToggleTrack(p)"
            >
              {{ isTracked(p.id) ? '−' : '+' }}
            </button>
          </div>
        </div>
      </div>
      <ResizeHandle side="right" @drag="onHeadDrag" />
      <!-- 右列：标尺 + 车道（双向滚动；Ctrl+滚轮缩放刻度密度） -->
      <div ref="lanesEl" class="track-panel__lanes" @scroll="onLanesScroll" @wheel="onLanesWheel">
        <div class="track-panel__lanes-inner" :style="{ width: laneContentWidth + 'px' }">
          <!-- 标尺 -->
          <div class="lane-row lane-row--ruler" :style="{ height: RULER_H + 'px' }" @mousedown="onRulerDown">
            <div
              v-for="f in ticks"
              :key="f"
              class="lane-row__tick"
              :style="{ left: f2x(f) + 'px' }"
            >
              <span class="lane-row__tick-label">{{ f }}</span>
            </div>
          </div>
          <!-- 车道 -->
          <div
            v-for="p in filtered"
            :key="p.id"
            class="lane-row"
            :class="{ 'is-selected': store.selectedTrackId === p.id }"
            :style="{ height: ROW_H + 'px' }"
            @dblclick="onLaneDblClick(p.id, $event)"
          >
            <template v-if="isTracked(p.id)">
              <div
                v-for="key in trackOf(p.id)?.keys ?? []"
                :key="key.frame"
                class="lane-row__key"
                :style="{ left: f2x(key.frame) + 'px' }"
                title="拖动改帧 / 双击移动播放头 / 右键删除"
                @mousedown="onKeyframeDown(p.id, key.frame, $event)"
                @dblclick.stop="onKeyframeDblClick(key.frame, $event)"
                @contextmenu="onKeyframeContext(p.id, key.frame, $event)"
              />
            </template>
          </div>
        </div>
      </div>
      <!-- 播放头覆盖层（不随滚动；left 随 lanesOffsetX/scrollLeft 修正） -->
      <div
        class="track-panel__playhead"
        :style="{
          left: `calc(${lanesOffsetX}px + ${f2x(store.playhead) - scrollLeft}px)`,
          top: RULER_H + 'px',
        }"
      />
    </div>
    <div v-if="!filtered.length" class="track-panel__empty">无匹配参数</div>
  </div>
</template>

<style scoped>
.track-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #20242c;
}

.track-panel__search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  flex-shrink: 0;
}

.track-panel__settings {
  flex-shrink: 0;
  padding: 5px 10px;
  background: #2c313a;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #cfd4dc;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.track-panel__settings:hover {
  border-color: #2f80ed;
  color: #5fa8ff;
}

.track-panel__body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 左列：行头（层级高于播放头，红线只出现在车道区） */
.track-panel__heads {
  position: relative;
  z-index: 4;
  flex-shrink: 0;
  overflow: hidden;
  border-right: 1px solid #3a4150;
  background: #242830;
}

.track-panel__heads-inner {
  will-change: transform;
}

.head-row {
  position: relative;
  box-sizing: border-box;
  padding: 3px 26px 3px 4px;
  border-bottom: 1px solid #2c313a;
  display: flex;
  align-items: center;
}

/* 卡片固定尺寸：填满行内余下空间，不随内容伸缩 */
.head-row :deep(.range-card) {
  flex: 1;
  min-width: 0;
  height: calc(100% - 6px);
  overflow: hidden;
  gap: 3px;
  padding: 4px 8px;
}

.head-row.is-selected {
  background: #262d3a;
}

.head-row--ruler {
  padding: 0 8px;
  font-size: 11px;
  color: #8a93a3;
  position: sticky;
  top: 0;
  z-index: 2;
  background: #242830;
  box-sizing: border-box;
}

.head-row__ruler-info {
  font-variant-numeric: tabular-nums;
}

.head-row__btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid #3a4150;
  border-radius: 3px;
  background: #1d2026;
  color: #cfd4dc;
  cursor: pointer;
  line-height: 1;
  font-size: 12px;
}

.head-row__btn:hover {
  border-color: #2f80ed;
  color: #2f80ed;
}

.head-row__btn.is-tracked {
  border-color: rgba(47, 128, 237, 0.6);
  color: #5fa8ff;
}

/* 删帧按钮：由 v-if 控制显隐，出现本身即提示"已对准帧" */
.head-row__btn--del {
  right: 28px;
  color: #e0524f;
  border-color: rgba(224, 82, 79, 0.5);
}

.head-row__btn--del:hover {
  border-color: #e0524f;
  color: #ff7b78;
  background: rgba(224, 82, 79, 0.12);
}

/* 右列：标尺 + 车道 */
.track-panel__lanes {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.track-panel__lanes-inner {
  position: relative;
}

.lane-row {
  position: relative;
  border-bottom: 1px solid #2c313a;
  box-sizing: border-box;
}

.lane-row.is-selected {
  background: #262d3a;
}

.lane-row--ruler {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #20242c;
  cursor: ew-resize;
}

.lane-row__tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #3a4150;
}

.lane-row__tick-label {
  position: absolute;
  top: 4px;
  left: 3px;
  font-size: 10px;
  color: #6b7280;
  white-space: nowrap;
}

.lane-row__key {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #2f80ed;
  border: 1px solid #1a5bb8;
  cursor: ew-resize;
  transform: translate(-50%, -50%);
}

.lane-row__key:hover {
  background: #56a0ff;
}

/* 播放头覆盖层（层级低于行头列，高于车道） */
.track-panel__playhead {
  position: absolute;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: #e0524f;
  pointer-events: none;
  z-index: 2;
}

.track-panel__empty {
  flex-shrink: 0;
  padding: 24px 16px;
  color: #6b7280;
  font-size: 12px;
  text-align: center;
}
</style>
