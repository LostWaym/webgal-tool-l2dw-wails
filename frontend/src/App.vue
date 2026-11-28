<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, nextTick, watch } from 'vue'
import ModelList from './components/ModelPreviewApp/ModelList.vue'
import Stage from './components/ModelPreviewApp/Stage.vue'
import ModelActionPanel from './components/ModelPreviewApp/ModelActionPanel.vue'
import FocusMode from './components/ModelPreviewApp/FocusMode.vue'
import TransformSnapshotModal from './components/ModelPreviewApp/Modal/TransformSnapshotModal.vue'
import FilterPresetModal from './components/ModelPreviewApp/Modal/FilterPresetModal.vue'
import BackgroundHistoryModal from './components/ModelPreviewApp/Modal/BackgroundHistoryModal.vue'
import PreviewProjectModal from './components/ModelPreviewApp/Modal/PreviewProjectModal.vue'
import PreviewGuideManagerModal from './components/ModelPreviewApp/Modal/PreviewGuideManagerModal.vue'
import PreviewSettingsModal from './components/ModelPreviewApp/Modal/PreviewSettingsModal.vue'
import { applyPreviewProject } from './utils/previewProject'
import type { PreviewProject } from './utils/previewProject'
import { useMessage } from './composables/useMessage'
import ColorPickerModal from './components/common/ColorPickerModal.vue'
import MessageHost from './components/common/MessageHost.vue'
import UiIcon from './components/common/UiIcon.vue'
import { useModelStore } from './stores/previewStore'
import { useShortcuts } from './composables/useShortcuts'
import { usePreviewModelReload } from './composables/usePreviewModelReload'
import { usePreviewGuideVisibility } from './composables/usePreviewGuideVisibility'
import { usePreviewAutoHidePanels } from './composables/usePreviewAutoHidePanels'
import emitter, { StageEvents } from './stores/emitter'

const store = useModelStore()
const { handleShortcut, isInputFocused } = useShortcuts()
const { reloadConfig } = usePreviewModelReload()
const guideVisibility = usePreviewGuideVisibility()
const { leftEnabled: autoHideLeftPanel, rightEnabled: autoHideRightPanel } = usePreviewAutoHidePanels()
const leftPanelOpen = ref(false)
const rightPanelOpen = ref(false)
const leftPanelPinned = ref(false)
const rightPanelPinned = ref(false)
const edgeSize = 32
const panelLeaveTolerance = 12
let panelPointerDown = false

function hasPanelInputFocus(selector: string) {
  return isInputFocused() && !!document.activeElement?.closest(selector)
}

function updatePanelVisibility(e: MouseEvent) {
  if (panelPointerDown && !e.buttons) panelPointerDown = false
  if ((!autoHideLeftPanel.value && !autoHideRightPanel.value) || panelPointerDown || e.buttons) return
  const leftWidth = document.querySelector<HTMLElement>('.app__left')?.offsetWidth ?? 0
  const rightWidth = document.querySelector<HTMLElement>('.model-action-panel')?.offsetWidth ?? 0
  leftPanelOpen.value = autoHideLeftPanel.value && (leftPanelPinned.value || hasPanelInputFocus('.app__left') || e.clientX <= (leftPanelOpen.value ? leftWidth + panelLeaveTolerance : edgeSize))
  rightPanelOpen.value = autoHideRightPanel.value && !!store.selectedId && (rightPanelPinned.value || hasPanelInputFocus('.model-action-panel') || e.clientX >= window.innerWidth - (rightPanelOpen.value ? rightWidth + panelLeaveTolerance : edgeSize))
}

function onPanelPointerDown(e: MouseEvent) {
  if ((!autoHideLeftPanel.value && !autoHideRightPanel.value) || !(e.target instanceof Element)) return
  panelPointerDown = !!e.target.closest('.app__left, .model-action-panel')
}

function onPanelPointerUp(e: MouseEvent) {
  panelPointerDown = false
  updatePanelVisibility(e)
}

function resetPanels() {
  panelPointerDown = false
  leftPanelOpen.value = autoHideLeftPanel.value && (leftPanelPinned.value || hasPanelInputFocus('.app__left'))
  rightPanelOpen.value = autoHideRightPanel.value && !!store.selectedId && (rightPanelPinned.value || hasPanelInputFocus('.model-action-panel'))
}

function togglePanelPin(side: 'left' | 'right') {
  const pinned = side === 'left' ? leftPanelPinned : rightPanelPinned
  const open = side === 'left' ? leftPanelOpen : rightPanelOpen
  pinned.value = !pinned.value
  open.value = true
}

function onWindowMouseLeave(e: MouseEvent) {
  if (!panelPointerDown && (e.clientX <= 0 || e.clientX >= window.innerWidth)) resetPanels()
}

watch(autoHideLeftPanel, enabled => { leftPanelPinned.value = false; leftPanelOpen.value = enabled && hasPanelInputFocus('.app__left') })
watch(autoHideRightPanel, enabled => { rightPanelPinned.value = false; rightPanelOpen.value = enabled && !!store.selectedId && hasPanelInputFocus('.model-action-panel') })
watch(() => store.selectedId, id => {
  if (!id) rightPanelOpen.value = false
})

// Blender 风格变换操作状态：让侧边栏呈现变暗且不可点击
const isTransforming = ref(false)
const projectVisible = ref(false)
const guideManagerVisible = ref(false)
const settingsVisible = ref(false)
const settingsTab = ref<'motionExpression' | undefined>()
const stageVisible = ref(true)
const panelMinWidths = { left: 270, right: 200 }
const maxPanelWidth = 500
const minStageWidth = 240
const preferredPanelWidths = { left: ref(320), right: ref(360) }
const viewportWidth = ref(window.innerWidth)
// 只约束实际宽度，窗口放大后恢复用户的拖拽偏好。
const modelListWidth = computed(() => Math.min(
  preferredPanelWidths.left.value,
  Math.max(panelMinWidths.left, viewportWidth.value - minStageWidth - (store.selectedId ? panelMinWidths.right : 0)),
))
const actionPanelWidth = computed(() => store.selectedId ? Math.min(
  preferredPanelWidths.right.value,
  Math.max(panelMinWidths.right, viewportWidth.value - modelListWidth.value - minStageWidth),
) : 0)
const focusVisible = ref(false)
const focusMode = ref<InstanceType<typeof FocusMode> | null>(null)

function onPanelResize(side: keyof typeof panelMinWidths, width: number) {
  preferredPanelWidths[side].value = Math.max(panelMinWidths[side], Math.min(maxPanelWidth, width))
}

function onWindowResize() {
  viewportWidth.value = window.innerWidth
}

function onKeydown(e: KeyboardEvent) {
  if (guideManagerVisible.value) return
  const ctrlOnly = e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
  const key = e.key.toLowerCase()
  if (ctrlOnly && key === 'm') {
    if (!stageVisible.value || focusVisible.value || isInputFocused() || document.activeElement instanceof HTMLSelectElement) return
    e.preventDefault()
    if (!e.repeat) {
      const visible = !guideVisibility.alwaysShowGuides.value
      guideVisibility.update(visible)
      useMessage().info(visible ? '已开启常驻游标显示' : '已关闭常驻游标显示')
    }
    return
  }
  if (ctrlOnly && key === 'r') {
    e.preventDefault()
    if (e.repeat || isInputFocused()) return
    if (focusVisible.value) {
      void focusMode.value?.reload()
    } else if (store.selectedModel?.kind === 'live2d' && stageVisible.value) {
      reloadConfig(store.selectedModel.id)
    }
    return
  }
  if (ctrlOnly && key === 'q') {
    if (isInputFocused()) return
    if (focusVisible.value) {
      e.preventDefault()
      focusVisible.value = false
    } else if (store.selectedModel?.kind !== 'image' && store.selectedModel?.wmdlConfig) {
      e.preventDefault()
      focusVisible.value = true
    }
    return
  }
  if (!focusVisible.value) handleShortcut(e)
}

async function loadProject(project: PreviewProject, path: string) {
  projectVisible.value = false
  stageVisible.value = false
  await nextTick()
  try {
    await applyPreviewProject(store, project, path)
    useMessage().success('项目已加载')
  } catch (err) {
    useMessage().error(`加载项目失败：${String(err)}`)
  } finally {
    stageVisible.value = true
  }
}

function onTransformStart(active: boolean) {
  isTransforming.value = active
}

function openMotionExpressionSettings() {
  settingsTab.value = 'motionExpression'
  settingsVisible.value = true
}

function closeSettings() {
  settingsVisible.value = false
  settingsTab.value = undefined
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mousemove', updatePanelVisibility)
  window.addEventListener('mousedown', onPanelPointerDown)
  window.addEventListener('mouseup', onPanelPointerUp)
  window.addEventListener('blur', resetPanels)
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('mouseleave', onWindowMouseLeave)
  emitter.on(StageEvents.TransformStart, onTransformStart)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', updatePanelVisibility)
  window.removeEventListener('mousedown', onPanelPointerDown)
  window.removeEventListener('mouseup', onPanelPointerUp)
  window.removeEventListener('blur', resetPanels)
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('mouseleave', onWindowMouseLeave)
  emitter.off(StageEvents.TransformStart, onTransformStart)
})
</script>

<template>
  <div
    class="app"
    :class="{ 'is-transforming': isTransforming, 'has-action-panel': store.selectedId, 'auto-hide-left-panel': autoHideLeftPanel, 'auto-hide-right-panel': autoHideRightPanel, 'left-panel-open': leftPanelOpen, 'right-panel-open': rightPanelOpen }"
    :style="{ '--preview-action-width': `${actionPanelWidth}px`, '--preview-list-width': `${modelListWidth}px`, '--preview-panel-edge-size': `${edgeSize}px` }"
  >
    <ModelList class="app__left" :inert="autoHideLeftPanel && !leftPanelOpen ? '' : undefined" @resize="onPanelResize('left', $event)" @project="projectVisible = true" @guides="guideManagerVisible = true" @settings="settingsVisible = true" />
    <Stage v-if="stageVisible" class="app__right" :interaction-disabled="focusVisible || guideManagerVisible" :guide-manager-visible="guideManagerVisible" />
    <ModelActionPanel v-if="store.selectedId" :inert="autoHideRightPanel && !rightPanelOpen ? '' : undefined" @resize="onPanelResize('right', $event)" @open-motion-expression-settings="openMotionExpressionSettings" />
    <template v-if="!focusVisible && !isTransforming && !settingsVisible && !projectVisible && !guideManagerVisible">
      <button v-if="autoHideLeftPanel" type="button" class="app__edge-hint app__edge-hint--left" :class="{ 'is-pinned': leftPanelPinned }" :aria-pressed="leftPanelPinned" :aria-label="leftPanelPinned ? '左侧面板恢复自动隐藏' : '展开并固定左侧面板'" :title="leftPanelPinned ? '恢复自动隐藏' : '展开并固定左侧面板'" @click="togglePanelPin('left')">
        <UiIcon :name="leftPanelPinned ? 'pin' : 'right'" />
      </button>
      <button v-if="autoHideRightPanel && store.selectedId" type="button" class="app__edge-hint app__edge-hint--right" :class="{ 'is-pinned': rightPanelPinned }" :aria-pressed="rightPanelPinned" :aria-label="rightPanelPinned ? '右侧面板恢复自动隐藏' : '展开并固定右侧面板'" :title="rightPanelPinned ? '恢复自动隐藏' : '展开并固定右侧面板'" @click="togglePanelPin('right')">
        <UiIcon :name="rightPanelPinned ? 'pin' : 'left'" />
      </button>
    </template>
    <TransformSnapshotModal />
    <FilterPresetModal />
    <BackgroundHistoryModal />
    <PreviewProjectModal :visible="projectVisible" @close="projectVisible = false" @load="loadProject" />
    <PreviewGuideManagerModal :visible="guideManagerVisible" @close="guideManagerVisible = false" />
    <PreviewSettingsModal :visible="settingsVisible" :initial-tab="settingsTab" @close="closeSettings" />
    <ColorPickerModal />
    <FocusMode v-if="focusVisible" ref="focusMode" @close="focusVisible = false" />
    <MessageHost />
  </div>
</template>

<style>
.app {
  display: flex;
  flex-direction: row;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--ui-window);
}

.app__left {
  width: var(--preview-list-width);
  flex-shrink: 0;
  border-right: 1px solid var(--ui-line);
  border-radius: 0 var(--ui-radius-panel) var(--ui-radius-panel) 0;
}

.app__right {
  flex: 1;
  min-width: 0;
}

.app__edge-hint {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 64px;
  padding: 0;
  z-index: 101;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-floating);
  color: var(--ui-muted);
  border: 1px solid var(--ui-control-line);
  border-radius: var(--ui-radius-pill);
  box-shadow: var(--ui-control-shadow);
  opacity: 0.8;
  font-size: 16px;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.18s ease, background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.app__edge-hint:hover,
.app__edge-hint:focus-visible,
.app__edge-hint.is-pinned { opacity: 1; background: var(--ui-control-fill); color: var(--ui-link); box-shadow: var(--ui-panel-shadow); }

.app__edge-hint--left {
  left: 3px;
}

.app__edge-hint--right {
  right: 3px;
}

.app.auto-hide-left-panel .app__left {
  position: fixed;
  z-index: 100;
  top: 0;
  bottom: 0;
  left: 0;
  transform: translateX(-100%);
  pointer-events: none;
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s ease;
}

.app.auto-hide-left-panel {
  --preview-stage-left-inset: var(--preview-panel-edge-size);
}

.app.auto-hide-left-panel.left-panel-open {
  --preview-stage-left-inset: var(--preview-list-width);
}

.app.auto-hide-right-panel .model-action-panel {
  transform: translateX(100%);
  pointer-events: none;
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s ease;
}

.app.auto-hide-left-panel.left-panel-open .app__left,
.app.auto-hide-right-panel.right-panel-open .model-action-panel {
  transform: translateX(0);
  pointer-events: auto;
}

.app.auto-hide-right-panel.has-action-panel:not(.right-panel-open) {
  --preview-action-obstruction: var(--preview-panel-edge-size);
}

@media (prefers-reduced-motion: reduce) {
  .app__edge-hint,
  .app.auto-hide-left-panel .app__left,
  .app.auto-hide-right-panel .model-action-panel {
    transition: none;
  }
}

.app.is-transforming .app__left,
.app.is-transforming .model-action-panel,
.app.auto-hide-left-panel.is-transforming .app__left,
.app.auto-hide-right-panel.is-transforming .model-action-panel {
  pointer-events: none;
  opacity: 0.5;
  transition: opacity 0.15s ease;
}
</style>
