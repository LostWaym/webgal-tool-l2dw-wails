<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { parseMotions, type MotionEntry } from '../../live2d/coreAdapter'
import type { WmdlConfig, WmdlModelItem } from '../../stores/wmdlTypes'
import { useMessage } from '../../composables/useMessage'
import { loadModelMotion } from '../../utils/loadModelMotion'
import { motionFrameTime, sampleMotionFrame, type MotionSource } from '../../utils/motionImport'
import { filterBySearch } from '../../utils/searchUtils'
import Live2dPreview from '../common/Live2dPreview.vue'
import SearchInput from '../common/SearchInput.vue'

const props = defineProps<{ model: WmdlModelItem; config: WmdlConfig; physicsIds: Set<string> }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'apply', modelId: string, values: Array<{ id: string; val: number }>): void
}>()

const msg = useMessage()
const previewReady = ref(false)
const search = ref('')
const motion = shallowRef<MotionSource | null>(null)
const selected = ref<string | null>(null)
const frame = ref(0)
const loading = ref(false)
let loadToken = 0

const previewConfig = computed<WmdlConfig>(() => ({
  ...props.config,
  models: [{ ...props.model, offsetX: 0, offsetY: 0 }],
}))
const motions = computed(() => parseMotions(props.model.rawJsonObject, true))
const filteredMotions = computed(() => filterBySearch(motions.value, search.value, (item) => item.name))
const editableDefaults = computed(() => props.model.initParams
  .filter((param) => !props.physicsIds.has(param.id)))
const sampledValues = computed(() => {
  if (!motion.value) return []
  const valid = new Set(editableDefaults.value.map((param) => param.id))
  return sampleMotionFrame(motion.value, frame.value).filter(({ id }) => valid.has(id))
})
const pose = computed(() => {
  const sampled = new Map(sampledValues.value.map(({ id, val }) => [id, val]))
  return editableDefaults.value.map((param) => ({ id: param.id, val: sampled.get(param.id) ?? param.value }))
})
watch(() => props.model.jsonAbsPath, () => {
  loadToken++
  motion.value = null
  selected.value = null
  frame.value = 0
  loading.value = false
  previewReady.value = false
})

async function selectMotion(item: MotionEntry) {
  const token = ++loadToken
  motion.value = null
  selected.value = null
  frame.value = 0
  loading.value = true
  try {
    const result = await loadModelMotion(props.model.jsonAbsPath, item)
    if (token !== loadToken) return
    motion.value = result
    selected.value = item.name
  } catch (err) {
    if (token === loadToken) msg.error(`无法加载动作「${item.name}」：${err}`)
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function apply() {
  if (!motion.value || !previewReady.value || loading.value) return
  if (!sampledValues.value.length) {
    msg.warning('该动作没有可应用的模型参数')
    return
  }
  emit('apply', props.model.id, sampledValues.value)
}

onBeforeUnmount(() => { loadToken++ })
</script>

<template>
  <Teleport to="body">
    <div class="sample-mask" @click.self="emit('close')">
      <section class="ui-dialog sample-modal" role="dialog" aria-modal="true" aria-labelledby="motion-sample-title">
        <header class="sample-header">
          <h2 id="motion-sample-title">从动作采样表情</h2>
          <span v-if="motion?.skippedTargets.length" class="sample-warning" role="status"
            :title="`已跳过非参数曲线：${motion.skippedTargets.join('、')}`">
            已跳过非参数曲线：{{ motion.skippedTargets.join('、') }}
          </span>
          <button type="button" class="sample-close" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="sample-body">
          <aside class="sample-list">
            <SearchInput v-model="search" variant="edit" placeholder="搜索动作（空格分隔关键词）" />
            <div class="sample-list__scroll">
              <p v-if="!motions.length" class="sample-hint">当前模型没有动作</p>
              <p v-else-if="!filteredMotions.length" class="sample-hint">没有匹配的动作</p>
              <button v-for="item in filteredMotions" :key="item.name" type="button" class="sample-list__item"
                :class="{ 'is-active': selected === item.name }" :title="item.path || '文件路径缺失'" @click="selectMotion(item)">
                {{ item.name }}
              </button>
            </div>
          </aside>
          <div class="sample-preview">
            <Live2dPreview :wmdl-config="previewConfig" :fixed-pose="pose" @loaded="previewReady = true"
              @load-error="msg.error('采样预览模型加载失败')" />
          </div>
        </div>
        <div class="sample-timeline">
          <span>{{ motion ? `${frame} / ${motion.lastFrame} 帧 · ${motionFrameTime(motion, frame).toFixed(2)} 秒` : '请选择动作' }}</span>
          <input v-model.number="frame" type="range" min="0" :max="motion?.lastFrame ?? 0" step="1" :disabled="!motion || loading" aria-label="动作采样帧" />
        </div>
        <footer class="sample-footer">
          <button type="button" class="sample-btn" @click="emit('close')">关闭</button>
          <button type="button" class="sample-btn sample-btn--primary" :disabled="!motion || !previewReady || loading" @click="apply">应用</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.sample-mask { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: var(--ui-scrim); }
.sample-modal { width: min(1000px, 92vw); height: min(740px, 90vh); display: flex; flex-direction: column; overflow: hidden; }
.sample-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--ui-line); }
.sample-header h2 { margin: 0 auto 0 0; font-size: 16px; flex-shrink: 0; }
.sample-close { background: none; border: 0; color: var(--ui-text); font-size: 24px; cursor: pointer; flex-shrink: 0; }
.sample-warning { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ui-warning); font-size: 12px; }
.sample-body { display: flex; flex: 1; min-height: 0; }
.sample-list { width: 250px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-right: 1px solid var(--ui-line); }
.sample-list__scroll { overflow: auto; min-height: 0; }
.sample-list__item { display: block; width: 100%; padding: 8px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: transparent; border: 0; border-radius: 4px; color: var(--ui-text); cursor: pointer; }
.sample-list__item:hover, .sample-list__item.is-active { background: var(--ui-hover); }
.sample-hint { color: var(--ui-muted); font-size: 12px; }
.sample-preview { flex: 1; display: flex; min-width: 0; min-height: 0; }
.sample-timeline { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--ui-line); font-size: 12px; }
.sample-timeline span { min-width: 150px; }
.sample-timeline input { flex: 1; min-width: 0; }
.sample-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--ui-line); }
.sample-btn { padding: 6px 14px; background: var(--ui-hover); border: 1px solid var(--ui-edge); border-radius: 4px; color: var(--ui-text); cursor: pointer; }
.sample-btn--primary { background: var(--ui-accent); border-color: var(--ui-link); color: var(--ui-on-accent); }
.sample-btn:disabled { opacity: .45; cursor: not-allowed; }
</style>
