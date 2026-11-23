<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { MotionPriority } from 'pixi-live2d-display-webgal'
import Live2dPreview from '../common/Live2dPreview.vue'
import SearchInput from '../common/SearchInput.vue'
import { useModelStore } from '../../stores/previewStore'
import { useMotionExpressionFolders } from '../../composables/useMotionExpressionFolders'
import { useDraggableScroll } from '../../composables/useDraggableScroll'
import { directoryContents, extractExpressions, extractMotions, nameSegments } from '../../utils/motionExpressionList'
import type { ExpressionInfo, MotionInfo } from '../../utils/motionExpressionList'
import { filterBySearch } from '../../utils/searchUtils'
import { useMessage } from '../../composables/useMessage'
import { configurePreviewPlaybackClocks } from '../../live2d/previewPlaybackClock'
import { useFocusPlaybackRate, MIN_FOCUS_PLAYBACK_RATE, MAX_FOCUS_PLAYBACK_RATE } from '../../composables/useFocusPlaybackRate'
import { captureModelParameters, restoreModelParameters } from '../../live2d/coreAdapter'
import type { ModelParameterSnapshot } from '../../live2d/coreAdapter'

const emit = defineEmits<{ (e: 'close'): void }>()
const store = useModelStore()
const folders = useMotionExpressionFolders()
const msg = useMessage()
const modelId = store.selectedId!
const entry = computed(() => store.models.find(item => item.id === modelId))
const preview = ref<InstanceType<typeof Live2dPreview> | null>(null)
const previewKey = ref(0)
const reloading = ref(false)
const ready = ref(false)
const failed = ref(false)
const rateSupported = ref(true)
const { savedRate, setRate } = useFocusPlaybackRate()
const rate = computed({
  get: () => rateSupported.value ? savedRate.value : 1,
  set: (value: number) => { if (rateSupported.value) setRate(value) },
})
const motions = ref<MotionInfo[]>([])
const expressions = ref<ExpressionInfo[]>([])
const motionPath = ref<string[]>([])
const expressionPath = ref<string[]>([])
const motionCollapsed = ref(false)
const expressionCollapsed = ref(false)
const motionSearch = computed({ get: () => store.motionSearch, set: (v: string) => store.setMotionSearch(v) })
const expressionSearch = computed({ get: () => store.expressionSearch, set: (v: string) => store.setExpressionSearch(v) })
const motionScroll = useDraggableScroll({ direction: 'horizontal' })
const expressionScroll = useDraggableScroll({ direction: 'horizontal' })
const motionDirectory = computed(() => directoryContents(motions.value, motionPath.value, motionSearch.value, folders.active.value, folders.settings.separator))
const expressionDirectory = computed(() => directoryContents(expressions.value, expressionPath.value, expressionSearch.value, folders.active.value, folders.settings.separator))
const sections = computed(() => [
  { type: 'motion' as const, title: '动作', collapsed: motionCollapsed.value, path: motionPath.value, search: motionSearch.value, directory: motionDirectory.value, scroll: motionScroll },
  { type: 'expression' as const, title: '表情', collapsed: expressionCollapsed.value, path: expressionPath.value, search: expressionSearch.value, directory: expressionDirectory.value, scroll: expressionScroll },
])
type Kind = 'motion' | 'expression'
type Item = MotionInfo | ExpressionInfo
let generation = 0
let pending = Promise.resolve()
let gesture: { type: Kind; key: string | null; original: Item | null; snapshots: ModelParameterSnapshot[] } | null = null
const gestureHint = ref<{ x: number; y: number; text: string } | null>(null)
const playSequence = { motion: 0, expression: 0 }

watch([() => folders.settings.enabled, () => folders.settings.separator], () => {
  motionPath.value = []
  expressionPath.value = []
})
watch(() => store.selectedId, id => { if (id !== modelId) emit('close') })

function itemKey(type: Kind, item: Item): string {
  return type === 'motion' ? `${(item as MotionInfo).group}:${item.index}` : String(item.index)
}
function isSelected(type: Kind, item: Item): boolean {
  const playing = entry.value?.playing
  if (type === 'motion') return playing?.motion?.group === (item as MotionInfo).group && playing.motion.index === item.index
  return playing?.expression?.index === item.index
}
function playPreview(type: Kind, item: Item | null, snapshots?: ModelParameterSnapshot[]) {
  const token = generation
  const sequence = ++playSequence[type]
  const models = preview.value?.getLoadedModels() ?? []
  pending = pending.catch(() => {}).then(async () => {
    if (token !== generation || sequence !== playSequence[type]) return
    for (const model of models) {
      if (token !== generation || sequence !== playSequence[type]) return
      const manager = model.internalModel.motionManager as any
      const snapshot = snapshots?.find(value => value.model === model)
      if (snapshot) restoreModelParameters(snapshot)
      if (type === 'motion') {
        if (item) {
          const motion = item as MotionInfo
          await manager?.startMotion(motion.group, motion.index, MotionPriority.FORCE)
        } else {
          manager?.stopAllMotions()
        }
      } else {
        const expressions = manager?.expressionManager
        if (item) {
          await expressions?.setExpression(item.index)
        } else if (expressions) {
          expressions.resetExpression()
          expressions.currentExpression = expressions.defaultExpression
        }
      }
      if (token !== generation || sequence !== playSequence[type]) return
      if (snapshot) restoreModelParameters(snapshot)
    }
  }).catch(err => console.error('专注预览播放失败', err))
}
function onLoaded() {
  ready.value = true
  failed.value = false
  const models = preview.value?.getLoadedModels() ?? []
  rateSupported.value = configurePreviewPlaybackClocks(models)
  preview.value?.setFilter(store.getFilterState(modelId))
  const model = models[0]
  if (!model) return
  motions.value = extractMotions(model)
  expressions.value = extractExpressions(model)
  const playing = entry.value?.playing
  if (playing?.motion) playPreview('motion', playing.motion)
  if (playing?.expression) playPreview('expression', playing.expression)
  if (reloading.value) {
    reloading.value = false
    msg.success('已重新加载专注预览模型')
  }
}
function onLoadError() {
  failed.value = true
  if (reloading.value) {
    reloading.value = false
    msg.error('重载专注预览模型失败，请检查模型文件')
  }
}
async function reload() {
  if (reloading.value) return
  reloading.value = true
  ready.value = false
  failed.value = false
  gesture = null
  endGesture()
  generation++
  await pending
  previewKey.value++
}
defineExpose({ reload })
function commit(type: Kind, item: Item, alreadyPreviewed = false) {
  if (!alreadyPreviewed) playPreview(type, item)
  if (type === 'motion') {
    const motion = item as MotionInfo
    void store.playMotion(modelId, motion.group, motion.index, motion.name)
  } else {
    void store.playExpression(modelId, item.index, item.name)
  }
}
function findItem(type: Kind, key: string): Item | undefined {
  const list: Item[] = type === 'motion' ? motions.value : expressions.value
  return list.find(item => itemKey(type, item) === key)
}
function targetAt(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-focus-item]') ?? null
}
function updateGestureHint(e: MouseEvent, item?: Item) {
  const width = Math.min(240, Math.max(0, window.innerWidth - 16))
  const x = Math.max(8, Math.min(e.clientX + 14, window.innerWidth - width - 8))
  const y = e.clientY >= 46 ? e.clientY - 42 : Math.min(e.clientY + 18, window.innerHeight - 40)
  gestureHint.value = { x, y: Math.max(8, y), text: item ? `松开选择：${item.name}` : '松开复原' }
}
function onRightDown(e: MouseEvent, type: Kind, item: Item) {
  if (e.button !== 2 || !ready.value) return
  e.preventDefault()
  const original = type === 'motion' ? entry.value?.playing.motion : entry.value?.playing.expression
  const snapshots = captureModelParameters(preview.value?.getLoadedModels() ?? [])
  gesture = { type, key: itemKey(type, item), original: original ? { ...original } : null, snapshots }
  updateGestureHint(e, item)
  playPreview(type, item, snapshots)
  window.addEventListener('mousemove', onRightMove)
  window.addEventListener('mouseup', onRightUp)
  window.addEventListener('blur', cancelGesture)
}
function onRightMove(e: MouseEvent) {
  if (!gesture) return
  const target = targetAt(e.clientX, e.clientY)
  const key = target?.dataset.focusType === gesture.type ? target.dataset.focusItem ?? null : null
  const item = key === null ? undefined : findItem(gesture.type, key)
  updateGestureHint(e, item)
  if (key === gesture.key) return
  gesture.key = key
  if (item) playPreview(gesture.type, item, gesture.snapshots)
}
function endGesture() {
  gestureHint.value = null
  window.removeEventListener('mousemove', onRightMove)
  window.removeEventListener('mouseup', onRightUp)
  window.removeEventListener('blur', cancelGesture)
}
function cancelGesture() {
  if (!gesture) return
  const { type, original, snapshots } = gesture
  gesture = null
  endGesture()
  playPreview(type, original, snapshots)
}
function onRightUp(e: MouseEvent) {
  if (e.button !== 2 || !gesture) return
  const target = targetAt(e.clientX, e.clientY)
  const key = target?.dataset.focusType === gesture.type ? target.dataset.focusItem : undefined
  const item = key === undefined ? undefined : findItem(gesture.type, key)
  const type = gesture.type
  const lastKey = gesture.key
  const original = gesture.original
  const snapshots = gesture.snapshots
  gesture = null
  endGesture()
  if (item) {
    if (key !== lastKey) playPreview(type, item, snapshots)
    commit(type, item, true)
  } else playPreview(type, original, snapshots)
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && gesture) {
    e.preventDefault()
    cancelGesture()
  }
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => { generation++; endGesture(); window.removeEventListener('keydown', onKeydown) })
function setPath(type: Kind, path: string[]) {
  if (type === 'motion') motionPath.value = path
  else expressionPath.value = path
}
function toggle(type: Kind) {
  if (type === 'motion') motionCollapsed.value = !motionCollapsed.value
  else expressionCollapsed.value = !expressionCollapsed.value
}
async function showCurrent(type: Kind) {
  const item = type === 'motion' ? entry.value?.playing.motion : entry.value?.playing.expression
  if (!item) {
    msg.info(`当前没有播放中的${type === 'motion' ? '动作' : '表情'}`)
    return
  }
  const search = type === 'motion' ? motionSearch : expressionSearch
  if (!filterBySearch([item], search.value, value => value.name).length) search.value = ''
  if (!search.value.trim()) setPath(type, nameSegments(item.name, folders.active.value, folders.settings.separator).slice(0, -1))
  if (type === 'motion') motionCollapsed.value = false
  else expressionCollapsed.value = false
  await nextTick()
  const scroll = type === 'motion' ? motionScroll : expressionScroll
  const key = itemKey(type, item)
  const target = Array.from(scroll.containerRef.value?.querySelectorAll<HTMLElement>('[data-focus-item]') ?? [])
    .find(element => element.dataset.focusItem === key)
  target?.scrollIntoView({ block: 'nearest', inline: 'center' })
}
function playRandom(type: Kind) {
  const items: Item[] = type === 'motion' ? motions.value : expressions.value
  const query = type === 'motion' ? motionSearch.value : expressionSearch.value
  const matches = filterBySearch(items, query, item => item.name)
  if (!matches.length) return
  const item = matches[Math.floor(Math.random() * matches.length)]
  if (!query.trim()) setPath(type, nameSegments(item.name, folders.active.value, folders.settings.separator).slice(0, -1))
  commit(type, item)
}
function onListWheel(e: WheelEvent, type: Kind) {
  if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.deltaY) return
  const container = e.currentTarget as HTMLElement
  const item = container.querySelector<HTMLElement>('.item')
  if (!item) return
  const grid = item.parentElement
  const gap = grid ? parseFloat(getComputedStyle(grid).columnGap) || 0 : 0
  const step = (item.getBoundingClientRect().width + gap) * 0.75
  const units = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY / 3
    : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY
    : e.deltaY / 100
  e.preventDefault()
  ;(type === 'motion' ? motionScroll : expressionScroll).stopInertia()
  container.scrollLeft += step * units
}
</script>

<template>
  <div class="focus-mode" @contextmenu.prevent>
    <div v-if="gestureHint" class="gesture-hint" :style="{ left: gestureHint.x + 'px', top: gestureHint.y + 'px' }">
      {{ gestureHint.text }}
    </div>
    <header class="focus-header">
      <strong>专注模式 · {{ entry?.name }}</strong>
      <label :title="rateSupported ? '调整独立预览的模型更新速率，音频不随之变速' : '当前模型的动作时钟不支持变速'">预览速率
        <input v-model.number="rate" type="range" :min="MIN_FOCUS_PLAYBACK_RATE" :max="MAX_FOCUS_PLAYBACK_RATE" step="0.1" :disabled="!rateSupported" />
        {{ rate.toFixed(1) }}×
        <small v-if="!rateSupported">（当前模型不支持）</small>
      </label>
      <button type="button" @click="emit('close')">关闭 <small>Ctrl + Q</small></button>
    </header>
    <div class="focus-content">
      <div class="focus-preview">
        <Live2dPreview :key="previewKey" ref="preview" :wmdl-config="entry?.wmdlConfig" :playback-rate="rate" @loaded="onLoaded" @load-error="onLoadError" />
        <div v-if="!ready" class="preview-status">{{ failed ? '模型加载失败，请关闭后重试' : '模型加载中…' }}</div>
      </div>
      <div class="focus-lists">
        <section v-for="section in sections" :key="section.type" class="list-section" :class="{ collapsed: section.collapsed }">
          <div class="section-header">
            <button class="section-title" type="button" :aria-expanded="!section.collapsed" @click="toggle(section.type)">
              {{ section.collapsed ? '▸' : '▾' }} {{ section.title }}
            </button>
            <button type="button" @click="showCurrent(section.type)">当前</button>
            <button type="button" :disabled="!ready" @click="playRandom(section.type)">随机</button>
          </div>
          <div v-show="!section.collapsed" class="section-body">
            <SearchInput v-if="section.type === 'motion'" v-model="motionSearch" placeholder="搜索动作..." />
            <SearchInput v-else v-model="expressionSearch" placeholder="搜索表情..." />
            <nav v-if="folders.active.value && !section.search.trim()" class="breadcrumbs" :aria-label="section.title + '目录'">
              <button :disabled="!section.path.length" @click="setPath(section.type, [])">root</button>
              <template v-for="(part, index) in section.path" :key="index">
                <span> / </span><button :disabled="index === section.path.length - 1" @click="setPath(section.type, section.path.slice(0, index + 1))">{{ part }}</button>
              </template>
            </nav>
            <div :ref="(el) => { section.scroll.containerRef.value = el as HTMLElement | null }" class="item-scroll" v-bind="section.scroll.scrollHandlers" @wheel="onListWheel($event, section.type)">
              <div class="item-grid">
                <button v-for="folder in section.directory.folders" :key="'folder:' + folder" class="item folder" @click="setPath(section.type, [...section.path, folder])">📁 {{ folder }}</button>
                <button
                  v-for="item in section.directory.entries" :key="itemKey(section.type, item)"
                  class="item" :class="{ selected: isSelected(section.type, item) }"
                  :title="item.name" :data-focus-item="itemKey(section.type, item)" :data-focus-type="section.type"
                  :disabled="!ready" @click="commit(section.type, item)" @mousedown="onRightDown($event, section.type, item)"
                >{{ nameSegments(item.name, folders.active.value, folders.settings.separator).slice(-1)[0] }}</button>
              </div>
              <span v-if="!section.directory.folders.length && !section.directory.entries.length" class="empty">没有匹配项</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.focus-mode { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; color: #e6e6e6; background: #181a20; }
.gesture-hint { position: fixed; z-index: 20; box-sizing: border-box; width: min(240px, calc(100vw - 16px)); height: 32px; padding: 7px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; border: 1px solid #56739a; border-radius: 5px; background: rgba(32, 42, 56, .95); color: #f3f6fa; font-size: 12px; box-shadow: 0 3px 10px #0006; }
.focus-header { height: 50px; flex-shrink: 0; display: flex; align-items: center; gap: 18px; padding: 0 16px; border-bottom: 1px solid #3a4150; }
.focus-header strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.focus-header label { display: flex; align-items: center; gap: 8px; font-size: 13px; }
button { color: inherit; background: #2c313a; border: 1px solid #414958; border-radius: 4px; cursor: pointer; }
button:hover:not(:disabled) { background: #3a4658; }
button:disabled { opacity: .55; cursor: default; }
.focus-header button { padding: 6px 12px; }
.focus-content { display: flex; flex: 1; min-height: 0; gap: 8px; padding: 8px; }
.focus-preview { position: relative; flex: 1; min-width: 200px; }
.preview-status { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.focus-lists { width: 55%; min-width: 300px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.list-section { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; background: #22262e; border: 1px solid #343b46; border-radius: 5px; overflow: hidden; }
.list-section.collapsed { flex: 0 0 auto; }
.section-header { display: flex; gap: 4px; align-items: center; padding-right: 6px; background: #2c313a; }
.section-header > button:not(.section-title) { padding: 3px 7px; font-size: 12px; }
.section-title { flex: 1; border: 0; border-radius: 0; text-align: left; padding: 8px; font-weight: bold; }
.section-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.breadcrumbs { flex: 0 0 auto; overflow-x: auto; white-space: nowrap; font-size: 12px; }
.breadcrumbs button { border: 0; background: none; padding: 2px; }
.item-scroll { flex: 1; min-height: 0; overflow-x: auto; overflow-y: hidden; user-select: none; }
.item-grid { height: 100%; width: max-content; display: grid; grid-auto-flow: column; grid-template-rows: repeat(auto-fill, 32px); grid-auto-columns: 145px; gap: 4px; align-content: start; }
.item { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 8px; font-size: 12px; }
.item.selected { border-color: #4c9aff; background: #285180; }
.folder { color: #e9c77a; }
.empty { color: #999; font-size: 13px; }
</style>
