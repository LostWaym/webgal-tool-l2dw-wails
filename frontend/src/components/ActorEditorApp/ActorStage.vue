<script setup lang="ts">
/**
 * 演出编辑器的舞台容器。
 *
 * 直接复用 common/Live2dPreview.vue 渲染 wmdl 模型组，
 * 由其负责居中 / 缩放 / 重置按钮等所有视口交互。
 *
 * 但 Live2dPreview 的 subModels 是私有数组，不会写入
 * `editRuntime.live2dModels`，而 store.populateInitValues /
 * coreAdapter.listParameters 都通过 editRuntime.live2dModels 拿 Live2DModel。
 * 因此这里在 watch(wmdlConfig) 触发时：
 *   1. 等 Live2dPreview 加载完（getLoadedModels().length === models.length）
 *   2. 把 Live2DModel 实例按 model.id 注册到 editRuntime.live2dModels
 *   3. 调用 store.populateMotionsExps / store.populateInitValues 预热数据
 *
 * applyParameters 通过 Live2dPreview 暴露的同名方法转发，
 * 这样不用关心 Live2dPreview 内部是如何写参数的。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import type { Live2DModel } from 'pixi-live2d-display-webgal'
import Live2dPreview from '../common/Live2dPreview.vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { editRuntime } from '../../utils/runtimeRegistry'
import type { ParamCalc } from '../../stores/wmdlTypes'

const store = useWmdlModelEditorStore()
const previewRef = ref<InstanceType<typeof Live2dPreview> | null>(null)

/** 单调递增的加载版本号，用于取消过期的轮询 / populate 任务。 */
let loadToken = 0

/** 等 Live2dPreview 加载完，把子模型写入 editRuntime 并触发 store.populate*。 */
async function syncRuntimeAndPopulate() {
  const cfg = store.currentWmdl
  if (!cfg?.models?.length) {
    editRuntime.live2dModels = new Map()
    return
  }
  const token = ++loadToken
  // 轮询等待 Live2dPreview 完成加载（最多 ~4s）
  for (let i = 0; i < 80; i++) {
    if (token !== loadToken) return
    const models = previewRef.value?.getLoadedModels() ?? []
    if (models.length === cfg.models.length) {
      const map = new Map<string, Live2DModel>()
      cfg.models.forEach((item, idx) => map.set(item.id, models[idx]))
      editRuntime.live2dModels = map
      for (const item of cfg.models) {
        await store.populateMotionsExps(item.id)
        await store.populateInitValues(item.id)
        if (token !== loadToken) return
      }
      return
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

watch(
  () => store.currentWmdl.models.length,
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
  <div class="actor-stage">
    <Live2dPreview ref="previewRef" :wmdl-config="store.currentWmdl" />
  </div>
</template>

<style scoped>
.actor-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
}
</style>
