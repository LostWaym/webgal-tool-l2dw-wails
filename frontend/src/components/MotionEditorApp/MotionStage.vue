<script setup lang="ts">
/**
 * 动作编辑器的舞台容器。
 *
 * 与 ActorStage 相同的薄封装模式：复用 common/Live2dPreview.vue 渲染 wmdl 模型组，
 * 并在加载完成后把 Live2DModel 实例注册到 editRuntime.live2dModels，
 * 供 coreAdapter.listParameters 等运行时 API 使用。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import type { Live2DModel } from 'pixi-live2d-display-webgal'
import Live2dPreview from '../common/Live2dPreview.vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { editRuntime } from '../../utils/runtimeRegistry'
import type { ParamCalc } from '../../stores/wmdlTypes'

const store = useWmdlModelEditorStore()
const previewRef = ref<InstanceType<typeof Live2dPreview> | null>(null)

let loadToken = 0

async function syncRuntimeAndPopulate() {
  const cfg = store.currentWmdl
  if (!cfg?.models?.length) {
    editRuntime.live2dModels = new Map()
    return
  }
  const token = ++loadToken
  for (let i = 0; i < 80; i++) {
    if (token !== loadToken) return
    const models = previewRef.value?.getLoadedModels() ?? []
    if (models.length === cfg.models.length) {
      const map = new Map<string, Live2DModel>()
      cfg.models.forEach((item, idx) => map.set(item.id, models[idx]))
      editRuntime.live2dModels = map
      for (const item of cfg.models) {
        await store.populateInitValues(item.id)
        if (token !== loadToken) return
      }
      return
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

// 与 Live2dPreview 相同的模型组指纹：重载后自动重同步 runtime Map
watch(
  () => (store.currentWmdl?.models ?? []).map((m) => `${m.id}:${m.jsonAbsPath}`).join('|'),
  () => {
    void syncRuntimeAndPopulate()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  loadToken++
  editRuntime.live2dModels = new Map()
})

defineExpose({
  applyParameters(params: Array<{ id: string; val: number; calc: ParamCalc }>) {
    previewRef.value?.applyParameters(params)
  },
})
</script>

<template>
  <div class="motion-stage">
    <Live2dPreview ref="previewRef" :wmdl-config="store.currentWmdl" />
  </div>
</template>

<style scoped>
.motion-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
}
</style>
