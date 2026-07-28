<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import ModelList from './components/ModelList.vue'
import Stage from './components/Stage.vue'
import ModelActionPanel from './components/ModelActionPanel.vue'
import MessageHost from './components/common/MessageHost.vue'
import { useModelStore } from './stores/models'
import { useShortcuts } from './composables/useShortcuts'

const store = useModelStore()
const { handleShortcut } = useShortcuts()

onMounted(() => window.addEventListener('keydown', handleShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', handleShortcut))
</script>

<template>
  <div class="app">
    <ModelList class="app__left" />
    <Stage class="app__right" />
    <ModelActionPanel v-if="store.selectedId" />
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
</style>
