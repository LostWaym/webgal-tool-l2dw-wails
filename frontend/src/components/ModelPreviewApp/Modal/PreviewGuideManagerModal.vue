<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useMessage } from '../../../composables/useMessage'
import { useModelStore } from '../../../stores/previewStore'
import { choosePreviewGuides, exportPreviewGuides } from '../../../utils/previewGuideFile'
import { isPreviewGuide, mergePreviewGuides, previewGuideRange, type GuideAxis, type PreviewGuide } from '../../../utils/previewGuides'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const store = useModelStore()
const msg = useMessage()
const axes = [{ axis: 'x', label: 'X 竖线' }, { axis: 'y', label: 'Y 横线' }] as const
const groups = computed(() => axes.map(group => ({
  ...group,
  guides: store.guides.filter(guide => guide.axis === group.axis),
})))

const modal = ref<HTMLElement | null>(null)
const importMode = ref<'merge' | 'replace'>('merge')
const busy = ref(false)
let returnFocus: HTMLElement | null = null
const rowKeys = new WeakMap<PreviewGuide, number>()
let nextRowKey = 0

watch(() => props.visible, async visible => {
  if (visible) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    importMode.value = 'merge'
    await nextTick()
    modal.value?.focus()
  } else {
    returnFocus?.focus()
    returnFocus = null
  }
})

function close() {
  if (!busy.value) emit('close')
}

function rowKey(guide: PreviewGuide) {
  let key = rowKeys.get(guide)
  if (key === undefined) {
    key = nextRowKey++
    rowKeys.set(guide, key)
  }
  return key
}

async function focusGuide(guide: PreviewGuide) {
  const key = rowKey(guide)
  await nextTick()
  const input = modal.value?.querySelector<HTMLInputElement>(`[data-guide-row="${key}"]`)
  input?.focus()
  input?.select()
}

async function addGuide(axis: GuideAxis, guides: readonly PreviewGuide[]) {
  if (busy.value) return
  const occupied = new Set(guides.map(guide => guide.position))
  const [min, max] = previewGuideRange(axis)
  let position: number | undefined
  for (let offset = 0; offset <= Math.max(-min, max) && position === undefined; offset++) {
    if (offset <= max && !occupied.has(offset)) position = offset
    else if (-offset >= min && !occupied.has(-offset)) position = -offset
  }
  if (position === undefined || !store.saveGuide({ axis, position })) {
    msg.warning('没有可用的整数坐标，请先修改或删除一条游标')
    return
  }
  await focusGuide(store.guides[store.guides.length - 1])
}

function commitPosition(guide: PreviewGuide, event: FocusEvent) {
  const input = event.currentTarget as HTMLInputElement
  const text = input.value.trim()
  const position = text ? Number(text) : NaN
  if (!busy.value && position !== guide.position) {
    const updated = { axis: guide.axis, position }
    if (!isPreviewGuide(updated)) {
      const [min, max] = previewGuideRange(guide.axis)
      msg.warning(`${guide.axis.toUpperCase()} 坐标须在 ${min} 到 ${max} 之间`)
    } else if (!store.saveGuide(updated, guide)) {
      msg.warning('同轴同坐标的游标已存在')
    }
  }
  input.value = String(guide.position)
}

function finishPosition(event: KeyboardEvent, original?: number) {
  event.stopPropagation()
  if (event.isComposing) return
  event.preventDefault()
  const input = event.currentTarget as HTMLInputElement
  if (original !== undefined) input.value = String(original)
  input.blur()
}

function clearAll() {
  if (!store.guides.length || !window.confirm(`确定删除全部 ${store.guides.length} 条游标？`)) return
  store.guides = []
}

async function exportFile() {
  busy.value = true
  try {
    if (await exportPreviewGuides(store.guides)) msg.success('游标已导出')
  } catch (err) {
    msg.error(`导出游标失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    busy.value = false
  }
}

async function importFile() {
  const replace = importMode.value === 'replace'
  busy.value = true
  try {
    const incoming = await choosePreviewGuides()
    if (!incoming) return
    if (replace) {
      const guides = mergePreviewGuides([], incoming)
      if (!window.confirm(`用文件中的 ${guides.length} 条游标替换当前 ${store.guides.length} 条游标？`)) return
      store.guides = guides
      msg.success(`已载入 ${guides.length} 条游标`)
    } else {
      const guides = mergePreviewGuides(store.guides, incoming)
      const added = guides.length - store.guides.length
      if (!added) {
        msg.info('没有可合并的新游标')
        return
      }
      store.guides = guides
      msg.success(`已合并 ${added} 条游标`)
    }
  } catch (err) {
    msg.error(`载入游标失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="guide-mask" @click.self="close">
      <section ref="modal" class="ui-dialog guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title"
        tabindex="-1" @keydown.esc.stop.prevent="close">
        <header>
          <h2 id="guide-title">游标管理 <span>（{{ store.guides.length }} 条）</span></h2>
          <button type="button" class="close" aria-label="关闭" :disabled="busy" @click="close">×</button>
        </header>
        <div class="guide-body">
          <div class="toolbar">
            <label>载入方式
              <select v-model="importMode" :disabled="busy">
                <option value="merge">合并</option>
                <option value="replace">替换</option>
              </select>
            </label>
            <button type="button" :disabled="busy" @click="importFile">载入…</button>
            <button type="button" :disabled="busy" @click="exportFile">导出…</button>
            <button type="button" class="danger clear" :disabled="busy || !store.guides.length" @click="clearAll">全部删除</button>
          </div>

          <p class="muted guide-help">绿框中心为 0。修改坐标后，按回车或移开焦点即可生效。</p>
          <div class="groups">
            <section v-for="group in groups" :key="group.axis" class="group">
              <div class="group-title">
                <h3>{{ group.label }}（{{ group.guides.length }}）</h3>
                <button type="button" class="add" :aria-label="`添加 ${group.label}`" :disabled="busy"
                  @click="addGuide(group.axis, group.guides)">+</button>
              </div>
              <p v-if="!group.guides.length" class="muted">暂无游标</p>
              <ul v-else class="group-list">
                <li v-for="(guide, index) in group.guides" :key="rowKey(guide)">
                  <input class="coordinate" type="text" inputmode="decimal" :value="guide.position"
                    :data-guide-row="rowKey(guide)" :aria-label="`${group.label} ${index + 1} 坐标`" :disabled="busy"
                    @blur="commitPosition(guide, $event)" @keydown.enter="finishPosition($event)"
                    @keydown.esc="finishPosition($event, guide.position)">
                  <button type="button" class="danger delete-guide" :disabled="busy" title="删除游标"
                    :aria-label="`删除 ${group.label} ${index + 1}`" @click="store.deleteGuide(guide)">
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6m4-6v6" />
                    </svg>
                  </button>
                </li>
              </ul>
            </section>
          </div>
        </div>
        <footer><button type="button" :disabled="busy" @click="close">关闭</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.guide-mask { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; background: var(--ui-shadow); }
.guide-modal { width: min(660px, 92vw); height: min(480px, 85vh); display: flex; flex-direction: column; }
.guide-modal:focus { outline: none; }
header, footer { flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 12px 18px; }
header { border-bottom: 1px solid var(--ui-line); }
footer { justify-content: flex-end; border-top: 1px solid var(--ui-line); }
h2 { flex: 1; margin: 0; font-size: 16px; }
h3 { margin: 0; font-size: 14px; }
h2 span, .muted { color: var(--ui-muted); font-weight: normal; }
.guide-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; padding: 16px 18px; }
.toolbar, .group-title, label { display: flex; align-items: center; gap: 8px; }
.toolbar, .group-title, .guide-help { flex-shrink: 0; }
.toolbar { flex-wrap: wrap; }
.clear { margin-left: auto; }
.guide-help { margin-bottom: 10px; }
.group { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px; border: 1px solid var(--ui-line); border-radius: 6px; background: var(--ui-panel); }
.group-title { justify-content: space-between; }
.groups { flex: 1; min-height: 120px; display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); }
.group-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; padding: 0; margin: 8px 0 0; list-style: none; }
@media (max-width: 590px) {
  .groups { min-height: 250px; grid-template-columns: minmax(0, 1fr); }
}
li { display: flex; align-items: center; gap: 6px; padding: 4px; border-radius: 4px; }
li + li { border-top: 1px solid var(--ui-line); }
.coordinate { flex: 1; min-width: 0; font-variant-numeric: tabular-nums; }
button, input, select { padding: 6px 9px; border: 1px solid var(--ui-edge); border-radius: 5px; color: inherit; background: var(--ui-control); }
input { box-sizing: border-box; background: var(--ui-well); }
button { cursor: pointer; }
button:disabled { opacity: .45; cursor: default; }
.add { min-width: 30px; padding: 2px 7px; background: var(--ui-selected); border-color: var(--ui-link); font-size: 18px; line-height: 24px; }
.danger { color: var(--ui-danger); }
.delete-guide { align-self: stretch; display: grid; place-items: center; }
.delete-guide:hover:not(:disabled) { background: var(--ui-panel-tint-danger); border-color: var(--ui-danger); }
.close { border: 0; background: transparent; font-size: 22px; padding: 0 5px; }
p { margin-top: 8px; font-size: 13px; }
</style>
