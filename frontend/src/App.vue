<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick, watch } from 'vue'
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
const edgeSize = 24
let panelPointerDown = false

function updatePanelVisibility(e: MouseEvent) {
  if (panelPointerDown && !e.buttons) panelPointerDown = false
  if ((!autoHideLeftPanel.value && !autoHideRightPanel.value) || panelPointerDown || e.buttons) return
  const leftWidth = document.querySelector<HTMLElement>('.app__left')?.offsetWidth ?? 0
  const rightWidth = document.querySelector<HTMLElement>('.model-action-panel')?.offsetWidth ?? 0
  leftPanelOpen.value = autoHideLeftPanel.value && e.clientX <= (leftPanelOpen.value ? leftWidth : edgeSize)
  rightPanelOpen.value = autoHideRightPanel.value && !!store.selectedId && e.clientX >= window.innerWidth - (rightPanelOpen.value ? rightWidth : edgeSize)
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
  leftPanelOpen.value = false
  rightPanelOpen.value = false
}

function onWindowMouseLeave() {
  if (!panelPointerDown) resetPanels()
}

watch(autoHideLeftPanel, () => { leftPanelOpen.value = false })
watch(autoHideRightPanel, () => { rightPanelOpen.value = false })
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
const actionPanelWidth = ref<number>()
const focusVisible = ref(false)
const focusMode = ref<InstanceType<typeof FocusMode> | null>(null)

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
  document.addEventListener('mouseleave', onWindowMouseLeave)
  emitter.on(StageEvents.TransformStart, onTransformStart)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', updatePanelVisibility)
  window.removeEventListener('mousedown', onPanelPointerDown)
  window.removeEventListener('mouseup', onPanelPointerUp)
  window.removeEventListener('blur', resetPanels)
  document.removeEventListener('mouseleave', onWindowMouseLeave)
  emitter.off(StageEvents.TransformStart, onTransformStart)
})
</script>

<template>
  <div
    class="app"
    :class="{ 'is-transforming': isTransforming, 'has-action-panel': store.selectedId, 'auto-hide-left-panel': autoHideLeftPanel, 'auto-hide-right-panel': autoHideRightPanel, 'left-panel-open': leftPanelOpen, 'right-panel-open': rightPanelOpen }"
    :style="{ '--preview-action-preferred-width': actionPanelWidth === undefined ? undefined : `${actionPanelWidth}px` }"
  >
    <ModelList class="app__left" :inert="autoHideLeftPanel && !leftPanelOpen ? '' : undefined" @project="projectVisible = true" @guides="guideManagerVisible = true" @settings="settingsVisible = true" />
    <Stage v-if="stageVisible" class="app__right" :interaction-disabled="focusVisible || guideManagerVisible" :guide-manager-visible="guideManagerVisible" />
    <ModelActionPanel v-if="store.selectedId" :inert="autoHideRightPanel && !rightPanelOpen ? '' : undefined" @resize="actionPanelWidth = $event" @open-motion-expression-settings="openMotionExpressionSettings" />
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
  width: clamp(270px, 23.2vw, 376px);
  flex-shrink: 0;
  border-right: 1px solid var(--ui-line);
  border-radius: 0 var(--ui-radius-panel) var(--ui-radius-panel) 0;
}

.app__right {
  flex: 1;
  min-width: 0;
}

.app.has-action-panel {
  --preview-action-width: min(
    var(--preview-action-preferred-width, clamp(280px, 25.2vw, 408px)),
    max(200px, calc(100vw - 560px))
  );
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

.app.auto-hide-right-panel:not(.right-panel-open) {
  --preview-action-obstruction: 0px;
}

@media (prefers-reduced-motion: reduce) {
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
