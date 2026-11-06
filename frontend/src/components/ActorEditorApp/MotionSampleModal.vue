<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ReadTextFile } from '../../../wailsjs/go/main/App'
import { parseMotions, type MotionEntry } from '../../live2d/coreAdapter'
import { pathCombine, pathDirname } from '../../path_utils'
import type { LanimFile } from '../../stores/motionEditor'
import type { WmdlConfig, WmdlModelItem } from '../../stores/wmdlTypes'
import { useMessage } from '../../composables/useMessage'
import { parseMtn } from '../../utils/motionImport'
import { filterBySearch } from '../../utils/searchUtils'
import Live2dPreview from '../common/Live2dPreview.vue'
import SearchInput from '../common/SearchInput.vue'

const props = defineProps<{ model: WmdlModelItem; config: WmdlConfig; physicsIds: Set<string> }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'apply', modelId: string, values: Array<{ id: string; val: number }>): void
}>()

const msg = useMessage()
const preview = ref<InstanceType<typeof Live2dPreview> | null>(null)
const previewReady = ref(false)
const search = ref('')
const anim = ref<LanimFile | null>(null)
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
const lastFrame = computed(() => anim.value
  ? Math.max(0, ...anim.value.tracks.map((track) => track.keys.length - 1))
  : 0)
const sampledValues = computed(() => {
  if (!anim.value) return []
  const valid = new Set(props.model.initParams.map((param) => param.id))
  return anim.value.tracks.flatMap((track) => {
    if (!valid.has(track.paramId) || props.physicsIds.has(track.paramId) || !track.keys.length) return []
    const key = track.keys[Math.min(frame.value, track.keys.length - 1)]
    return [{ id: track.paramId, val: key.v }]
  })
})

function updatePreview() {
  if (!previewReady.value) return
  const defaults = props.model.initParams
    .filter((param) => !props.physicsIds.has(param.id))
    .map((param) => ({ id: param.id, val: param.value, calc: 'set' as const }))
  preview.value?.applyParameters(defaults)
  preview.value?.applyParameters(sampledValues.value.map((item) => ({ ...item, calc: 'set' as const })))
}

watch([sampledValues, previewReady], updatePreview)

async function selectMotion(item: MotionEntry) {
  const token = ++loadToken
  anim.value = null
  selected.value = null
  frame.value = 0
  loading.value = false
  if (!item.path || !props.model.jsonAbsPath) {
    msg.error(`动作「${item.name}」没有可用的文件路径`)
    return
  }
  if (!item.path.toLowerCase().endsWith('.mtn')) {
    msg.error(`动作「${item.name}」不是 MTN 文件`)
    return
  }
  loading.value = true
  try {
    const path = pathCombine(pathDirname(props.model.jsonAbsPath), item.path)
    const text = await ReadTextFile(path)
    const result = parseMtn(text, item.name)
    if (token !== loadToken) return
    anim.value = result
    selected.value = item.name
  } catch (err) {
    if (token === loadToken) msg.error(`无法加载动作「${item.name}」：${err}`)
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function apply() {
  if (!anim.value || !previewReady.value || loading.value) return
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
      <section class="sample-modal" role="dialog" aria-modal="true" aria-labelledby="motion-sample-title">
        <header class="sample-header">
          <h2 id="motion-sample-title">从动作采样表情</h2>
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
            <Live2dPreview ref="preview" :wmdl-config="previewConfig" @loaded="previewReady = true"
              @load-error="msg.error('采样预览模型加载失败')" />
          </div>
        </div>
        <div class="sample-timeline">
          <span>{{ anim ? `${frame} / ${lastFrame} 帧 · ${(frame / anim.fps).toFixed(2)} 秒` : '请选择动作' }}</span>
          <input v-model.number="frame" type="range" min="0" :max="lastFrame" step="1" :disabled="!anim || loading" aria-label="动作采样帧" />
        </div>
        <footer class="sample-footer">
          <button type="button" class="sample-btn" @click="emit('close')">关闭</button>
          <button type="button" class="sample-btn sample-btn--primary" :disabled="!anim || !previewReady || loading" @click="apply">应用</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.sample-mask { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .7); }
.sample-modal { width: min(1000px, 92vw); height: min(740px, 90vh); display: flex; flex-direction: column; background: #242830; color: #e6e6e6; border: 1px solid #3a4150; border-radius: 8px; overflow: hidden; }
.sample-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #3a4150; }
.sample-header h2 { margin: 0; font-size: 16px; }
.sample-close { background: none; border: 0; color: #cfd4dc; font-size: 24px; cursor: pointer; }
.sample-body { display: flex; flex: 1; min-height: 0; }
.sample-list { width: 250px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-right: 1px solid #3a4150; }
.sample-list__scroll { overflow: auto; min-height: 0; }
.sample-list__item { display: block; width: 100%; padding: 8px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: transparent; border: 0; border-radius: 4px; color: #e6e6e6; cursor: pointer; }
.sample-list__item:hover, .sample-list__item.is-active { background: #35465e; }
.sample-hint { color: #8a93a3; font-size: 12px; }
.sample-preview { flex: 1; display: flex; min-width: 0; min-height: 0; }
.sample-timeline { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid #3a4150; font-size: 12px; }
.sample-timeline span { min-width: 150px; }
.sample-timeline input { flex: 1; min-width: 0; }
.sample-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid #3a4150; }
.sample-btn { padding: 6px 14px; background: #343b49; border: 1px solid #4a5362; border-radius: 4px; color: #e6e6e6; cursor: pointer; }
.sample-btn--primary { background: #2f80ed; border-color: #2f80ed; }
.sample-btn:disabled { opacity: .45; cursor: not-allowed; }
</style>
