import { defineStore } from 'pinia'
import { listParameters, writeParameter } from '../live2d/coreAdapter'
import { useWmdlModelEditorStore } from './wmdlModelEditor'

/** 关键帧插值方式（全局，不存进 lanim 文件），可改为 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'。 */
export type InterpKind = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
export const DEFAULT_INTERP: InterpKind = 'easeInOut'

function applyEasing(ratio: number, kind: InterpKind): number {
  switch (kind) {
    case 'easeIn':
      return ratio * ratio
    case 'easeOut':
      return 1 - (1 - ratio) * (1 - ratio)
    case 'easeInOut':
      return ratio < 0.5 ? 2 * ratio * ratio : 1 - 2 * (1 - ratio) * (1 - ratio)
    default:
      return ratio
  }
}

/** 关键帧：frame 为整数帧号，v 为参数值。 */
export interface MotionKeyframe {
  frame: number
  v: number
}

/** 单个参数的关键帧轨道，keys 按 frame 升序维护。 */
export interface MotionTrack {
  paramId: string
  keys: MotionKeyframe[]
}

/** .lanim.json 动画文件的顶层结构（帧制）。 */
export interface LanimFile {
  version: 1
  name: string
  fps: number
  durationFrames: number
  tracks: MotionTrack[]
}

export const DEFAULT_FPS = 60
export const DEFAULT_DURATION_FRAMES = 180

export function createDefaultLanim(): LanimFile {
  return { version: 1, name: 'untitled', fps: DEFAULT_FPS, durationFrames: DEFAULT_DURATION_FRAMES, tracks: [] }
}

/** 规范化 lanim：帧号取整、关键帧按 frame 升序且剔除同帧重复（保留后者）。 */
export function normalizeLanim(lanim: LanimFile): LanimFile {
  const tracks: MotionTrack[] = []
  for (const track of lanim.tracks) {
    const keys = [...track.keys]
      .map((k) => ({ frame: Math.round(k.frame), v: k.v }))
      .sort((a, b) => a.frame - b.frame)
    const deduped: MotionKeyframe[] = []
    for (const k of keys) {
      if (deduped.length && deduped[deduped.length - 1].frame === k.frame) {
        deduped[deduped.length - 1] = k
      } else {
        deduped.push(k)
      }
    }
    tracks.push({ paramId: track.paramId, keys: deduped })
  }
  return { ...lanim, tracks }
}

/** 帧间线性插值采样：keys 必须按 frame 升序。空轨道返回 0，帧前/帧后取端点值。 */
export function sampleTrack(keys: MotionKeyframe[], frame: number): number {
  if (!keys.length) return 0
  if (frame <= keys[0].frame) return keys[0].v
  const last = keys[keys.length - 1]
  if (frame >= last.frame) return last.v
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]
    if (frame <= b.frame) {
      const a = keys[i - 1]
      const span = b.frame - a.frame
      if (span <= 0) return b.v
      const ratio = applyEasing((frame - a.frame) / span, DEFAULT_INTERP)
      return a.v + (b.v - a.v) * ratio
    }
  }
  return last.v
}

/** 采样整条动画：返回 paramId -> 值 的映射（无关键帧的轨道不产出）。 */
export function sampleLanim(lanim: LanimFile, frame: number): Map<string, number> {
  const out = new Map<string, number>()
  const f = Math.max(0, Math.min(lanim.durationFrames, frame))
  for (const track of lanim.tracks) {
    if (!track.keys.length) continue
    out.set(track.paramId, sampleTrack(track.keys, f))
  }
  return out
}

/** 把任意 json 解析为 LanimFile；结构不合法返回 null。 */
export function parseLanimJson(text: string): LanimFile | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1 || typeof obj.fps !== 'number' || typeof obj.durationFrames !== 'number') return null
  if (!Array.isArray(obj.tracks)) return null
  const tracks: MotionTrack[] = []
  for (const tr of obj.tracks) {
    if (typeof tr !== 'object' || tr === null) return null
    const t = tr as Record<string, unknown>
    if (typeof t.paramId !== 'string' || !Array.isArray(t.keys)) return null
    const keys: MotionKeyframe[] = []
    for (const k of t.keys) {
      if (typeof k !== 'object' || k === null) return null
      const kf = k as Record<string, unknown>
      if (typeof kf.frame !== 'number' || typeof kf.v !== 'number') return null
      keys.push({ frame: Math.round(kf.frame), v: kf.v })
    }
    tracks.push({ paramId: t.paramId, keys })
  }
  return normalizeLanim({
    version: 1,
    name: typeof obj.name === 'string' ? obj.name : 'untitled',
    fps: Math.max(1, obj.fps),
    durationFrames: Math.max(1, Math.round(obj.durationFrames)),
    tracks,
  })
}

/**
 * 把参数恢复为模型默认值（listParameters 的 value 双核均为 defaultValue），
 * 用于轨道被删空/移除后清掉动画残留值。同步 liveValues 让行头立即反映。
 */
export function restoreParamDefaults(paramIds: string[]) {
  if (!paramIds.length) return
  const wmdlStore = useWmdlModelEditorStore()
  const modelId = wmdlStore.selectedModelId
  if (!modelId) return
  const entries = listParameters(modelId)
  for (const id of paramIds) {
    const e = entries.find((p) => p.id === id)
    if (!e) continue
    writeParameter(modelId, id, e.value)
    const store = useMotionEditorStore()
    store.liveValues[id] = e.value
  }
}

interface MotionEditorState {  lanim: LanimFile
  /** 当前编辑的 wmdl 关联的动画文件路径；保存过则为绝对路径。 */
  lanimFilePath: string | null
  selectedTrackId: string | null
  /** 播放头，整数帧号。 */
  playhead: number
  playing: boolean
  /** 参数的实时运行值（paramId -> value），由参数卡片拖动/输入时维护。 */
  liveValues: Record<string, number>
  /** 各参数的范围（paramId -> [min, max]），由参数列表刷新时维护。 */
  paramRanges: Record<string, [number, number]>
  /**
   * 写参数回调，由 MotionEditApp 注册（转发到 Live2dPreview.applyParameters）。
   */
  applier: ((params: Array<{ id: string; val: number; calc: 'set' }>) => void) | null
  /** 实时值变化回调，由 MotionEditApp 注册；播放中修改值时用于打断播放。 */
  onLiveValueChange: (() => void) | null
  /** 用户抓取播放头（开始拖拽）回调，由 MotionEditApp 注册；播放中用于暂停。 */
  onPlayheadGrab: (() => void) | null
}

export const useMotionEditorStore = defineStore('motionEditor', {
  state: (): MotionEditorState => ({
    lanim: createDefaultLanim(),
    lanimFilePath: null,
    selectedTrackId: null,
    playhead: 0,
    playing: false,
    liveValues: {},
    paramRanges: {},
    applier: null,
    onLiveValueChange: null,
    onPlayheadGrab: null,
  }),

  getters: {
    trackParamIds(state): Set<string> {
      return new Set(state.lanim.tracks.map((tr) => tr.paramId))
    },
    selectedTrack(state): MotionTrack | null {
      if (!state.selectedTrackId) return null
      return state.lanim.tracks.find((tr) => tr.paramId === state.selectedTrackId) ?? null
    },
  },

  actions: {
    addTrack(paramId: string) {
      if (this.lanim.tracks.some((tr) => tr.paramId === paramId)) return
      this.lanim.tracks.push({ paramId, keys: [] })
    },
    removeTrack(paramId: string) {
      const existed = this.lanim.tracks.some((tr) => tr.paramId === paramId)
      this.lanim.tracks = this.lanim.tracks.filter((tr) => tr.paramId !== paramId)
      if (this.selectedTrackId === paramId) this.selectedTrackId = null
      if (existed) restoreParamDefaults([paramId])
    },
    /** 按 paramOrder（参数列表显示顺序）同步轨道顺序，保证行头与车道一一平齐。 */
    sortTracksByParamOrder(paramOrder: string[]) {
      const idxOf = new Map(paramOrder.map((id, i) => [id, i]))
      this.lanim.tracks.sort(
        (a, b) => (idxOf.get(a.paramId) ?? Infinity) - (idxOf.get(b.paramId) ?? Infinity),
      )
    },
    /** 记录参数实时值；播放中调用会触发 onLiveValueChange 打断播放。 */
    setLiveValue(paramId: string, value: number) {
      this.liveValues[paramId] = value
      this.onLiveValueChange?.()
    },
    /** 拖动/输入参数值：实时写入模型；无轨道则自动建轨，并在当前帧打帧。 */
    applyLiveValue(paramId: string, value: number) {
      this.setLiveValue(paramId, value)
      this.applier?.([{ id: paramId, val: value, calc: 'set' }])
      if (!this.lanim.tracks.some((tr) => tr.paramId === paramId)) {
        this.addTrack(paramId)
      }
      this.upsertKeyframe(paramId, this.playhead, value)
    },
    /** 在轨道 frame 处插入或覆盖关键帧（frame 取整、clamp 到 [0, durationFrames]）。 */
    upsertKeyframe(paramId: string, frame: number, v: number) {
      const track = this.lanim.tracks.find((tr) => tr.paramId === paramId)
      if (!track) return
      const f = Math.max(0, Math.min(this.lanim.durationFrames, Math.round(frame)))
      const exist = track.keys.find((k) => k.frame === f)
      if (exist) {
        exist.v = v
      } else {
        track.keys.push({ frame: f, v })
        track.keys.sort((a, b) => a.frame - b.frame)
      }
    },
    /** 删除轨道上最接近 frame 的关键帧；返回是否删除成功。 */
    removeKeyframeNear(paramId: string, frame: number): boolean {
      const track = this.lanim.tracks.find((tr) => tr.paramId === paramId)
      if (!track || !track.keys.length) return false
      const f = Math.round(frame)
      let bestIdx = -1
      let bestDist = Infinity
      track.keys.forEach((k, i) => {
        const d = Math.abs(k.frame - f)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      })
      if (bestIdx < 0) return false
      track.keys.splice(bestIdx, 1)
      // 删到没有帧数据：轨道无意义，恢复参数默认值清掉动画残留
      if (!track.keys.length) restoreParamDefaults([paramId])
      return true
    },
    /** 拖动关键帧：把轨道上 fromFrame 的帧移动到 toFrame（帧吸附，目标帧被占则不动）。 */
    moveKeyframe(paramId: string, fromFrame: number, toFrame: number) {
      const track = this.lanim.tracks.find((tr) => tr.paramId === paramId)
      if (!track) return
      const from = Math.round(fromFrame)
      const to = Math.max(0, Math.min(this.lanim.durationFrames, Math.round(toFrame)))
      const key = track.keys.find((k) => k.frame === from)
      if (!key) return
      const other = track.keys.find((k) => k !== key && k.frame === to)
      if (other) return
      key.frame = to
      track.keys.sort((a, b) => a.frame - b.frame)
    },
    /**
     * 应用新的帧率/时长。帧号原样保留，超出新 durationFrames 的关键帧被截断。
     * 返回被截断的关键帧数量（供模态做风险提示）。
     */
    applyFrameSettings(fps: number, durationFrames: number): number {
      const newFps = Math.max(1, Math.round(fps))
      const newDur = Math.max(1, Math.round(durationFrames))
      let removed = 0
      const emptied: string[] = []
      for (const track of this.lanim.tracks) {
        const before = track.keys.length
        track.keys = track.keys.filter((k) => k.frame <= newDur)
        removed += before - track.keys.length
        if (before > 0 && !track.keys.length) emptied.push(track.paramId)
      }
      if (emptied.length) restoreParamDefaults(emptied)
      this.lanim.fps = newFps
      this.lanim.durationFrames = newDur
      this.playhead = Math.min(this.playhead, newDur)
      return removed
    },
    reset() {
      restoreParamDefaults(this.lanim.tracks.map((tr) => tr.paramId))
      this.lanim = createDefaultLanim()
      this.lanimFilePath = null
      this.selectedTrackId = null
      this.playhead = 0
      this.playing = false
    },
  },
})
