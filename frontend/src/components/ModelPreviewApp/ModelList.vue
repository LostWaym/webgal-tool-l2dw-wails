<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { choosePath } from '../../utils/fileDialog'
import { useModelStore } from '../../stores/previewStore'
import { SPECIAL_IDS, SpecialId, getSpecialName } from '../../live2d/specialIds'
import { PickImageFile } from '../../../wailsjs/go/main/App'
import { useBackgroundHistoryModal } from '../../composables/useBackgroundHistoryModal'
import { useFilterPresetModal } from '../../composables/useFilterPresetModal'
import { useTransformSnapshotModal } from '../../composables/useTransformSnapshotModal'
import { usePreviewModelReload } from '../../composables/usePreviewModelReload'
import UiIcon from '../common/UiIcon.vue'

const store = useModelStore()
const emit = defineEmits<{ (e: 'project'): void; (e: 'guides'): void; (e: 'settings'): void; (e: 'resize', width: number): void }>()
const bgHistoryModal = useBackgroundHistoryModal()
const filterPresetModal = useFilterPresetModal()
const snapshotModal = useTransformSnapshotModal()
const { reloadConfig, reloadTextures } = usePreviewModelReload()
const dragFromIndex = ref<number | null>(null)
const dropTarget = ref<{ index: number; after: boolean } | null>(null)
function onResizeMove(e: MouseEvent) {
  emit('resize', e.clientX)
}

function onResizeEnd() {
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  window.removeEventListener('blur', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function onResizeStart(e: MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
  window.addEventListener('blur', onResizeEnd)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}

onBeforeUnmount(onResizeEnd)

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
  const imagePath = await choosePath(() => PickImageFile())
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
    event.dataTransfer.setData('text/plain', store.models[index].id)
  }
}

function onDragOver(event: DragEvent, index: number) {
  if (dragFromIndex.value === null) return
  event.preventDefault()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { index, after: event.clientY >= rect.top + rect.height / 2 }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDrop(event: DragEvent, toIndex: number) {
  if (dragFromIndex.value === null) return
  onDragOver(event, toIndex)
  event.preventDefault()
  const fromIndex = dragFromIndex.value
  if (fromIndex !== null && dropTarget.value) {
    const insertion = toIndex + Number(dropTarget.value.after)
    store.move(fromIndex, insertion - Number(fromIndex < insertion))
  }
  onDragEnd()
}

function onDragEnd() {
  dragFromIndex.value = null
  dropTarget.value = null
}

function onDragLeave(event: DragEvent) {
  if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) {
    dropTarget.value = null
  }
}
</script>

<template>
  <aside class="model-list">
    <div class="model-list__resize-handle" @mousedown="onResizeStart" />
    <header class="model-list__header">
      <button class="ui-button add-btn" @click="onAdd"><UiIcon name="model" />加载模型</button>
      <button class="ui-button add-btn" @click="onAddImage"><UiIcon name="image" />加载图片</button>
      <button class="ui-button add-btn" @click="onAddFigureGroup"><UiIcon name="group" />新建立绘组</button>
    </header>
    <header class="model-list__header model-list__header--secondary">
      <button class="ui-button add-btn" @click="emit('project')"><UiIcon name="project" />项目</button>
      <button class="ui-button add-btn" @click="emit('guides')"><UiIcon name="guides" />游标</button>
      <button class="ui-button add-btn" @click="emit('settings')"><UiIcon name="settings" />设置</button>
    </header>

    <div class="model-list__sections">
    <h3 class="model-list__section-title">舞台</h3>
    <ul class="model-list__items model-list__items--special">
      <li
        v-for="id in SPECIAL_IDS"
        :key="id"
        class="model-row model-row--special"
        :class="{ 'is-selected': store.selectedId === id }"
        @click="onSelect(id)"
      >
        <UiIcon class="model-row__marker" name="right" />
        <span class="model-row__name">{{ getSpecialName(id) }}</span>
        <button
          v-if="id === SpecialId.Camera"
          type="button"
          class="model-row__visibility"
          :aria-label="store.cameraFrameVisible ? '关闭镜头框常驻显示' : '开启镜头框常驻显示'"
          :title="store.cameraFrameVisible ? '关闭镜头框常驻显示' : '开启镜头框常驻显示'"
          :aria-pressed="store.cameraFrameVisible"
          @click.stop="store.cameraFrameVisible = !store.cameraFrameVisible"
        >
          <UiIcon :name="store.cameraFrameVisible ? 'eye' : 'eyeOff'" />
        </button>
        <button
          v-if="id !== SpecialId.Camera"
          class="model-row__bg-load model-row__filter"
          :aria-label="`为${getSpecialName(id)}选择滤镜`"
          title="选择滤镜"
          @click="onOpenFilterPreset(id, $event)"
        >
          <UiIcon name="filter" />
        </button>
        <button
          class="model-row__bg-load model-row__filter"
          :aria-label="`打开${getSpecialName(id)}的变换快照列表`"
          title="变换快照列表"
          @click="onOpenSnapshot(id, $event)"
        >
          <UiIcon name="snapshot" />
        </button>
        <button
          v-if="id === SpecialId.BgContainer"
          class="model-row__bg-load"
          aria-label="加载背景"
          title="加载背景"
          @click="onLoadBackground($event)"
        ><UiIcon name="image" /></button>
        <button
          v-if="id === SpecialId.BgContainer"
          class="model-row__bg-load"
          aria-label="历史背景"
          title="历史背景"
          @click="onOpenBgHistory($event)"
        ><UiIcon name="clock" /></button>
      </li>
    </ul>
    <hr v-if="store.models.length" class="model-list__divider" />
    <h3 class="model-list__section-title">立绘</h3>

    <ul v-if="store.models.length" class="model-list__items">
      <li
        v-for="(m, index) in store.models"
        :key="m.id"
        class="model-row model-row--figure"
        :class="{ 'is-selected': m.id === store.selectedId, 'is-dragging': dragFromIndex === index, 'drop-before': dropTarget?.index === index && !dropTarget.after, 'drop-after': dropTarget?.index === index && dropTarget.after }"
        draggable="true"
        @click="onSelect(m.id)"
        @dragstart="onDragStart($event, index)"
        @dragover="onDragOver($event, index)"
        @drop="onDrop($event, index)"
        @dragend="onDragEnd"
        @dragleave="onDragLeave"
      >
        <div class="model-row__quick-actions" @mousedown.prevent @dragstart.stop.prevent>
          <button
            class="model-row__visibility"
            :aria-label="m.visible ? '隐藏模型' : '显示模型'"
            :title="m.visible ? '隐藏模型' : '显示模型'"
            @click="onToggleVisible(m.id, $event)"
          >
            <UiIcon :name="m.visible ? 'eye' : 'eyeOff'" />
          </button>
        </div>
        <span v-if="m.kind === 'image'" class="model-row__kind-badge" title="图片立绘">图</span>
        <span class="model-row__name" :title="m.jsonPath || m.imageUrl">{{ m.name }}</span>
        <div class="model-row__quick-menu" @mousedown.prevent @dragstart.stop.prevent>
          <button type="button" class="model-row__quick-btn" title="选择滤镜" aria-label="选择滤镜" @click="onOpenFilterPreset(m.id, $event)">
            <UiIcon name="filter" />
          </button>
          <button type="button" class="model-row__quick-btn" title="变换快照列表" aria-label="变换快照列表" @click="onOpenSnapshot(m.id, $event)">
            <UiIcon name="snapshot" />
          </button>
          <button v-if="m.kind === 'live2d' && m.wmdlConfig?.wmdlFilePath" type="button" class="model-row__quick-btn" title="重载模型配置" aria-label="重载模型配置" @click.stop="reloadConfig(m.id)">
            <UiIcon name="reload" />
          </button>
          <button v-if="m.kind === 'live2d'" type="button" class="model-row__quick-btn" title="重载纹理" aria-label="重载纹理" @click.stop="reloadTextures(m.id)">
            <UiIcon name="texture" />
          </button>
        </div>
        <button
          class="model-row__close"
          aria-label="移除"
          title="移除"
          @click="onRemove(m.id, $event)"
        >
          <UiIcon name="close" />
        </button>
      </li>
    </ul>

    <p v-else class="model-list__empty">尚未加载任何模型</p>

    <h3 v-if="store.figureGroups.length" class="model-list__section-title">立绘组</h3>
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
          title="移除立绘组"
          @click="onRemoveFigureGroup(g.id, $event)"
        >
          <UiIcon name="close" />
        </button>
      </li>
    </ul>
    </div>
  </aside>
</template>

<style scoped>
.model-list {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ui-panel);
  color: var(--ui-text);
  box-sizing: border-box;
  transition: opacity 0.15s ease;
  overflow: hidden;
  container-type: inline-size;
}

.model-list__header {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  padding: 12px 12px 0;
}

.add-btn {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 6px 3px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.model-list__resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  z-index: 2;
  transition: background 0.15s;
}

.model-list__resize-handle:hover {
  background: var(--ui-accent);
}

.add-btn .ui-symbol { font-size: 18px; color: var(--ui-link); }

@container (max-width: 310px) {
  .add-btn { gap: 3px; padding-inline: 2px; font-size: 12px; }
  .add-btn .ui-symbol { font-size: 13px; }
  .model-list__header:not(.model-list__header--secondary) .add-btn:last-child { flex-grow: 1.18; }
}

.model-list__items {
  list-style: none;
  margin: 0;
  padding: 8px 10px;
  overflow: visible;
}

.model-list__sections {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.model-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 42px;
  margin-bottom: 3px;
  padding: 7px 8px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-control);
  transition: background 0.12s ease, border-color 0.12s ease;
}

.model-row:hover {
  background: var(--ui-control);
}

.model-row.is-selected {
  background: linear-gradient(110deg, color-mix(in srgb, var(--ui-selected) 94%, var(--ui-accent)), var(--ui-selected));
  border-color: color-mix(in srgb, var(--ui-selected) 74%, var(--ui-edge));
}

.model-row--figure,
.model-row--group {
  --model-row-gap: 8px;
  gap: var(--model-row-gap);
  min-height: 49px;
  padding-inline: 14px;
}

.model-row.is-selected:not(.model-row--special) .model-row__name {
  font-weight: 550;
}

.model-row--figure .model-row__name,
.model-row--group .model-row__name {
  font-size: 16px;
}

@container (max-width: 310px) {
  .model-row--figure, .model-row--group { padding-inline: 9px; }
  .model-row--figure .model-row__name, .model-row--group .model-row__name { font-size: 14px; }
}

.model-row.is-dragging {
  opacity: 0.5;
}

.model-row__name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
}

.model-row__visibility {
  background: transparent;
  color: var(--ui-muted);
  border: none;
  padding: 0;
  cursor: pointer;
  width: 24px;
  height: 24px;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.12s ease;
}

.model-row__visibility:hover {
  background: var(--ui-hover);
}

.model-row--figure .model-row__visibility {
  width: 28px;
  height: 28px;
  font-size: 23px;
}

.model-row.is-selected .model-row__visibility {
  color: var(--ui-link);
}

.model-row__kind-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 6px;
  background: var(--ui-success);
  color: var(--ui-on-status);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.model-row__close {
  display: grid;
  place-items: center;
  flex: none;
  background: transparent;
  color: var(--ui-muted);
  border: none;
  font-size: 16px;
  line-height: 1;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease;
}

.model-row__bg-load {
  background: transparent;
  border: none;
  font-size: 16px;
  color: var(--ui-muted);
  line-height: 1;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease;
}

.model-row__bg-load:hover {
  background: var(--ui-hover);
}

.model-row__quick-actions {
  position: relative;
  flex: 0 0 auto;
  margin-right: 8px;
}

.model-row__quick-menu {
  flex: none;
  display: flex;
  max-width: 0;
  margin-left: calc(-1 * var(--model-row-gap));
  overflow: hidden;
  visibility: hidden;
  opacity: 0;
  transform: translateX(4px);
  pointer-events: none;
  transition: max-width 0.16s ease, margin-left 0.16s ease, opacity 0.16s ease, transform 0.16s ease, visibility 0.16s;
}

.model-row--figure:hover .model-row__quick-menu,
.model-row--figure:focus-within .model-row__quick-menu {
  max-width: 104px;
  margin-left: 0;
  opacity: 1;
  transform: translateX(0);
  visibility: visible;
  pointer-events: auto;
}

@media (prefers-reduced-motion: reduce) {
  .model-row__quick-menu {
    transition: none;
  }
}

.model-row__quick-btn {
  flex: none;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--ui-radius-compact);
  background: transparent;
  color: var(--ui-text);
  cursor: pointer;
}

.model-row__quick-btn:hover,
.model-row__quick-btn:focus-visible {
  background: var(--ui-hover);
  color: var(--ui-text);
}

.model-row__filter {
  color: var(--ui-muted);
}

.model-row__filter:hover {
  color: var(--ui-text);
}

.model-row__close:hover {
  background: var(--ui-danger);
  color: var(--ui-on-status);
}

.model-list__empty {
  flex: 1;
  margin: 0;
  padding: 24px 16px;
  color: var(--ui-muted);
  font-size: 13px;
  text-align: center;
}

.model-list__items--special {
  flex: 0 0 auto;
  padding: 6px 10px 0;
  overflow: visible;
}

.model-row--special {
  color: var(--ui-text);
  font-weight: 500;
  cursor: pointer;
}

.model-row--special:hover {
  background: var(--ui-control);
}

.model-row__marker { color: var(--ui-muted); margin-right: 4px; }

.model-list__divider {
  margin: 4px 0;
  border: none;
  border-top: 1px solid var(--ui-line);
}

.model-list__header--secondary {
  padding: 8px 12px 12px;
  border-bottom: 1px solid var(--ui-line);
}

.model-list__items--groups {
  border-top: 1px solid var(--ui-line);
}

.model-row--group {
  background: var(--ui-well);
}

.model-row__group-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 6px;
  background: var(--ui-alternate);
  color: var(--ui-on-status);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

@container (max-width: 310px) {
  .model-row--figure { --model-row-gap: 5px; }
  .model-row__quick-actions { margin-right: 0; }
  .model-row__quick-btn { width: 22px; }
}

.model-list__section-title {
  flex: none;
  margin: 10px 18px 2px;
  color: var(--ui-muted);
  font-size: 11px;
  font-weight: 500;
}

.model-row.drop-before::before,
.model-row.drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--ui-accent);
  pointer-events: none;
}
.model-row.drop-before::before { top: -2px; }
.model-row.drop-after::after { bottom: -2px; }
</style>
