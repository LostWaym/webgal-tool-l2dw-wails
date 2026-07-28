<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import MotionsToolbar from './MotionsToolbar.vue'
import { useBatchAddModal } from '../../composables/useBatchAddModal'
import { filterBySearch } from '../../utils/searchUtils'
import SearchInput from '../common/SearchInput.vue'

/**
 * 【动作】页签内容。
 *
 * 顶部：MotionsToolbar（删除全部 / 添加单个 / 批量添加）
 * 下方：当前选中模型已缓存的动作列表（只读）。
 *
 * 数据来源：wmdlModels store 中当前选中 model 的 motions 字段
 * （由 store.populateMotionsExps 在拿到 modelRelativePath 后通过 fetch 模型描述 json 写入），
 * 以及 toolbar 触发的 addMotion / addMotionsBatch。
 */

const store = useWmdlModelEditorStore()
const modal = useBatchAddModal()

const motions = computed(() => store.selectedModel?.motions ?? [])
const hasSelection = computed(() => !!store.selectedModelId)
const isEmpty = computed(() => motions.value.length === 0)

const searchQuery = ref('')

const filteredMotions = computed(() =>
  filterBySearch(motions.value, searchQuery.value, (m) => m.name),
)

const showNoMatch = computed(
  () =>
    hasSelection.value &&
    !isEmpty.value &&
    searchQuery.value.trim().length > 0 &&
    filteredMotions.value.length === 0,
)

function onBatchAdd() {
  modal.open('motion')
}

function onRemove(item: { name: string; path: string }) {
  store.removeMotion(item.name, item.path)
}
</script>

<template>
  <div class="motions-tab">
    <MotionsToolbar v-if="hasSelection" @batch-add="onBatchAdd" />
    <div v-if="!hasSelection" class="empty-hint">
      请先在左侧选择要查看的模型
    </div>
    <div v-else-if="isEmpty" class="empty-hint">
      该模型暂无动作
    </div>
    <template v-else>
      <SearchInput
        v-model="searchQuery"
        variant="edit"
        placeholder="搜索动作(空格分隔多个关键词)"
        style="margin-bottom: 12px"
      />
      <div v-if="showNoMatch" class="empty-hint">
        无匹配动作
      </div>
      <ul v-else class="list">
        <li
          v-for="item in filteredMotions"
          :key="item.name + '\u0000' + item.path"
          class="list-item"
          :title="item.path"
        >
          <span class="list-item__name">{{ item.name }}</span>
          <button
            class="item-remove"
            aria-label="删除该动作"
            @click.stop="onRemove(item)"
          >×</button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.motions-tab {
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