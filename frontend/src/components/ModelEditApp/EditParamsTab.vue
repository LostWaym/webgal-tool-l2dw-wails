<script setup lang="ts">
import { computed, ref } from 'vue'
import EditRangeCard from './EditRangeCard.vue'
import { writeParameter, listPhysicsOutputIds } from '../../live2d/coreAdapter'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { filterBySearch } from '../../utils/searchUtils'
import SearchInput from '../common/SearchInput.vue'
import { useEditorConfirm } from '../../composables/useEditorConfirm'
import { useMessage } from '../../composables/useMessage'

/**
 * 【初始参数】页签内容。
 *
 * 数据源切换为 WmdlModelItem.initParams（来自 store，由 EditStage 在模型
 * 加载完成时通过 populateInitValues 写入）。卡片读"effective 值" =
 * override ?? value。拖动时写 override + 同步写回 coreModel；
 * 点重置时移除 override，并把 coreModel 写回 value。
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
const { confirm } = useEditorConfirm()
const message = useMessage()
const modifiedOnly = ref(false)
const overrideCount = computed(() => params.value.filter(p => p.hasOverride).length)
const physicsIds = computed(() => {
  const model = store.selectedModel
  if (!model?.initParams.length) return new Set<string>()
  return new Set(listPhysicsOutputIds(model.id))
})
async function resetAll() {
  const model = store.selectedModel
  const all = applyAll.value
  if (!model || !await confirm(`确定重置${all ? '所有模型' : '当前模型'}的全部参数覆写？（不受搜索或筛选限制）`)) return
  if (store.selectedModel !== model) return
  const targets = all ? store.currentWmdl.models : [model]
  let count = 0
  for (const target of targets) {
    for (const p of target.initParams) {
      if (p.override === undefined) continue
      writeParameter(target.id, p.id, p.value)
      delete p.override
      count++
    }
  }
  message.success(`已重置 ${count} 条参数覆写`)
}

// 视图模型：把 store 里每条 initParams 投影为 { id, min, max, value,
// override?, effective, hasOverride }。
const params = computed(() => {
  const item = store.selectedModel
  if (!item) return []
  return item.initParams.map((p) => ({
    id: p.id,
    min: p.min ?? -1,
    max: p.max ?? 1,
    value: p.value,
    override: p.override,
    effective: p.override !== undefined ? p.override : p.value,
    hasOverride: p.override !== undefined,
  }))
})

const hasParams = computed(() => params.value.length > 0)

const isMoc3Model = computed(() => store.selectedModel?.isMoc3 === true)

const searchQuery = ref('')

// 顶部开关：开启后，单条参数的修改值/重置会作用于当前 wmdl 内所有模型；
// 显示层仍基于当前选中模型展示。
const applyAll = ref(false)

const filteredParams = computed(() =>
  filterBySearch(params.value.filter(p => !modifiedOnly.value || p.hasOverride), searchQuery.value, (p) => p.id),
)

const showNoMatch = computed(
  () =>
    hasParams.value &&
    filteredParams.value.length === 0,
)

function onValueChange(id: string, value: number) {
  if (applyAll.value) {
    store.applyParamToAll(id, value)
    return
  }
  writeParameter(store.selectedModelId, id, value)
  const item = store.selectedModel
  if (!item) return
  const entry = item.initParams.find((p) => p.id === id)
  if (entry) entry.override = value
}

function onReset(id: string) {
  if (applyAll.value) {
    store.resetParamForAll(id)
    return
  }
  const item = store.selectedModel
  if (!item) return
  const entry = item.initParams.find((p) => p.id === id)
  if (!entry) return
  // 把 coreModel 写回原始值，然后移除 override
  writeParameter(store.selectedModelId, id, entry.value)
  delete entry.override
}
</script>

<template>
  <div class="params-tab">
    <div v-if="!store.selectedModelId" class="empty-hint">
      请先在左侧选择要编辑的模型
    </div>
    <div v-else-if="!hasParams" class="empty-hint">
      该模型暂无参数
    </div>
    <template v-else>
      <div v-if="isMoc3Model" class="moc3-warning">
        moc3 初始参数仅供预览，当前不支持保存
      </div>
      <label class="apply-all-toggle" :class="{ 'is-on': applyAll }">
        <input v-model="applyAll" class="ui-switch" type="checkbox" role="switch" />
        <span class="apply-all-toggle__label">应用于所有模型</span>
      </label>
      <div class="override-toolbar">
        <label><input v-model="modifiedOnly" class="ui-switch" type="checkbox" role="switch" />仅看已修改（{{ overrideCount }}）</label>
        <button class="ui-button" :disabled="!overrideCount && !applyAll" @click="resetAll">全部重置</button>
      </div>
      <SearchInput
        v-model="searchQuery"
        variant="edit"
        placeholder="搜索参数(空格分隔多个关键词)"
        style="margin-bottom: 12px"
      />
      <div class="card-scroll">
        <div v-if="showNoMatch" class="empty-hint">
          无匹配参数
        </div>
        <ul v-else class="card-list">
          <li v-for="p in filteredParams" :key="p.id" class="card-item">
            <EditRangeCard
              :name="p.id"
              :badge="physicsIds.has(p.id) ? '物理' : undefined"
              :min="p.min"
              :max="p.max"
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
.params-tab {
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
  position: relative;
  flex: 1 1 v-bind('`${LAYOUT.CARD_MIN_WIDTH}px`');
  max-width: v-bind('`${LAYOUT.CARD_MAX_WIDTH}px`');
  min-width: 0;
  display: block;
}
.override-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; font-size: 12px; color: var(--ui-muted); }
.override-toolbar label { display: inline-flex; align-items: center; gap: 6px; }
.override-toolbar button { padding: 4px 7px; font-size: 12px; }

.apply-all-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  color: var(--ui-muted);
}

.apply-all-toggle.is-on {
  color: var(--ui-text);
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
