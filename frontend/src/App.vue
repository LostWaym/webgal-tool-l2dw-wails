<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import ModelList from './components/ModelPreviewApp/ModelList.vue'
import Stage from './components/ModelPreviewApp/Stage.vue'
import ModelActionPanel from './components/ModelPreviewApp/ModelActionPanel.vue'
import TransformSnapshotModal from './components/ModelPreviewApp/Modal/TransformSnapshotModal.vue'
import MessageHost from './components/common/MessageHost.vue'
import { useModelStore } from './stores/models'
import { useShortcuts } from './composables/useShortcuts'
import emitter, { StageEvents } from './stores/emitter'

const store = useModelStore()
const { handleShortcut } = useShortcuts()

// Blender 风格变换操作状态：让侧边栏呈现变暗且不可点击
const isTransforming = ref(false)

function onTransformStart(active: boolean) {
  isTransforming.value = active
}

onMounted(() => {
  window.addEventListener('keydown', handleShortcut)
  emitter.on(StageEvents.TransformStart, onTransformStart)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShortcut)
  emitter.off(StageEvents.TransformStart, onTransformStart)
})
</script>

<template>
  <div class="app" :class="{ 'is-transforming': isTransforming }">
    <ModelList class="app__left" />
    <Stage class="app__right" />
    <ModelActionPanel v-if="store.selectedId" />
    <TransformSnapshotModal />
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
  background: #181a20;
}

.app__left {
  width: 260px;
  min-width: 220px;
  flex-shrink: 0;
  border-right: 1px solid #2c313a;
}

.app__right {
  flex: 1;
  min-width: 0;
}

.app.is-transforming .app__left,
.app.is-transforming .model-action-panel {
  pointer-events: none;
  opacity: 0.5;
  transition: opacity 0.15s ease;
}
</style>
