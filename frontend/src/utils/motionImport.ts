import type { LanimFile, MotionKeyframe } from '../stores/motionEditor'

interface SourceTrack {
  paramId: string
  lastFrame: number
  valueAt: (seconds: number) => number
}

export interface MotionSource {
  name: string
  fps: number
  duration: number
  lastFrame: number
  tracks: SourceTrack[]
  skippedTargets: string[]
}

export function motionParser(path: string): (text: string, name: string) => MotionSource {
  const lowerPath = path.toLowerCase()
  const parse = lowerPath.endsWith('.mtn') ? parseMtn : lowerPath.endsWith('.motion3.json') ? parseMotion3 : null
  if (!parse) throw new Error('仅支持 .mtn 或 .motion3.json 动作文件')
  return (text, name) => parse(text.replace(/^\uFEFF/, ''), name)
}

export function motionFrameTime(motion: MotionSource, frame: number): number {
  return frame >= motion.lastFrame ? motion.duration : Math.max(0, frame) / motion.fps
}

export function sampleMotionFrame(motion: MotionSource, frame: number): Array<{ id: string; val: number }> {
  const time = motionFrameTime(motion, frame)
  return motion.tracks.map((track) => ({ id: track.paramId, val: track.valueAt(time) }))
}

export function bakeMotion(motion: MotionSource): LanimFile {
  const keyCount = motion.tracks.reduce((total, track) => total + track.lastFrame + 1, 0)
  if (keyCount > 500_000) throw new Error('逐帧导入将生成超过 50 万个关键帧，无法装入时间轴')
  return {
    version: 1,
    name: motion.name,
    fps: motion.fps,
    durationFrames: Math.max(1, motion.lastFrame),
    tracks: motion.tracks.map((track) => ({
      paramId: track.paramId,
      keys: Array.from({ length: track.lastFrame + 1 }, (_, frame) => ({
        frame,
        v: track.valueAt(motionFrameTime(motion, frame)),
      })),
    })),
  }
}

function parseMtn(text: string, name: string): MotionSource {
  let fps = 0
  let lastFrame = 0
  const tracks: SourceTrack[] = []
  const ids = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) throw new Error('动作文件包含无效行')
    const id = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (id === '$fps') {
      fps = Number(value)
      continue
    }
    if (id.startsWith('$')) continue
    if (!id || ids.has(id)) throw new Error(`参数重复或无效：${id}`)
    const values = value.split(',').map((part) => part.trim())
    if (values.some((part) => !part || !Number.isFinite(Number(part)))) {
      throw new Error(`参数 ${id} 包含无效数值`)
    }
    const samples = values.map(Number)
    const end = samples.length - 1
    ids.add(id)
    lastFrame = Math.max(lastFrame, end)
    tracks.push({
      paramId: id,
      lastFrame: end,
      valueAt: (time) => samples[Math.min(end, Math.round(time * fps))],
    })
  }
  if (!Number.isFinite(fps) || fps <= 0 || !tracks.length) throw new Error('动作缺少有效帧率或参数')
  return { name, fps, duration: lastFrame / fps, lastFrame, tracks, skippedTargets: [] }
}

type Point = { t: number; v: number }
type Segment =
  | { kind: 0 | 2 | 3; from: Point; to: Point }
  | { kind: 1; from: Point; to: Point; controlA: Point; controlB: Point }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseMotion3(text: string, name: string): MotionSource {
  const data: unknown = JSON.parse(text)
  if (!isRecord(data) || data.Version !== 3 || !isRecord(data.Meta) || !Array.isArray(data.Curves)) {
    throw new Error('motion3.json 缺少有效的版本、Meta 或曲线列表')
  }
  const { Fps: fps, Duration: duration, AreBeziersRestricted: restricted } = data.Meta
  if (!isFiniteNumber(fps) || fps <= 0 || !isFiniteNumber(duration) || duration < 0) {
    throw new Error('motion3.json 缺少有效的帧率或时长')
  }
  // 不对齐帧网格时额外保留末帧，末帧采样时间钳制到 Meta.Duration。
  const lastFrame = Math.max(duration > 0 ? 1 : 0, Math.ceil(duration * fps - 1e-9))
  if (!Number.isSafeInteger(lastFrame)) throw new Error('motion3.json 的帧数超出范围')

  const skipped = new Set<string>()
  const ids = new Set<string>()
  const tracks: SourceTrack[] = []
  for (const curve of data.Curves) {
    if (!isRecord(curve) || typeof curve.Target !== 'string' || !curve.Target) {
      throw new Error('motion3.json 包含无效的曲线目标')
    }
    if (curve.Target !== 'Parameter') {
      skipped.add(curve.Target)
      continue
    }
    const { Id: id, Segments: values } = curve
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new Error(`参数 ID 重复或无效：${id}`)
    if (!Array.isArray(values)) throw new Error(`参数 ${id} 缺少 Segments`)
    tracks.push({ paramId: id, lastFrame, valueAt: parseCurve(values, id, restricted === true) })
    ids.add(id)
  }
  if (!tracks.length) throw new Error('motion3.json 不含可采样的 Parameter 曲线')
  return { name, fps, duration, lastFrame, tracks, skippedTargets: [...skipped] }
}

function parseCurve(values: unknown[], id: string, restricted: boolean): SourceTrack['valueAt'] {
  function point(index: number): Point {
    const [t, v] = [values[index], values[index + 1]]
    if (!isFiniteNumber(t) || !isFiniteNumber(v)) throw new Error(`参数 ${id} 包含无效或不完整的曲线点`)
    return { t, v }
  }
  const segments: Segment[] = []
  let from = point(0)
  for (let i = 2; i < values.length;) {
    const kind = values[i++]
    if (kind !== 0 && kind !== 1 && kind !== 2 && kind !== 3) {
      throw new Error(`参数 ${id} 包含未知曲线段类型：${kind}`)
    }
    const to = point(i + (kind === 1 ? 4 : 0))
    if (to.t <= from.t) throw new Error(`参数 ${id} 的曲线段时间必须递增`)
    segments.push(kind === 1
      ? { kind, from, to, controlA: point(i), controlB: point(i + 2) }
      : { kind, from, to })
    from = to
    i += kind === 1 ? 6 : 2
  }
  const last = from
  return (time) => {
    if (time >= last.t || !segments.length) return last.v
    // SDK 使用右端点严格大于 time 的段；阶跃在分段边界也遵循这条规则。
    let lo = 0
    let hi = segments.length - 1
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (segments[mid].to.t > time) hi = mid
      else lo = mid + 1
    }
    const segment = segments[lo]
    const { from, to } = segment
    const sampleTime = Math.max(time, from.t)
    if (segment.kind === 1) {
      const { controlA, controlB } = segment
      const u = restricted
        ? (sampleTime - from.t) / (to.t - from.t)
        : solveBezierTime(from, controlA, controlB, to, sampleTime)
      return cubicBezier(from.v, controlA.v, controlB.v, to.v, u)
    }
    if (segment.kind === 2) return from.v
    if (segment.kind === 3) return to.v
    return from.v + (to.v - from.v) * ((sampleTime - from.t) / (to.t - from.t))
  }
}

function cubicBezier(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

function solveBezierTime(from: Point, a: Point, b: Point, to: Point, time: number): number {
  if (time === from.t) return 0
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (cubicBezier(from.t, a.t, b.t, to.t, mid) < time) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function unbakeKeys(keys: MotionKeyframe[]): MotionKeyframe[] {
  if (keys.length <= 1) return [...keys]
  if (keys.every((key) => key.v === keys[0].v)) return [keys[0]]
  const result = [keys[0]]
  for (let i = 1; i < keys.length - 1; i++) {
    const before = Math.sign(keys[i].v - keys[i - 1].v)
    const after = Math.sign(keys[i + 1].v - keys[i].v)
    if (before !== after) result.push(keys[i])
  }
  result.push(keys[keys.length - 1])
  return result
}
