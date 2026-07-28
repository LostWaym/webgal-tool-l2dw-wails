<script setup lang="ts">
import { computed } from 'vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { reloadAllModelTextures } from '../../live2d/textureUtils'
import type { Live2DModel } from 'pixi-live2d-display-webgal'

const props = defineProps<{
  live2dById: Map<string, Live2DModel>
  jsonPathByModelId: Map<string, string>
}>()

const store = useWmdlModelEditorStore()

const modelsEmpty = computed(() => store.currentWmdl.models.length === 0)

async function onReloadAllClick() {
  for (const [modelId, model] of props.live2dById) {
    const jsonAbs = props.jsonPathByModelId.get(modelId)
    if (!jsonAbs) continue
    await reloadAllModelTextures(model, jsonAbs)
  }
}

function onWatchChange(checked: boolean) {
  store.setDynamicTextureWatch(checked)
}
</script>

<template>
  <div class="stage-toolbar">
    <button
      class="toolbar-btn"
      :disabled="modelsEmpty"
      @click="onReloadAllClick"
    >
      重载纹理
    </button>
    <label class="toolbar-toggle">
      <input
        type="checkbox"
        :checked="store.dynamicTextureWatch"
        :disabled="modelsEmpty"
        @change="onWatchChange(($event.target as HTMLInputElement).checked)"
      />
      动态更新纹理
    </label>
  </div>
</template>

<style scoped>
.stage-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: #1d2026;
  border-bottom: 1px solid #2c313a;
  flex-shrink: 0;
}

.toolbar-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: #2c313a;
  color: #e6e6e6;
  border: 1px solid #3a414c;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.toolbar-btn:hover:not(:disabled) {
  background: #353c47;
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #e6e6e6;
  user-select: none;
  cursor: pointer;
}

.toolbar-toggle input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.toolbar-toggle:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
