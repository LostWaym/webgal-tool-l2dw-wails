<script setup lang="ts">
import UiIcon from '../common/UiIcon.vue'
import { ref } from 'vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import eyeIcon from '../../assets/icons/eye.png'
import eyeOffIcon from '../../assets/icons/eye-off.png'
import { useMessage } from '../../composables/useMessage'

/**
 * 编辑器窗口的模型列表面板。
 *
 * 与主窗口的 ModelList 区别：
 *   - 没有 SPECIAL_IDS（不显示"主场景"/"背景"占位项）
 *   - 列表项只显示 name + 删除按钮 + 显隐切换
 *   - 选中时高亮
 *   - 支持拖拽改变层级（决定 figureContainer 内的 zIndex）
 *
 * 直接使用 wmdlModels store 作为数据源。
 */
const store = useWmdlModelEditorStore()
const dragFromIndex = ref<number | null>(null)
const dropTarget = ref<{ index: number; after: boolean } | null>(null)
const message = useMessage()

async function onAdd() {
  try { await store.addModel() } catch (error) { message.error(`加载模型失败：${error}`) }
}

function onSelect(id: string) {
  store.selectModel(store.selectedModelId === id ? null : id)
}

function onToggleVisible(id: string, event: MouseEvent) {
  event.stopPropagation()
  store.toggleVisible(id)
}

async function onRemove(id: string, event: MouseEvent) {
  event.stopPropagation()
  await store.removeModel(id)
}

function onDragStart(event: DragEvent, index: number) {
  dragFromIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(event: DragEvent, index: number) {
  event.preventDefault()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { index, after: event.clientY > rect.top + rect.height / 2 }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDrop(event: DragEvent, toIndex: number) {
  event.preventDefault()
  const fromIndex = dragFromIndex.value
  if (fromIndex !== null && dropTarget.value) {
    const insertion = toIndex + (dropTarget.value.after ? 1 : 0)
    store.reorderModels(fromIndex, insertion > fromIndex ? insertion - 1 : insertion)
  }
  onDragEnd()
}

function onDragEnd() {
  dragFromIndex.value = null
  dropTarget.value = null
}
</script>

<template>
  <aside class="edit-model-list">
    <header class="edit-model-list__header">
      <button class="ui-button add-btn" @click="onAdd"><UiIcon name="model" />加载模型</button>
    </header>

    <ul v-if="store.currentWmdl.models.length" class="edit-model-list__items">
      <li
        v-for="(m, index) in store.currentWmdl.models"
        :key="m.id"
        class="model-row"
        :class="{
          'is-selected': m.id === store.selectedModelId,
          'is-dragging': dragFromIndex === index,
          'drop-before': dropTarget?.index === index && !dropTarget.after,
          'drop-after': dropTarget?.index === index && dropTarget.after,
        }"
        draggable="true"
        @click="onSelect(m.id)"
        @dragstart="onDragStart($event, index)"
        @dragover="onDragOver($event, index)"
        @drop="onDrop($event, index)"
        @dragend="onDragEnd"
      >
        <button
          class="model-row__visibility"
          :aria-label="m.state.visible ? '隐藏模型' : '显示模型'"
          @click="onToggleVisible(m.id, $event)"
        >
          <img class="ui-icon" :src="m.state.visible ? eyeIcon : eyeOffIcon" :alt="m.state.visible ? '眼睛' : '闭眼'" />
        </button>
        <span class="model-row__name" :title="m.modelRelativePath">{{ m.name }}</span>
        <span v-if="index === 0" class="model-row__badge" title="主模型的偏移固定为 0">主</span>
        <span v-if="store.loadErrors[m.id]" class="model-row__error" :title="store.loadErrors[m.id]">加载失败</span>
        <button
          class="model-row__close"
          aria-label="移除"
          @click="onRemove(m.id, $event)"
        >
          ×
        </button>
      </li>
    </ul>

    <p v-else class="edit-model-list__empty">尚未加载任何模型</p>
  </aside>
</template>

<style scoped>
.edit-model-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ui-panel);
  color: var(--ui-text);
  box-sizing: border-box;
  overflow: hidden;
}

.edit-model-list__header {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--ui-line);
  flex-shrink: 0;
}

.add-btn {
  flex: 1;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 500;
}

.add-btn .ui-symbol { font-size: 17px; color: var(--ui-link); }

.edit-model-list__items {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  flex: 1;
}

.model-row {
  position: relative;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
  border-radius: var(--ui-radius-control);
  transition: background 0.12s ease, border-color 0.12s ease;
}
.model-row.drop-before::before, .model-row.drop-after::after {
  content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--ui-link);
}
.model-row.drop-before::before { top: 0; }
.model-row.drop-after::after { bottom: 0; }
.model-row__badge { flex-shrink: 0; padding: 1px 4px; margin-left: 4px; border: 1px solid var(--ui-edge); border-radius: var(--ui-radius-compact); color: var(--ui-muted); font-size: 11px; }
.model-row__error { color: var(--ui-danger); font-size: 11px; margin-left: 4px; }

.model-row:hover {
  background: var(--ui-control);
}

.model-row.is-selected {
  background: var(--ui-selected);
  border-left-color: var(--ui-link);
}

.model-row.is-dragging {
  opacity: 0.5;
}

.model-row__name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}

.model-row__close {
  background: transparent;
  color: var(--ui-muted);
  border: none;
  font-size: 16px;
  line-height: 1;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  margin-left: 6px;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease;
}

.model-row__close:hover {
  background: var(--ui-danger);
  color: var(--ui-on-status);
}

.model-row__visibility {
  background: transparent;
  border: none;
  padding: 0;
  margin-right: 8px;
  cursor: pointer;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.12s ease;
}

.model-row__visibility:hover {
  background: var(--ui-hover);
}

.model-row__visibility img {
  width: 16px;
  height: 16px;
}

.edit-model-list__empty {
  flex: 1;
  margin: 0;
  padding: 24px 16px;
  color: var(--ui-muted);
  font-size: 13px;
  text-align: center;
}
</style>
