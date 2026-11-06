<script setup lang="ts">
/**
 * 动作编辑器主入口（--motion 模式）。
 *
 * 布局：左 Live2D 预览 / 右 轨道面板（参数卡片 + 时间轴合并）。
 * 帧制：编辑使用整数帧号；播放时通过 rAF 按实际时间采样小数帧。
 * 帧率/时长通过 FrameSettingsModal 编辑（缩短时长截断关键帧需二次确认）。
 * 保存/加载：.lanim.json，SaveModelJsonFileDialog 选路径 + WriteTextFile / ReadTextFile。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { choosePath } from '../../utils/fileDialog'
import MotionStage from './MotionStage.vue'
import MotionTrackPanel from './MotionTrackPanel.vue'
import FrameSettingsModal from './FrameSettingsModal.vue'
import MotionExportModal from './MotionExportModal.vue'
import MotionGifRenderModal from './MotionGifRenderModal.vue'
import MessageHost from '../common/MessageHost.vue'
import SearchInput from '../common/SearchInput.vue'
import ResizeHandle from '../ModelEditApp/ResizeHandle.vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import {
  useMotionEditorStore,
  sampleLanim,
  sampleLanimForPlayback,
  parseLanimJson,
  normalizeLanim,
  restoreParamDefaults,
} from '../../stores/motionEditor'
import { resolveComposerMembers, loadComposerDefsByIds } from '../../utils/motionComposors'
import { previewLanim } from '../../utils/motionKeyframes'
import { listParameters, parseMotions } from '../../live2d/coreAdapter'
import { parseMtn, unbakeKeys } from '../../utils/motionImport'
import { filterBySearch } from '../../utils/searchUtils'
import { useMessage } from '../../composables/useMessage'
import { useFrameSettingsModal } from '../../composables/useFrameSettingsModal'
import { useMotionExportModal } from '../../composables/useMotionExportModal'
import { useMotionGifRenderModal } from '../../composables/useMotionGifRenderModal'
import {
  PickLanimJsonFile,
  SaveLanimFileDialog,
  SaveModelJsonFile,
  ReadTextFile,
  EnsureDirAndOpenInExplorer,
} from '../../../wailsjs/go/main/App'
import { pathBasename, pathDirname, pathCombine } from '../../path_utils'
import type { MotionEntry } from '../../live2d/coreAdapter'
import type { LanimFile } from '../../stores/motionEditor'
import type { ParamCalc } from '../../stores/wmdlTypes'

const wmdlStore = useWmdlModelEditorStore()
const store = useMotionEditorStore()
const msg = useMessage()
const frameModal = useFrameSettingsModal()
const exportModal = useMotionExportModal()
const gifModal = useMotionGifRenderModal()

const stageRef = ref<InstanceType<typeof MotionStage> | null>(null)

// GIF 渲染抓帧桥接：转发 store 播放桥接 + Live2dPreview 抓帧能力给渲染模态。
// 写参数后逐模型显式 update：模型视觉求值（deform/physics）只发生在 update 里，
// ticker 驱动的 autoUpdate 与抓帧节奏无关，不手动 update 会抓到重复帧。
watch(stageRef, (stage) => {
  const preview = stage?.getPreview() ?? null
  if (preview) {
    gifModal.setBridge({
      applyParameters: (params) => {
        preview.applyParameters(params)
        const FIXED_DT = 1000 / 60
        for (const m of preview.getLoadedModels()) {
          ;(m as any).update?.(FIXED_DT)
        }
      },
      captureViewportFrame: (bg, w, h) => preview.captureViewportFrame(bg, w, h),
      getViewportPixelSize: () => preview.getViewportPixelSize(),
    })
  } else {
    gifModal.setBridge(null)
  }
})

const wmdlName = computed(() => wmdlStore.currentWmdl.name || '未加载 wmdl')

// ── wmdl 文件指示按钮：点击打开所在文件夹 ──────────────────────────────────

const wmdlFilePath = computed(() => wmdlStore.currentWmdl.wmdlFilePath ?? null)

async function onOpenWmdlDir() {
  if (!wmdlFilePath.value) {
    msg.info('当前 wmdl 未关联文件')
    return
  }
  try {
    await EnsureDirAndOpenInExplorer(pathDirname(wmdlFilePath.value))
  } catch (err) {
    msg.error(`打开文件夹失败：${err}`)
  }
}

// ── lanim 文件指示按钮：点击打开所在文件夹 ─────────────────────────────────

const lanimName = computed(() =>
  store.lanimFilePath ? pathBasename(store.lanimFilePath) : '未加载',
)

async function onOpenLanimDir() {
  if (!store.lanimFilePath) {
    msg.info('尚未加载动画文件')
    return
  }
  try {
    await EnsureDirAndOpenInExplorer(pathDirname(store.lanimFilePath))
  } catch (err) {
    msg.error(`打开文件夹失败：${err}`)
  }
}

// ── 三栏布局：预览区固定宽度，时间轴吸收全部伸缩量 ─────────────────────────

const STAGE_MIN = 320
const STAGE_MAX = 1200
const stageWidth = ref(620)

function onStageDrag(dx: number) {
  stageWidth.value = Math.max(STAGE_MIN, Math.min(STAGE_MAX, stageWidth.value + dx))
}

// ── store 桥接 ──────────────────────────────────────────────────────────────

/**
 * 组合器写入探针（常驻诊断）：本次写入与组合器成员有交集时，
 * 写后立即与 update 后各读回一次参数值，用于区分「写入未落地」与「逐帧求值覆盖」。
 */
function composerReadback(
  models: Array<any>,
  writes: Array<{ id: string; val: number; calc: ParamCalc }>,
  tag: string,
) {
  return models.map((m, mi) => {
    const core = m?.internalModel?.coreModel
    if (!core) return { model: mi, error: 'no coreModel' }
    const read = (id: string) =>
      typeof core.getParameterValueById === 'function'
        ? core.getParameterValueById(id)
        : typeof core.getParamFloat === 'function'
          ? core.getParamFloat(id)
          : undefined
    const snap: Record<string, number | undefined> = {}
    for (const { id } of writes) snap[id] = read(id)
    return { model: mi, values: snap, tag }
  })
}

store.applier = (params) => {
  const stage = stageRef.value
  if (!stage) return
  const memberIds = store.composerMemberParamIds
  const hitsComposer = params.some((p) => memberIds.has(p.id))
  if (!hitsComposer) {
    stage.applyParameters(params)
    return
  }
  const preview = stage.getPreview()
  const models = preview?.getLoadedModels() ?? []
  const probe = {
    writes: params,
    subModelCount: models.length,
    writeback: null as unknown,
    afterUpdate: null as unknown,
  }
  stage.applyParameters(params)
  probe.writeback = composerReadback(models, params, 'writeback')
  const FIXED_DT = 1000 / 60
  for (const m of models) (m as any).update?.(FIXED_DT)
  probe.afterUpdate = composerReadback(models, params, 'afterUpdate')
  console.log('[composer] write-probe', probe)
}

// 播放中任何实时值修改 → 立即打断播放（停在当前位置）
store.onLiveValueChange = () => {
  if (store.playing) {
    store.playing = false
    cancelAnimationFrame(rafId)
  }
}

// 播放中用户抓取播放头 → 暂停（拖动后由 playhead watch 实时采样）
store.onPlayheadGrab = () => {
  pause()
}

// ── 播放 ────────────────────────────────────────────────────────────────────

let rafId = 0
let playStart = 0

const sampledLanim = computed(() => previewLanim(store.lanim, store.keyframePreview))

function applySampled(frame: number, playback = false) {
  const sample = playback ? sampleLanimForPlayback : sampleLanim
  const sampled = sample(sampledLanim.value, frame, store.composerDefOf)
  if (!sampled.size) return
  const params: Array<{ id: string; val: number; calc: ParamCalc }> = []
  sampled.forEach((val, id) => params.push({ id, val, calc: 'set' }))
  stageRef.value?.applyParameters(params)
}

function tick(now: number) {
  if (!store.playing) return
  const elapsed = (now - playStart) / 1000
  const fps = store.lanim.fps || 60
  const frame = (elapsed * fps) % Math.max(1, store.lanim.durationFrames)
  store.playhead = Math.floor(frame)
  applySampled(frame, true)
  rafId = requestAnimationFrame(tick)
}

function play() {
  if (store.playing || !store.lanim.tracks.length) return
  store.playing = true
  playStart = performance.now() - (store.playhead / (store.lanim.fps || 60)) * 1000
  rafId = requestAnimationFrame(tick)
}

function pause() {
  if (!store.playing) return
  store.playing = false
  cancelAnimationFrame(rafId)
  applySampled(store.playhead)
}

function stop() {
  store.playing = false
  cancelAnimationFrame(rafId)
  store.playhead = 0
  applySampled(0)
}

/** 播放头拖拽（非播放态）时实时采样预览。 */
watch(
  () => store.playhead,
  () => {
    if (!store.playing) applySampled(store.playhead)
  },
)

/** 关键帧变动（拖动/插帧/删帧，含组合器轨道）→ 非播放态下重新采样当前帧刷新预览。 */
watch(
  () => [store.lanim.tracks, store.lanim.composers],
  () => {
    if (!store.playing) applySampled(store.playhead)
  },
  { deep: true },
)

watch(() => store.keyframePreview, () => {
  if (!store.playing) applySampled(store.playhead)
})

function closeMenusOnOutsideClick(event: MouseEvent) {
  for (const menu of [motionMenu.value, toolsMenu.value]) {
    if (menu && !menu.contains(event.target as Node)) menu.open = false
  }
}

onMounted(() => document.addEventListener('click', closeMenusOnOutsideClick))
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenusOnOutsideClick)
  cancelAnimationFrame(rafId)
  store.applier = null
  store.onLiveValueChange = null
  store.onPlayheadGrab = null
})

// ── 保存 / 加载 ─────────────────────────────────────────────────────────────

const saving = ref(false)
const motionMenu = ref<HTMLDetailsElement | null>(null)
const toolsMenu = ref<HTMLDetailsElement | null>(null)
const importing = ref(false)
const motionModel = computed(() => wmdlStore.currentWmdl.models[0] ?? null)
const modelMotions = computed(() => parseMotions(motionModel.value?.rawJsonObject, true))
const motionSearch = ref('')
const toolsSearch = ref('')
const filteredMotions = computed(() => filterBySearch(modelMotions.value, motionSearch.value, (entry) => entry.name))
const tools = [{ name: '反烘焙', run: onUnbake }]
const filteredTools = computed(() => filterBySearch(tools, toolsSearch.value, (tool) => tool.name))

function replaceAnimation(lanim: LanimFile, path: string | null) {
  pause()
  restoreParamDefaults(store.lanim.tracks.map((tr) => tr.paramId))
  const memberIds: string[] = []
  for (const track of store.lanim.composers ?? []) {
    const def = store.composerDefs[track.id]
    if (def) for (const id of def.resolvedMembers) if (id != null) memberIds.push(id)
  }
  restoreParamDefaults(memberIds)
  store.keyframePreview = null
  store.selectedTrackId = null
  store.lanim = lanim
  store.lanimFilePath = path
  store.playhead = 0
  store.resetComposerLog()
}

function onMotionMenuToggle(event: Event) {
  const menu = event.target as HTMLDetailsElement
  if (!menu.open) return
  if (!motionModel.value) {
    menu.open = false
    msg.warning('当前没有可加载的模型')
  } else if (motionModel.value.isMoc3) {
    menu.open = false
    msg.warning('当前不支持加载 moc3 模型的动作')
  }
}

async function onImportMotion(entry: MotionEntry) {
  if (motionMenu.value) motionMenu.value.open = false
  const model = motionModel.value
  if (!model || importing.value) return
  if (!entry.path || !model.jsonAbsPath) {
    msg.error(`动作「${entry.name}」没有可用的文件路径`)
    return
  }
  const path = pathCombine(pathDirname(model.jsonAbsPath), entry.path)
  if (!path.toLowerCase().endsWith('.mtn')) {
    msg.error(`动作「${entry.name}」不是 MTN 文件，无法加载`)
    return
  }
  importing.value = true
  try {
    const text = await ReadTextFile(path)
    const lanim = parseMtn(text, entry.name)
    if (motionModel.value?.id !== model.id || motionModel.value?.jsonAbsPath !== model.jsonAbsPath) {
      msg.warning('模型已更换，取消加载动作')
      return
    }
    replaceAnimation(lanim, null)
    msg.success(`已加载动作「${entry.name}」`)
  } catch (err) {
    msg.error(`无法加载动作「${entry.name}」：${err}`)
  } finally {
    importing.value = false
  }
}

function onUnbake() {
  if (toolsMenu.value) toolsMenu.value.open = false
  if (!store.lanim.tracks.length) {
    msg.info('当前没有可反烘焙的参数轨道')
    return
  }
  pause()
  store.keyframePreview = null
  let removed = 0
  store.lanim.tracks = store.lanim.tracks.map((track) => {
    const keys = unbakeKeys(track.keys)
    removed += track.keys.length - keys.length
    return { ...track, keys }
  })
  msg.success(`反烘焙完成，删除 ${removed} 帧`)
}

function serialize(): string {
  return JSON.stringify(normalizeLanim(store.lanim), null, 2)
}

function withLanimExt(path: string): string {
  return path.toLowerCase().endsWith('.lanim.json') ? path : `${path}.lanim.json`
}

async function onSave() {
  if (saving.value) return
  saving.value = true
  try {
    let path = store.lanimFilePath
    if (!path) {
      const picked = await choosePath(() => SaveLanimFileDialog(''))
      if (!picked) return
      path = withLanimExt(picked)
    }
    await SaveModelJsonFile(path, serialize())
    store.lanimFilePath = path
    msg.success('保存成功')
  } catch (err) {
    msg.error(`保存失败：${err}`)
  } finally {
    saving.value = false
  }
}

async function onSaveAs() {
  try {
    const picked = await choosePath(() => SaveLanimFileDialog(store.lanimFilePath ?? ''))
    if (!picked) return
    const path = withLanimExt(picked)
    await SaveModelJsonFile(path, serialize())
    store.lanimFilePath = path
    msg.success('保存成功')
  } catch (err) {
    msg.error(`保存失败：${err}`)
  }
}

async function onLoad() {
  try {
    const picked = await choosePath(() => PickLanimJsonFile())
    if (!picked) return
    const text = await ReadTextFile(picked)
    const lanim = parseLanimJson(text)
    if (!lanim) {
      msg.error('文件不是有效的 lanim 动画文件')
      return
    }
    replaceAnimation(lanim, picked)

    // 补载 lanim 引用的组合器 def（会话内尚未加载的）；缺失的逐条弹提示
    const ids = (lanim.composers ?? []).map((c) => c.id)
    const missing = ids.filter((id) => !store.composerDefs[id])
    if (missing.length) {
      const { defs, failed } = await loadComposerDefsByIds(missing)
      for (const [id, def] of Object.entries(defs)) {
        store.composerDefs[id] = def
        resolveComposerMembers(def, listParameters(wmdlStore.selectedModelId).map((p) => p.id))
      }
      for (const f of failed) {
        msg.warning(`组合器「${f.id}」加载失败：${f.reason}`)
      }
    }
    msg.success('加载成功')
  } catch (err) {
    msg.error(`加载失败：${err}`)
  }
}
</script>

<template>
  <div class="motion-editor">
    <div class="motion-editor__header">
      <span class="motion-editor__title">动作编辑器</span>
      <button
        type="button"
        class="motion-editor__wmdl"
        :title="wmdlFilePath ?? '当前 wmdl 未关联文件'"
        @click="onOpenWmdlDir"
      >
        {{ wmdlName }}
      </button>
      <span class="motion-editor__spacer" />
      <button
        type="button"
        class="motion-editor__time motion-editor__lanim"
        :title="store.lanimFilePath ?? '未加载动画文件'"
        @click="onOpenLanimDir"
      >
        {{ lanimName }}
      </button>
      <button
        type="button"
        class="he-btn"
        :disabled="!store.playing && !store.lanim.tracks.length"
        @click="store.playing ? pause() : play()"
      >
        {{ store.playing ? '⏸ 暂停' : '▶ 播放' }}
      </button>
      <button type="button" class="he-btn" @click="stop">⏹ 停止</button>
      <button
        type="button"
        class="motion-editor__time"
        title="帧率与时长设置"
        @click="frameModal.open()"
      >
        {{ store.playhead }} / {{ store.lanim.durationFrames }}帧 ({{ (store.lanim.durationFrames / (store.lanim.fps || 60)).toFixed(2) }}s)
      </button>
      <button type="button" class="he-btn" @click="exportModal.open()">导出</button>
      <button
        type="button"
        class="he-btn"
        title="将当前动画渲染为 GIF 并导出"
        @click="gifModal.open(store.lanim.durationFrames - 1)"
      >
        渲染
      </button>
      <button type="button" class="he-btn" @click="onSave" :disabled="saving">保存</button>
      <button type="button" class="he-btn" @click="onSaveAs">另存为</button>
      <button type="button" class="he-btn" @click="onLoad">加载</button>
      <details ref="motionMenu" class="motion-menu" @toggle="onMotionMenuToggle">
        <summary class="he-btn">立绘动作 ▾</summary>
        <div class="motion-menu__panel">
          <SearchInput v-model="motionSearch" variant="edit" placeholder="搜索动作..." />
          <div class="motion-menu__items">
            <button v-for="entry in filteredMotions" :key="entry.name" type="button" :title="entry.path || '文件路径缺失'" @click="onImportMotion(entry)">{{ entry.name }}</button>
            <span v-if="!modelMotions.length">当前模型没有动作</span>
            <span v-else-if="!filteredMotions.length">没有匹配的动作</span>
          </div>
        </div>
      </details>
      <details ref="toolsMenu" class="motion-menu">
        <summary class="he-btn">工具 ▾</summary>
        <div class="motion-menu__panel">
          <SearchInput v-model="toolsSearch" variant="edit" placeholder="搜索工具..." />
          <div class="motion-menu__items">
            <button v-for="tool in filteredTools" :key="tool.name" type="button" @click="tool.run">{{ tool.name }}</button>
            <span v-if="!filteredTools.length">没有匹配的工具</span>
          </div>
        </div>
      </details>
    </div>
    <div class="motion-editor__body">
      <div class="motion-editor__stage" :style="{ width: stageWidth + 'px' }">
        <MotionStage ref="stageRef" />
      </div>
      <ResizeHandle side="right" @drag="onStageDrag" />
      <div class="motion-editor__panel">
        <MotionTrackPanel />
      </div>
    </div>
    <FrameSettingsModal />
    <MotionExportModal />
    <MotionGifRenderModal />
    <MessageHost />
  </div>
</template>

<style scoped>
.motion-editor {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #1a1a20;
  color: #e6e6e6;
}

.motion-editor__header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  height: 38px;
  padding: 0 12px;
  background: #242830;
  border-bottom: 1px solid #3a4150;
}

.motion-editor__title {
  font-weight: 600;
  font-size: 13px;
}

.motion-editor__wmdl {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 10px;
  background: #2c313a;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #8a93a3;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.motion-editor__wmdl:hover {
  border-color: #2f80ed;
  color: #5fa8ff;
}

.motion-editor__spacer {
  flex: 1;
}

.motion-editor__time {
  padding: 4px 10px;
  background: #2c313a;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #8a93a3;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.motion-editor__time:hover {
  border-color: #2f80ed;
  color: #5fa8ff;
}

.motion-editor__lanim {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.he-btn {
  padding: 4px 10px;
  background: #2c313a;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.he-btn:hover:not(:disabled) {
  background: #343b49;
  border-color: #2f80ed;
}

.he-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.motion-menu { position: relative; flex-shrink: 0; }
.motion-menu summary { list-style: none; }
.motion-menu summary::-webkit-details-marker { display: none; }
.motion-menu__panel {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 20;
  width: 220px;
  padding: 4px; background: #2c313a; border: 1px solid #3a4150; border-radius: 4px;
}
.motion-menu__items { max-height: 55vh; overflow-y: auto; }
.motion-menu__items button, .motion-menu__items span {
  display: block; width: 100%; padding: 6px 8px; text-align: left;
  white-space: nowrap; color: #e6e6e6; font-size: 12px;
}
.motion-menu__items button { border: 0; background: transparent; cursor: pointer; }
.motion-menu__items button:hover { background: #343b49; }

.motion-editor__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.motion-editor__stage {
  flex-shrink: 0;
  position: relative;
  min-width: 0;
}

.motion-editor__panel {
  flex: 1;
  min-width: 0;
}
</style>
