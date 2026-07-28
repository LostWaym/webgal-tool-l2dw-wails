<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import ExpressionsToolbar from './ExpressionsToolbar.vue'
import { useBatchAddModal } from '../../composables/useBatchAddModal'
import { filterBySearch } from '../../utils/searchUtils'
import SearchInput from '../common/SearchInput.vue'

/**
 * 【表情】页签内容。
 *
 * 顶部：ExpressionsToolbar（删除全部 / 添加单个 / 批量添加）
 * 下方：当前选中模型已缓存的表情列表（只读）。
 *
 * 数据来源：wmdlModels store 中当前选中 model 的 expressions 字段，
 * 以及 toolbar 触发的 addExpression / addExpressionsBatch。
 */

const store = useWmdlModelEditorStore()
const modal = useBatchAddModal()

const expressions = computed(() => store.selectedModel?.expressions ?? [])
const hasSelection = computed(() => !!store.selectedModelId)
const isEmpty = computed(() => expressions.value.length === 0)

const searchQuery = ref('')

const filteredExpressions = computed(() =>
  filterBySearch(expressions.value, searchQuery.value, (e) => e.name),
)

const showNoMatch = computed(
  () =>
    hasSelection.value &&
    !isEmpty.value &&
    searchQuery.value.trim().length > 0 &&
    filteredExpressions.value.length === 0,
)

function onBatchAdd() {
  modal.open('expression')
}

function onRemove(item: { name: string; path: string }) {
  store.removeExpression(item.name, item.path)
}
</script>

<template>
  <div class="expressions-tab">
    <ExpressionsToolbar v-if="hasSelection" @batch-add="onBatchAdd" />
    <div v-if="!hasSelection" class="empty-hint">
      请先在左侧选择要查看的模型
    </div>
    <div v-else-if="isEmpty" class="empty-hint">
      该模型暂无表情
    </div>
    <template v-else>
      <SearchInput
        v-model="searchQuery"
        variant="edit"
        placeholder="搜索表情(空格分隔多个关键词)"
        style="margin-bottom: 12px"
      />
      <div v-if="showNoMatch" class="empty-hint">
        无匹配表情
      </div>
      <ul v-else class="list">
        <li
          v-for="item in filteredExpressions"
          :key="item.name + '\u0000' + item.path"
          class="list-item"
          :title="item.path"
        >
          <span class="list-item__name">{{ item.name }}</span>
          <button
            class="item-remove"
            aria-label="删除该表情"
            @click.stop="onRemove(item)"
          >×</button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.expressions-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.list {
  list-style: none;
  margin: 0;
  padding: 8px 0;
  overflow-y: auto;
  flex: 1;
}

.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  color: #e6e6e6;
  border-left: 3px solid transparent;
  user-select: text;
  transition: background 0.12s ease;
}

.list-item:hover {
  background: #2a2e37;
}

.list-item__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-remove {
  background: transparent;
  border: none;
  color: #8a93a3;
  font-size: 16px;
  line-height: 1;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s ease, color 0.12s ease;
}

.item-remove:hover {
  background: #b03a3a;
  color: #fff;
}

.empty-hint {
  margin: auto;
  color: #6b7280;
  font-size: 13px;
  text-align: center;
  padding: 16px;
}
</style>