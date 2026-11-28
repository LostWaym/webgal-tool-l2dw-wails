<script setup lang="ts">
import { computed, ref } from 'vue'
import ThemeSelect from '../common/ThemeSelect.vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { reloadAllModelTextures } from '../../live2d/textureUtils'
import { useMessage } from '../../composables/useMessage'
import type { Live2DModel } from 'pixi-live2d-display-webgal'

const props = defineProps<{
  live2dById: Map<string, Live2DModel>
  jsonPathByModelId: Map<string, string>
  background: string
}>()
const emit = defineEmits<{
  (event: 'reset-view'): void
  (event: 'update:background', value: string): void
}>()
const backgroundOptions = [
  { value: 'theme', label: '跟随主题' }, { value: 'checker', label: '透明棋盘格' },
  { value: 'dark', label: '深色' }, { value: 'light', label: '浅色' },
]
const busy = ref(false)

const store = useWmdlModelEditorStore()
const msg = useMessage()

const modelsEmpty = computed(() => store.currentWmdl.models.length === 0)

async function onReloadAllClick() {
  if (busy.value) return
  busy.value = true
  let success = 0
  let failed = 0
  try {
    for (const item of store.currentWmdl.models) {
      const model = props.live2dById.get(item.id)
      const jsonAbs = props.jsonPathByModelId.get(item.id)
      if (!model || !jsonAbs || !await reloadAllModelTextures(model, jsonAbs)) failed++
      else success++
    }
    if (failed) msg.warning(`纹理重载：成功 ${success} 个模型，失败 ${failed} 个，请检查模型与纹理路径`)
    else if (success) msg.success(`已从磁盘重新加载 ${success} 个模型的纹理`)
    else msg.warning('没有已加载的模型')
  } catch (error) {
    msg.error(`纹理重载失败：${error}`)
  } finally {
    busy.value = false
  }
}

function onWatchChange(checked: boolean) {
  store.setDynamicTextureWatch(checked)
}
</script>

<template>
  <div class="stage-toolbar">
    <button
      class="ui-button toolbar-btn"
      :disabled="modelsEmpty || busy"
      @click="onReloadAllClick"
    >
      重载纹理
    </button>
    <label class="toolbar-toggle">
      <input
        class="ui-switch"
        type="checkbox"
        role="switch"
        :checked="store.dynamicTextureWatch"
        :disabled="modelsEmpty"
        @change="onWatchChange(($event.target as HTMLInputElement).checked)"
      />
      动态更新纹理
    </label>
    <button class="ui-button toolbar-btn" @click="emit('reset-view')">重置视角</button>
    <ThemeSelect id="model-editor-canvas" class="canvas-select" :model-value="background" :options="backgroundOptions" label="画布底色" compact
      @update:model-value="emit('update:background', String($event))" />
  </div>
</template>

<style scoped>
.stage-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--ui-panel);
  border-bottom: 1px solid var(--ui-line);
  flex-shrink: 0;
}

.toolbar-btn {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: var(--ui-radius-compact);
}
.canvas-select { width: 130px; flex: 0 0 130px; font-size: 12px; }

.toolbar-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ui-text);
  user-select: none;
  cursor: pointer;
}

.toolbar-toggle:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
