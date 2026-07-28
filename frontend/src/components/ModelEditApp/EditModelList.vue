<script setup lang="ts">
import { ref } from 'vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import eyeIcon from '../../assets/icons/eye.png'
import eyeOffIcon from '../../assets/icons/eye-off.png'

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

async function onAdd() {
  await store.addModel()
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

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDrop(event: DragEvent, toIndex: number) {
  event.preventDefault()
  const fromIndex = dragFromIndex.value
  if (fromIndex !== null && fromIndex !== toIndex) {
    // Reorder models array
    const models = store.currentWmdl.models
    const [item] = models.splice(fromIndex, 1)
    models.splice(toIndex, 0, item)
  }
  dragFromIndex.value = null
}

function onDragEnd() {
  dragFromIndex.value = null
}
</script>

<template>
  <aside class="edit-model-list">
    <header class="edit-model-list__header">
      <button class="add-btn" @click="onAdd">加载模型</button>
    </header>

    <ul v-if="store.currentWmdl.models.length" class="edit-model-list__items">
      <li
        v-for="(m, index) in store.currentWmdl.models"
        :key="m.id"
        class="model-row"
        :class="{
          'is-selected': m.id === store.selectedModelId,
          'is-dragging': dragFromIndex === index,
        }"
        draggable="true"
        @click="onSelect(m.id)"
        @dragstart="onDragStart($event, index)"
        @dragover="onDragOver($event)"
        @drop="onDrop($event, index)"
        @dragend="onDragEnd"
      >
        <button
          class="model-row__visibility"
          :aria-label="m.state.visible ? '隐藏模型' : '显示模型'"
          @click="onToggleVisible(m.id, $event)"
        >
          <img :src="m.state.visible ? eyeIcon : eyeOffIcon" :alt="m.state.visible ? '眼睛' : '闭眼'" />
        </button>
        <span class="model-row__name" :title="m.modelRelativePath">{{ m.name }}</span>
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
  background: #1d2026;
  color: #e6e6e6;
  box-sizing: border-box;
  overflow: hidden;
}

.edit-model-list__header {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid #2c313a;
  flex-shrink: 0;
}

.add-btn {
  flex: 1;
  padding: 10px 12px;
  background: #2f80ed;
  color: #fff;
  border: 1px solid #2f80ed;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s ease;
}

.add-btn:hover {
  background: #3f90ff;
}

.add-btn:active {
  background: #1f6fd8;
}

.edit-model-list__items {
  list-style: none;
  margin: 0;
  padding: 8px 0;
  overflow-y: auto;
  flex: 1;
}

.model-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.model-row:hover {
  background: #262b34;
}

.model-row.is-selected {
  background: #2a3140;
  border-left-color: #2f80ed;
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
  color: #9aa3af;
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
  background: #b03a3a;
  color: #fff;
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
  background: #3a3f4b;
}

.model-row__visibility img {
  width: 16px;
  height: 16px;
}

.edit-model-list__empty {
  flex: 1;
  margin: 0;
  padding: 24px 16px;
  color: #8a93a3;
  font-size: 13px;
  text-align: center;
}
</style>
