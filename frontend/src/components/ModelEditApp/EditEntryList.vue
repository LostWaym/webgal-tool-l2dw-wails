<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ListToolbar from './ListToolbar.vue'
import SearchInput from '../common/SearchInput.vue'
import UiIcon from '../common/UiIcon.vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { useBatchAddModal } from '../../composables/useBatchAddModal'
import { useBatchModifyModal } from '../../composables/useBatchModifyModal'
import { useMessage } from '../../composables/useMessage'
import { filterBySearch } from '../../utils/searchUtils'
import { emitter, StageEvents } from '../../stores/emitter'
import type { ModelEditorPreviewRequest } from '../../utils/modelEditorPreview'

const props = defineProps<{ kind: 'motion' | 'expression' }>()
const store = useWmdlModelEditorStore()
const addModal = useBatchAddModal()
const modifyModal = useBatchModifyModal()
const message = useMessage()
const search = ref('')
const editing = ref<{ name: string; path: string } | null>(null)
const editingName = ref('')
const input = ref<HTMLInputElement[] | null>(null)
const label = computed(() => props.kind === 'motion' ? '动作' : '表情')
const items = computed(() => (props.kind === 'motion' ? store.selectedModel?.motions : store.selectedModel?.expressions) ?? [])
const filtered = computed(() => filterBySearch(items.value, search.value, item => item.name))
const missingModels = computed(() => {
  const result = new Map<string, string[]>()
  const others = store.currentWmdl.models.filter(model => model.id !== store.selectedModelId)
    .map(model => ({
      name: model.name,
      names: new Set((props.kind === 'motion' ? model.motions : model.expressions).map(entry => entry.name)),
    }))
  for (const item of items.value) {
    result.set(item.name, others.filter(model => !model.names.has(item.name)).map(model => model.name))
  }
  return result
})
const tooltip = ref<{ text: string; left: number; top: number; positioned: boolean } | null>(null)
const tooltipElement = ref<HTMLElement | null>(null)
let tooltipSequence = 0
watch([() => store.selectedModelId, () => props.kind], () => { editing.value = null; closeTooltip() })
watch([filtered, missingModels], closeTooltip)

function play(item?: { name: string; path: string }) {
  if (!store.selectedModelId) return
  emitter.emit<ModelEditorPreviewRequest>(StageEvents.ModelEditorPreview, {
    modelId: store.selectedModelId, kind: props.kind, ...(item ? { name: item.name, path: item.path } : {}),
  })
}
function warningText(name: string) {
  return `以下模型缺少同名${label.value}（试播时跳过）：${missingModels.value.get(name)?.join('、')}`
}
function closeTooltip() {
  tooltipSequence++
  tooltip.value = null
}
async function showTooltip(event: Event, name: string) {
  const sequence = ++tooltipSequence
  const trigger = event.currentTarget as HTMLElement
  const current = { text: warningText(name), left: 0, top: 0, positioned: false }
  tooltip.value = current
  await nextTick()
  if (sequence !== tooltipSequence || !tooltip.value || !tooltipElement.value) return
  const anchor = trigger.getBoundingClientRect()
  const box = tooltipElement.value.getBoundingClientRect()
  const margin = 12
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - box.width - margin))
  const preferredTop = anchor.bottom + 8 + box.height <= window.innerHeight - margin
    ? anchor.bottom + 8 : anchor.top - box.height - 8
  tooltip.value = {
    ...current, left, top: Math.max(margin, Math.min(preferredTop, window.innerHeight - box.height - margin)), positioned: true,
  }
}
function startTooltipListeners() {
  window.addEventListener('scroll', closeTooltip, true)
  window.addEventListener('resize', closeTooltip)
  window.addEventListener('blur', closeTooltip)
}
function stopTooltipListeners() {
  window.removeEventListener('scroll', closeTooltip, true)
  window.removeEventListener('resize', closeTooltip)
  window.removeEventListener('blur', closeTooltip)
}
watch(() => !!tooltip.value, visible => { if (visible) startTooltipListeners(); else stopTooltipListeners() }, { flush: 'sync' })
onBeforeUnmount(() => { closeTooltip(); stopTooltipListeners() })
async function rename(item: { name: string; path: string }) {
  closeTooltip()
  editing.value = item
  editingName.value = item.name
  await nextTick()
  input.value?.[0]?.focus()
  input.value?.[0]?.select()
}
function commit() {
  const item = editing.value
  if (!item) return
  try {
    store.renameEntry(props.kind, item.path, item.name, editingName.value)
    editing.value = null
  } catch (error) {
    message.warning(String(error))
    void nextTick(() => input.value?.[0]?.focus())
  }
}
function remove(item: { name: string; path: string }) {
  if (props.kind === 'motion') store.removeMotion(item.name, item.path)
  else store.removeExpression(item.name, item.path)
}
</script>

<template>
  <div class="entry-tab">
    <template v-if="store.selectedModel">
      <ListToolbar :kind="kind" :disabled="store.loadingModelIds.includes(store.selectedModel.id)"
        @batch-add="addModal.open(kind)" @batch-modify="modifyModal.open(kind)" />
      <div class="entry-summary">
        <span>{{ label }}共 {{ items.length }} 条</span>
        <button class="ui-button" @click="play()">{{ kind === 'motion' ? '停止动作' : '恢复默认表情' }}</button>
      </div>
      <SearchInput v-model="search" variant="edit" :placeholder="`搜索${label}（空格分隔关键词）`" />
      <p class="entry-tip">点击试播 · 双击改名 · 修改需保存模型 JSON</p>
      <ul v-if="filtered.length" class="entry-list">
        <li v-for="item in filtered" :key="item.name + '\u0000' + item.path" class="entry-row" :title="item.path"
          @click="!editing && play(item)" @dblclick="rename(item)">
          <input v-if="editing === item" ref="input" v-model="editingName" class="entry-input" aria-label="条目名称"
            @click.stop @mousedown.stop @pointerdown.stop @dblclick.stop
            @keydown.enter.stop.prevent="commit" @keydown.esc.stop.prevent="editing = null" @blur="commit" />
          <template v-else>
            <span v-if="missingModels.get(item.name)?.length" class="entry-warning" tabindex="0" role="img" title=""
              :aria-label="warningText(item.name)"
              @mouseenter="showTooltip($event, item.name)" @mouseleave="closeTooltip"
              @focus="showTooltip($event, item.name)" @blur="closeTooltip">
              <UiIcon name="warning" />
            </span>
            <span class="entry-name">{{ item.name }}</span>
            <div class="entry-actions">
              <button class="ui-button" :aria-label="`试播${label}`" @click.stop="play(item)">▶</button>
              <button class="ui-button" aria-label="重命名" @click.stop="rename(item)">改名</button>
              <button class="ui-button" :aria-label="`删除该${label}`" @click.stop="remove(item)">×</button>
            </div>
          </template>
        </li>
      </ul>
      <p v-else class="empty-hint">{{ items.length ? '无匹配条目' : `该模型暂无${label}` }}</p>
    </template>
    <p v-else class="empty-hint">请先在左侧选择要查看的模型</p>
    <Teleport to="body">
      <div v-if="tooltip" ref="tooltipElement" class="entry-warning-tooltip" role="tooltip"
        :style="{ left: tooltip.left + 'px', top: tooltip.top + 'px', visibility: tooltip.positioned ? 'visible' : 'hidden' }">
        {{ tooltip.text }}
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.entry-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.entry-summary { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 10px 12px; font-size: 12px; color: var(--ui-muted); }
.ui-button { padding: 4px 6px; font-size: 12px; }
.entry-tip { margin: 8px 12px; font-size: 11px; color: var(--ui-muted); }
.entry-list { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0 8px; list-style: none; }
.entry-row { position: relative; display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 2px 8px; color: var(--ui-text); border-radius: var(--ui-radius-compact); cursor: pointer; }
.entry-row:hover { background: var(--ui-control); }
.entry-warning { display: inline-flex; flex-shrink: 0; align-items: center; color: var(--ui-warning); font-size: 15px; }
.entry-warning:focus-visible { outline: 1px solid var(--ui-link); outline-offset: 2px; }
.entry-name { display: block; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.entry-actions { display: flex; flex-shrink: 0; gap: 3px; opacity: 0; pointer-events: none; }
.entry-row:hover .entry-actions, .entry-row:focus-within .entry-actions { opacity: 1; pointer-events: auto; }
.entry-input { width: 100%; min-width: 0; box-sizing: border-box; padding: 6px; color: var(--ui-text); background: var(--ui-well); border: 1px solid var(--ui-link); border-radius: var(--ui-radius-compact); }
.entry-warning-tooltip { position: fixed; z-index: 10000; box-sizing: border-box; width: max-content; max-width: min(360px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; padding: 10px 12px; border: 1px solid var(--ui-edge); border-radius: var(--ui-radius-compact); background: var(--ui-dialog-fill); box-shadow: var(--ui-panel-shadow); color: var(--ui-text); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; pointer-events: none; }
.empty-hint { margin: auto; padding: 16px; color: var(--ui-muted); text-align: center; font-size: 13px; }
</style>
