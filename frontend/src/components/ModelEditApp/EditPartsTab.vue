<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import EditRangeCard from './EditRangeCard.vue'
import { writePartOpacity } from '../../live2d/coreAdapter'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { ListPresetFiles, ReadPresetFile } from '../../../wailsjs/go/main/App'
import { filterBySearch } from '../../utils/searchUtils'
import SearchInput from '../common/SearchInput.vue'

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
  filterBySearch(parts.value, searchQuery.value, (p) => p.name),
)

const showNoMatch = computed(
  () =>
    hasParts.value &&
    searchQuery.value.trim().length > 0 &&
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
  }
}

function applyPresetContent(content: string) {
  const item = store.selectedModel
  if (!item) return
  const lines = content.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx <= 0) continue
    const pattern = line.slice(0, eqIdx)
    const valueStr = line.slice(eqIdx + 1).trim()
    const value = Number(valueStr)
    if (!Number.isFinite(value)) continue
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
      }
    }
  }
}

function onDocClick(e: MouseEvent) {
  if (!presetOpen.value) return
  const root = document.getElementById('parts-preset-root')
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
        pld尚未对moc3这部分参数支持，无法保存
      </div>
      <div id="parts-preset-root" class="preset-row">
        <button
          class="preset-toggle"
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
  background: #2c313a;
  border: 1px solid #3a404b;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 13px;
  padding: 6px 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: border-color 0.15s, background 0.15s;
}

.preset-toggle:hover {
  border-color: #2f80ed;
}

.preset-toggle.is-open {
  border-color: #2f80ed;
}

.caret {
  font-size: 10px;
  color: #8a93a3;
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
  padding: 4px 0;
  list-style: none;
  background: #2c313a;
  border: 1px solid #3a404b;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.preset-item {
  padding: 6px 12px;
  font-size: 13px;
  color: #e6e6e6;
  cursor: pointer;
  white-space: nowrap;
}

.preset-item:hover {
  background: #3a404b;
}

.preset-empty {
  padding: 6px 12px;
  font-size: 12px;
  color: #6b7280;
  cursor: default;
}

.empty-hint {
  margin: auto;
  color: #6b7280;
  font-size: 13px;
  text-align: center;
  padding: 16px;
}

.moc3-warning {
  color: #ef4444;
  font-weight: bold;
  font-size: 13px;
  text-align: center;
  padding: 12px;
  margin-bottom: 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid #ef4444;
  border-radius: 4px;
  flex-shrink: 0;
}
</style>