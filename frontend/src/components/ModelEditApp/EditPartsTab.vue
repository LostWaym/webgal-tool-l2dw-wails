<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import EditRangeCard from './EditRangeCard.vue'
import { writePartOpacity } from '../../live2d/coreAdapter'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { ListPresetFiles, ReadPresetFile } from '../../../wailsjs/go/main/App'
import { filterBySearch } from '../../utils/searchUtils'
import SearchInput from '../common/SearchInput.vue'
import { useMessage } from '../../composables/useMessage'
import { useEditorConfirm } from '../../composables/useEditorConfirm'

/**
 * 【部件参数】页签内容。
 *
 * 数据源切换为 WmdlModelItem.initOpacities（来自 store，由 EditStage 在模型
 * 加载完成时通过 populateInitValues 写入）。卡片读"effective 值" =
 * override ?? value。拖动时写 override + 同步写回 coreModel；
 * 点重置时移除 override，并把 coreModel 写回 value。
 * 部件不透明度范围固定 [0, 1]。
 *
 * 卡片采用网格流式布局：通过 flex-wrap + min/max 宽度约束，
 * 容器宽度变化时自动重排每行卡片数量。
 */

/**
 * 卡片布局常量
 * - CARD_MIN_WIDTH: 卡片最小宽度（px），达到此值后若空间允许则继续拉伸
 * - CARD_MAX_WIDTH: 卡片最大宽度（px），超过此值的多余空间由父容器自行分配
 * - GAP: 卡片之间的间距（px）
 */
const LAYOUT = {
  CARD_MIN_WIDTH: 150,
  CARD_MAX_WIDTH: 300,
  GAP: 8,
} as const

const store = useWmdlModelEditorStore()
const message = useMessage()
const { confirm } = useEditorConfirm()
const presetRoot = ref<HTMLElement | null>(null)
const modifiedOnly = ref(false)
const overrideCount = computed(() => parts.value.filter(p => p.hasOverride).length)
async function resetAll() {
  const model = store.selectedModel
  if (!model || !await confirm('确定重置当前模型的全部部件覆写？（不受搜索或筛选限制）')) return
  if (store.selectedModel !== model) return
  const count = overrideCount.value
  for (const part of model.initOpacities) {
    if (part.override !== undefined) onReset(part.id)
  }
  message.success(`已重置 ${count} 条部件覆写`)
}

// 部件透明度范围固定 [0, 1]
const PART_MIN = 0
const PART_MAX = 1

// 视图模型：把 store 里每条 initOpacities 投影为 { id, name, value,
// override?, effective, hasOverride }。id 用作回写 coreModel 的 part id。
const parts = computed(() => {
  const item = store.selectedModel
  if (!item) return []
  return item.initOpacities.map((p) => ({
    id: p.id,
    name: p.id,
    value: p.value,
    override: p.override,
    effective: p.override !== undefined ? p.override : p.value,
    hasOverride: p.override !== undefined,
  }))
})

function onValueChange(id: string, value: number) {
  writePartOpacity(store.selectedModelId, id, value)
  const item = store.selectedModel
  if (!item) return
  const entry = item.initOpacities.find((p) => p.id === id)
  if (entry) entry.override = value
}

function onReset(id: string) {
  const item = store.selectedModel
  if (!item) return
  const entry = item.initOpacities.find((p) => p.id === id)
  if (!entry) return
  // 把 coreModel 写回原始值，然后移除 override
  writePartOpacity(store.selectedModelId, id, entry.value)
  delete entry.override
}

const hasParts = computed(() => parts.value.length > 0)

const isMoc3Model = computed(() => store.selectedModel?.isMoc3 === true)

const searchQuery = ref('')

const filteredParts = computed(() =>
  filterBySearch(parts.value.filter(p => !modifiedOnly.value || p.hasOverride), searchQuery.value, (p) => p.name),
)

const showNoMatch = computed(
  () =>
    hasParts.value &&
    filteredParts.value.length === 0,
)

// 预设下拉框
const presetFiles = ref<string[]>([])
const presetOpen = ref(false)

async function loadPresetFiles() {
  try {
    presetFiles.value = await ListPresetFiles()
  } catch {
    presetFiles.value = []
  }
}

async function togglePreset() {
  if (!presetOpen.value) {
    await loadPresetFiles()  // 打开时重新加载
  }
  presetOpen.value = !presetOpen.value
}

function closePreset() {
  presetOpen.value = false
}

async function onPresetPick(filename: string) {
  // 按需求：点中下拉框选项时不关闭下拉框
  try {
    const content = await ReadPresetFile(filename)
    applyPresetContent(content)
  } catch (e) {
    console.error('failed to read preset', filename, e)
    message.error(`读取预设失败：${e}`)
  }
}

function applyPresetContent(content: string) {
  const item = store.selectedModel
  if (!item) return
  const lines = content.split(/\r?\n/)
  const changed = new Set<string>()
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx <= 0) continue
    const pattern = line.slice(0, eqIdx)
    const valueStr = line.slice(eqIdx + 1).trim()
    const rawValue = Number(valueStr)
    if (!Number.isFinite(rawValue)) continue
    const value = Math.max(0, Math.min(1, rawValue))
    let regex: RegExp
    try {
      regex = new RegExp(pattern)
    } catch {
      continue
    }
    for (const p of parts.value) {
      if (regex.test(p.id)) {
        writePartOpacity(item.id, p.id, value)
        const entry = item.initOpacities.find((it) => it.id === p.id)
        if (entry) entry.override = value
        changed.add(p.id)
      }
    }
  }
  if (changed.size) message.success(`预设已应用：匹配并修改 ${changed.size} 个部件`)
  else message.info('预设未匹配到任何部件')
}

function onDocClick(e: MouseEvent) {
  if (!presetOpen.value) return
  const root = presetRoot.value
  if (root && !root.contains(e.target as Node)) {
    presetOpen.value = false
  }
}

onMounted(() => {
  loadPresetFiles()
  document.addEventListener('mousedown', onDocClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
})
</script>

<template>
  <div class="parts-tab">
    <div v-if="!store.selectedModelId" class="empty-hint">
      请先在左侧选择要编辑的模型
    </div>
    <div v-else-if="!hasParts" class="empty-hint">
      该模型暂无部件
    </div>
    <template v-else>
      <div v-if="isMoc3Model" class="moc3-warning">
        moc3 部件覆写仅供预览，当前不支持保存
      </div>
      <div class="override-toolbar">
        <label><input v-model="modifiedOnly" class="ui-switch" type="checkbox" role="switch" />仅看已修改（{{ overrideCount }}）</label>
        <button class="ui-button" :disabled="!overrideCount" @click="resetAll">全部重置</button>
      </div>
      <div ref="presetRoot" class="preset-row">
        <button
          class="ui-button preset-toggle"
          :class="{ 'is-open': presetOpen }"
          @click="togglePreset"
        >
          预设 <span class="caret">▾</span>
        </button>
        <ul v-if="presetOpen" class="preset-menu">
          <li
            v-for="name in presetFiles"
            :key="name"
            class="preset-item"
            @click="onPresetPick(name)"
          >
            {{ name }}
          </li>
          <li v-if="presetFiles.length === 0" class="preset-empty">
            无可用预设
          </li>
        </ul>
      </div>
      <SearchInput
        v-model="searchQuery"
        variant="edit"
        placeholder="搜索部件(空格分隔多个关键词)"
        style="margin-bottom: 12px"
      />
      <div class="card-scroll">
        <div v-if="showNoMatch" class="empty-hint">
          无匹配部件
        </div>
        <ul v-else class="card-list">
          <li v-for="p in filteredParts" :key="p.id" class="card-item">
            <EditRangeCard
              :name="p.name"
              :min="PART_MIN"
              :max="PART_MAX"
              :model-value="p.effective"
              :highlight="p.hasOverride"
              :show-reset="p.hasOverride"
              @update:model-value="onValueChange(p.id, $event)"
              @reset="onReset(p.id)"
            />
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.parts-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  overflow: hidden;
}
.override-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; font-size: 12px; color: var(--ui-muted); }
.override-toolbar label { display: inline-flex; align-items: center; gap: 6px; }
.override-toolbar button { padding: 4px 7px; font-size: 12px; }

.card-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: v-bind('`${LAYOUT.GAP}px`');
  align-items: stretch;
}

.card-item {
  flex: 1 1 v-bind('`${LAYOUT.CARD_MIN_WIDTH}px`');
  max-width: v-bind('`${LAYOUT.CARD_MAX_WIDTH}px`');
  min-width: 0;
  display: block;
}

.preset-row {
  position: relative;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.preset-toggle {
  background: var(--ui-field-fill);
  border: 1px solid var(--ui-edge);
  border-radius: 4px;
  color: var(--ui-text);
  font-size: 13px;
  padding: 6px 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: border-color 0.15s, background 0.15s;
}

.preset-toggle:hover {
  border-color: var(--ui-link);
}

.preset-toggle.is-open {
  border-color: var(--ui-link);
}

.caret {
  font-size: 10px;
  color: var(--ui-muted);
}

.preset-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  min-width: 180px;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--ui-menu-fill);
  border: 1px solid var(--ui-link);
  border-radius: var(--ui-radius-control);
  box-shadow: var(--ui-panel-shadow);
}

.preset-item {
  padding: 6px 12px;
  border-radius: var(--ui-radius-compact);
  font-size: 13px;
  color: var(--ui-text);
  cursor: pointer;
  white-space: nowrap;
}

.preset-item:hover {
  background: var(--ui-hover);
}

.preset-empty {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--ui-muted);
  cursor: default;
}

.empty-hint {
  margin: auto;
  color: var(--ui-muted);
  font-size: 13px;
  text-align: center;
  padding: 16px;
}

.moc3-warning {
  color: var(--ui-danger);
  font-weight: bold;
  font-size: 13px;
  text-align: center;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--ui-panel-tint-danger);
  border: 1px solid var(--ui-danger);
  border-radius: 4px;
  flex-shrink: 0;
}
</style>
