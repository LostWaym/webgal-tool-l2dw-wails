<script setup lang="ts">
import { ref } from 'vue'
import { useModelStore } from '../../stores/previewStore'
import { SPECIAL_IDS, SpecialId, getSpecialName } from '../../live2d/specialIds'
import { PickImageFile } from '../../../wailsjs/go/main/App'
import { useBackgroundHistoryModal } from '../../composables/useBackgroundHistoryModal'
import { useFilterPresetModal } from '../../composables/useFilterPresetModal'
import { useTransformSnapshotModal } from '../../composables/useTransformSnapshotModal'
import eyeIcon from '../../assets/icons/eye.png'
import eyeOffIcon from '../../assets/icons/eye-off.png'

const store = useModelStore()
const emit = defineEmits<{ (e: 'project'): void }>()
const bgHistoryModal = useBackgroundHistoryModal()
const filterPresetModal = useFilterPresetModal()
const snapshotModal = useTransformSnapshotModal()
const dragFromIndex = ref<number | null>(null)

async function onAdd() {
  await store.addFromPicker()
}

async function onAddImage() {
  await store.addImageFigure()
}

function onAddFigureGroup() {
  const group = store.addFigureGroup()
  store.select(group.id)
}

function onSelect(id: string) {
  if (store.selectedId === id) {
    store.select('')
  } else {
    store.select(id)
  }
}

function onRemove(id: string, event: MouseEvent) {
  event.stopPropagation()
  store.remove(id)
}

function onRemoveFigureGroup(id: string, event: MouseEvent) {
  event.stopPropagation()
  store.removeFigureGroup(id)
}

function onToggleVisible(id: string, event: MouseEvent) {
  event.stopPropagation()
  store.toggleVisible(id)
}

async function onLoadBackground(event: MouseEvent) {
  event.stopPropagation()
  const imagePath = await PickImageFile()
  if (imagePath) store.setBackground(imagePath)
}

function onOpenBgHistory(event: MouseEvent) {
  event.stopPropagation()
  bgHistoryModal.open()
}

function onOpenFilterPreset(id: string, event: MouseEvent) {
  event.stopPropagation()
  store.select(id)
  filterPresetModal.open()
}

function onOpenSnapshot(id: string, event: MouseEvent) {
  event.stopPropagation()
  store.select(id)
  snapshotModal.open()
}

function onDragStart(event: DragEvent, index: number) {
  dragFromIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(event: DragEvent, index: number) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDrop(event: DragEvent, toIndex: number) {
  event.preventDefault()
  const fromIndex = dragFromIndex.value
  if (fromIndex !== null && fromIndex !== toIndex) {
    store.move(fromIndex, toIndex)
  }
  dragFromIndex.value = null
}

function onDragEnd() {
  dragFromIndex.value = null
}
</script>

<template>
  <aside class="model-list">
    <header class="model-list__header">
      <button class="add-btn" @click="onAdd">加载模型</button>
      <button class="add-btn" @click="onAddImage">加载图片</button>
    </header>
    <header class="model-list__header model-list__header--secondary">
      <button class="add-btn add-btn--secondary" @click="onAddFigureGroup">新建立绘组</button>
      <button class="add-btn add-btn--secondary" @click="emit('project')">项目</button>
    </header>

    <ul class="model-list__items model-list__items--special">
      <li
        v-for="id in SPECIAL_IDS"
        :key="id"
        class="model-row model-row--special"
        :class="{ 'is-selected': store.selectedId === id }"
        @click="onSelect(id)"
      >
        <span class="model-row__name">{{ getSpecialName(id) }}</span>
        <button
          class="model-row__bg-load model-row__filter"
          :aria-label="`为${getSpecialName(id)}选择滤镜`"
          title="选择滤镜"
          @click="onOpenFilterPreset(id, $event)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5z" />
          </svg>
        </button>
        <button
          class="model-row__bg-load model-row__filter"
          :aria-label="`打开${getSpecialName(id)}的变换快照列表`"
          title="变换快照列表"
          @click="onOpenSnapshot(id, $event)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="6" width="18" height="14" rx="2" />
            <path d="M8 6l1.5-2h5L16 6" />
            <circle cx="12" cy="13" r="3" />
          </svg>
        </button>
        <button
          v-if="id === SpecialId.BgContainer"
          class="model-row__bg-load"
          title="加载背景"
          @click="onLoadBackground($event)"
        >🖼️</button>
        <button
          v-if="id === SpecialId.BgContainer"
          class="model-row__bg-load"
          title="历史背景"
          @click="onOpenBgHistory($event)"
        >🕘</button>
      </li>
    </ul>
    <hr v-if="store.models.length" class="model-list__divider" />

    <ul v-if="store.models.length" class="model-list__items">
      <li
        v-for="(m, index) in store.models"
        :key="m.id"
        class="model-row"
        :class="{ 'is-selected': m.id === store.selectedId, 'is-dragging': dragFromIndex === index }"
        draggable="true"
        @click="onSelect(m.id)"
        @dragstart="onDragStart($event, index)"
        @dragover="onDragOver($event, index)"
        @drop="onDrop($event, index)"
        @dragend="onDragEnd"
      >
        <div class="model-row__quick-actions" @mousedown.prevent @dragstart.stop.prevent>
          <button
            class="model-row__visibility"
            :aria-label="m.visible ? '隐藏模型' : '显示模型'"
            @click="onToggleVisible(m.id, $event)"
          >
            <img :src="m.visible ? eyeIcon : eyeOffIcon" :alt="m.visible ? '眼睛' : '闭眼'" />
          </button>
          <div class="model-row__quick-menu">
            <button type="button" class="model-row__quick-btn" title="选择滤镜" aria-label="选择滤镜" @click="onOpenFilterPreset(m.id, $event)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5z" />
              </svg>
            </button>
            <button type="button" class="model-row__quick-btn" title="变换快照列表" aria-label="变换快照列表" @click="onOpenSnapshot(m.id, $event)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="6" width="18" height="14" rx="2" />
                <path d="M8 6l1.5-2h5L16 6" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            </button>
          </div>
        </div>
        <span v-if="m.kind === 'image'" class="model-row__kind-badge" title="图片立绘">图</span>
        <span class="model-row__name" :title="m.jsonPath || m.imageUrl">{{ m.name }}</span>
        <button
          class="model-row__close"
          aria-label="移除"
          @click="onRemove(m.id, $event)"
        >
          ×
        </button>
      </li>
    </ul>

    <p v-else class="model-list__empty">尚未加载任何模型</p>

    <ul v-if="store.figureGroups.length" class="model-list__items model-list__items--groups">
      <li
        v-for="g in store.figureGroups"
        :key="g.id"
        class="model-row model-row--group"
        :class="{ 'is-selected': g.id === store.selectedId }"
        @click="onSelect(g.id)"
      >
        <span class="model-row__group-badge" title="立绘组">组</span>
        <span class="model-row__name" :title="`${g.targetIds.length} 个立绘 / ${g.targetGroupIds.length} 个嵌套组`">{{ g.name }}</span>
        <button
          class="model-row__close"
          aria-label="移除立绘组"
          @click="onRemoveFigureGroup(g.id, $event)"
        >
          ×
        </button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.model-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1d2026;
  color: #e6e6e6;
  box-sizing: border-box;
  transition: opacity 0.15s ease;
}

.model-list__header {
  display: flex;
  gap: 8px;
  padding: 12px 12px 0;
}

.add-btn {
  flex: 1;
  min-width: 0;
  padding: 8px 4px;
  background: #293c55;
  color: #dceaff;
  border: 1px solid #3b5879;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.add-btn:hover {
  background: #344c6b;
  border-color: #5682b3;
}

.add-btn:active {
  background: #22344c;
}

.add-btn:focus-visible {
  outline: 2px solid #6ca8f5;
  outline-offset: 2px;
}

.model-list__items {
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

.model-row__visibility {
  background: transparent;
  border: none;
  padding: 0;
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

.model-row__kind-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 6px;
  background: #5a8f3b;
  color: #fff;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
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

.model-row__bg-load {
  background: transparent;
  border: none;
  font-size: 14px;
  line-height: 1;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  margin-right: 6px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease;
}

.model-row__bg-load:hover {
  background: #3a3f4b;
}

.model-row__quick-actions {
  position: relative;
  flex: 0 0 auto;
  margin-right: 8px;
}

.model-row__quick-menu {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 100%;
  transform: translateY(-50%);
  display: flex;
  padding: 2px;
  border: 1px solid #465264;
  border-radius: 5px;
  background: #29313d;
  box-shadow: 0 3px 8px #0006;
  opacity: 0;
  pointer-events: none;
}

.model-row__quick-actions:hover .model-row__quick-menu,
.model-row__quick-actions:focus-within .model-row__quick-menu {
  opacity: 1;
  pointer-events: auto;
}

.model-row__quick-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #c4cfdf;
  cursor: pointer;
}

.model-row__quick-btn:hover,
.model-row__quick-btn:focus-visible {
  background: #43546b;
  color: #fff;
}

.model-row__filter {
  color: #aebbd0;
}

.model-row__filter:hover {
  color: #fff;
}

.model-row__close:hover {
  background: #b03a3a;
  color: #fff;
}

.model-list__empty {
  flex: 1;
  margin: 0;
  padding: 24px 16px;
  color: #8a93a3;
  font-size: 13px;
  text-align: center;
}

.model-list__items--special {
  flex: 0 0 auto;
  padding: 0;
  overflow: visible;
}

.model-row--special {
  color: #b8c0cc;
  font-weight: 500;
  cursor: pointer;
}

.model-row--special:hover {
  background: #262b34;
}

.model-row--special .model-row__name {
  padding-left: 12px;
}

.model-list__divider {
  margin: 4px 0;
  border: none;
  border-top: 1px solid #2c313a;
}

.model-list__header--secondary {
  padding: 8px 12px 12px;
  border-bottom: 1px solid #2c313a;
}

.add-btn--secondary {
  background: #292f39;
  border-color: #3a4351;
  color: #cbd2dc;
}

.add-btn--secondary:hover {
  background: #343d4a;
  border-color: #56667c;
}

.add-btn--secondary:active {
  background: #242a33;
}

.model-list__items--groups {
  border-top: 1px solid #2c313a;
  flex: 0 0 auto;
  max-height: 35%;
}

.model-row--group {
  background: #23273a;
}

.model-row--group.is-selected {
  background: #353c5a;
  border-left-color: #b39bff;
}

.model-row__group-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 6px;
  background: #7d6cff;
  color: #fff;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
</style>
