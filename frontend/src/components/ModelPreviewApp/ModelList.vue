<script setup lang="ts">
import { ref } from 'vue'
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
const emit = defineEmits<{ (e: 'project'): void; (e: 'guides'): void; (e: 'settings'): void }>()
const bgHistoryModal = useBackgroundHistoryModal()
const filterPresetModal = useFilterPresetModal()
const snapshotModal = useTransformSnapshotModal()
const { reloadConfig, reloadTextures } = usePreviewModelReload()
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
      <button class="ui-button add-btn" @click="onAdd"><UiIcon name="model" />加载模型</button>
      <button class="ui-button add-btn" @click="onAddImage"><UiIcon name="image" />加载图片</button>
      <button class="ui-button add-btn" @click="onAddFigureGroup"><UiIcon name="group" />新建立绘组</button>
    </header>
    <header class="model-list__header model-list__header--secondary">
      <button class="ui-button add-btn" @click="emit('project')"><UiIcon name="project" />项目</button>
      <button class="ui-button add-btn" @click="emit('guides')"><UiIcon name="guides" />游标</button>
      <button class="ui-button add-btn" @click="emit('settings')"><UiIcon name="settings" />设置</button>
    </header>

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

    <ul v-if="store.models.length" class="model-list__items">
      <li
        v-for="(m, index) in store.models"
        :key="m.id"
          class="model-row model-row--figure"
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
            :title="m.visible ? '隐藏模型' : '显示模型'"
            @click="onToggleVisible(m.id, $event)"
          >
            <UiIcon :name="m.visible ? 'eye' : 'eyeOff'" />
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
            <button v-if="m.kind === 'live2d' && m.wmdlConfig?.wmdlFilePath" type="button" class="model-row__quick-btn" title="重载模型配置" aria-label="重载模型配置" @click.stop="reloadConfig(m.id)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 7v5h-5M4 17v-5h5" />
                <path d="M5.5 9a7 7 0 0 1 11.8-2L20 12M4 12l2.7 5a7 7 0 0 0 11.8-2" />
              </svg>
            </button>
            <button v-if="m.kind === 'live2d'" type="button" class="model-row__quick-btn" title="重载纹理" aria-label="重载纹理" @click.stop="reloadTextures(m.id)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="8" cy="9" r="1.5" />
                <path d="m4 18 5-5 3 3 3-3 5 5" />
              </svg>
            </button>
          </div>
        </div>
        <span v-if="m.kind === 'image'" class="model-row__kind-badge" title="图片立绘">图</span>
        <span class="model-row__name" :title="m.jsonPath || m.imageUrl">{{ m.name }}</span>
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
  </aside>
</template>

<style scoped>
.model-list {
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
  overflow-y: auto;
  flex: 1;
}

.model-row {
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
  gap: 8px;
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
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 100%;
  transform: translateY(-50%);
  display: flex;
  padding: 2px;
  border: 1px solid var(--ui-line);
  border-radius: var(--ui-radius-control);
  background: var(--ui-control);
  box-shadow: 0 3px 8px var(--ui-shadow);
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
  flex: 0 0 auto;
  max-height: 35%;
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
</style>
