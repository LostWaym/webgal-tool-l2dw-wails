<script setup lang="ts">
/**
 * 动作编辑器主入口（--motion 模式）。
 *
 * 布局：左 Live2D 预览 / 右 轨道面板（参数卡片 + 时间轴合并）。
 * 帧制：底层以整数帧号运算；播放循环 rAF 累积时间 → frame = floor(elapsed × fps) 循环步进。
 * 帧率/时长通过 FrameSettingsModal 编辑（缩短时长截断关键帧需二次确认）。
 * 保存/加载：.lanim.json，SaveModelJsonFileDialog 选路径 + WriteTextFile / ReadTextFile。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import MotionStage from './MotionStage.vue'
import MotionTrackPanel from './MotionTrackPanel.vue'
import FrameSettingsModal from './FrameSettingsModal.vue'
import MotionExportModal from './MotionExportModal.vue'
import MotionGifRenderModal from './MotionGifRenderModal.vue'
import MessageHost from '../common/MessageHost.vue'
import ResizeHandle from '../ModelEditApp/ResizeHandle.vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import {
  useMotionEditorStore,
  sampleLanim,
  parseLanimJson,
  normalizeLanim,
  restoreParamDefaults,
} from '../../stores/motionEditor'
import { resolveComposerMembers, loadComposerDefsByIds } from '../../utils/motionComposors'
import { listParameters } from '../../live2d/coreAdapter'
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
import { pathBasename, pathDirname } from '../../path_utils'
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
  if (store.playing) {
    store.playing = false
    cancelAnimationFrame(rafId)
  }
}

// ── 播放（帧步进） ──────────────────────────────────────────────────────────

let rafId = 0
let playStart = 0

function applySampled(frame: number) {
  const sampled = sampleLanim(store.lanim, frame, store.composerDefOf)
  if (!sampled.size) return
  const params: Array<{ id: string; val: number; calc: ParamCalc }> = []
  sampled.forEach((val, id) => params.push({ id, val, calc: 'set' }))
  stageRef.value?.applyParameters(params)
}

function tick(now: number) {
  if (!store.playing) return
  const elapsed = (now - playStart) / 1000
  const fps = store.lanim.fps || 60
  const frame = Math.floor(elapsed * fps) % Math.max(1, store.lanim.durationFrames)
  store.playhead = frame
  applySampled(frame)
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

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  store.applier = null
  store.onLiveValueChange = null
  store.onPlayheadGrab = null
})

// ── 保存 / 加载 ─────────────────────────────────────────────────────────────

const saving = ref(false)

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
      const picked = await SaveLanimFileDialog('')
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
    const picked = await SaveLanimFileDialog(store.lanimFilePath ?? '')
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
    const picked = await PickLanimJsonFile()
    if (!picked) return
    const text = await ReadTextFile(picked)
    const lanim = parseLanimJson(text)
    if (!lanim) {
      msg.error('文件不是有效的 lanim 动画文件')
      return
    }
    // 换文件前把旧轨道（含组合器成员参数）的动画残留值恢复为参数默认值
    restoreParamDefaults(store.lanim.tracks.map((tr) => tr.paramId))
    const oldComposerMemberIds: string[] = []
    for (const track of store.lanim.composers ?? []) {
      const def = store.composerDefs[track.id]
      if (!def) continue
      for (const pid of def.resolvedMembers) {
        if (pid != null) oldComposerMemberIds.push(pid)
      }
    }
    restoreParamDefaults(oldComposerMemberIds)

    store.lanim = lanim
    store.lanimFilePath = picked
    store.playhead = 0
    store.resetComposerLog()

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
