import { sampleTrack, sampleComposerIndex, type LanimFile } from '../stores/motionEditor'
import type { ComposerDef } from './motionComposors'
import { isMemberValid } from './motionComposors'

export interface MotionExportOptions {
  fadeInMs: number
  fadeOutMs: number
  /** 仅 motion3.json 生效：压缩为单行 JSON */
  minify?: boolean
}

/** 数字输出：整数不带小数点，其余去尾零。 */
function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n)
  const s = n.toFixed(4)
  return s.replace(/\.?0+$/, '')
}

/**
 * 按帧采样整条轨道。尾部裁剪：只采样到末关键帧帧号，
 * 之后的值运行时由 sampleTrack 钳制在末关键帧值，烘焙无意义。
 */
function sampleFrames(lanim: LanimFile, keys: Parameters<typeof sampleTrack>[0]): number[] {
  const lastFrame = keys.length ? keys[keys.length - 1].frame : 0
  const values: number[] = []
  for (let i = 0; i <= lastFrame; i++) {
    values.push(sampleTrack(keys, i))
  }
  return values
}

/**
 * 组合器轨道展开为成员参数的值序列（逐帧采样到末关键帧）。
 * switch 无插值意义：帧间取所在 key 的激活项，首帧前/末帧后延伸端点。
 * 激活帧写 def.range.active，其余帧写 def.range.inactive。
 * def 缺失或激活成员无效的帧写 inactive（保持互斥语义）。
 */
function expandComposerFrames(
  lanim: LanimFile,
  track: { keys: Array<{ frame: number; v: number }> },
  def: ComposerDef,
  memberIndex: number,
): number[] {
  const lastFrame = track.keys.length ? track.keys[track.keys.length - 1].frame : 0
  const values: number[] = []
  for (let i = 0; i <= lastFrame; i++) {
    const idx = sampleComposerIndex(track.keys, i)
    const active = idx === memberIndex && isMemberValid(def, memberIndex)
    values.push(active ? def.range.active : def.range.inactive)
  }
  return values
}

/** 把组合器轨道展开成成员参数的虚拟轨道，追加进输出轨道列表。 */
export function collectExportTracks(
  lanim: LanimFile,
  defOf: (id: string) => ComposerDef | null,
): Array<{ paramId: string; keys: Parameters<typeof sampleTrack>[0] }> {
  const out: Array<{ paramId: string; keys: Parameters<typeof sampleTrack>[0] }> = []
  for (const track of lanim.tracks) {
    out.push({ paramId: track.paramId, keys: track.keys })
  }
  for (const c of lanim.composers ?? []) {
    const def = defOf(c.id)
    if (!def || !c.keys.length) continue
    def.resolvedMembers.forEach((pid, memberIndex) => {
      if (pid == null) return
      const values = expandComposerFrames(lanim, c, def, memberIndex)
      // 全 inactive 序列无意义，跳过（导出该参数恒为 inactive 无信息量）
      if (values.every((v) => v === def.range.inactive)) return
      const keys = values.map((v, frame) => ({ frame, v }))
      out.push({ paramId: pid, keys })
    })
  }
  return out
}

/** 导出 Cubism 2 .mtn 文本（逐帧采样格式）。 */
export function buildMtn(
  lanim: LanimFile,
  opts: MotionExportOptions,
  defOf: (id: string) => ComposerDef | null = () => null,
): string {
  const lines: string[] = ['# Live2D Animator Motion Data', `$fps=${lanim.fps}`]
  lines.push('', `$fadein=${Math.max(0, Math.round(opts.fadeInMs))}`)
  lines.push('', `$fadeout=${Math.max(0, Math.round(opts.fadeOutMs))}`)
  for (const track of collectExportTracks(lanim, defOf)) {
    if (!track.keys.length) continue
    const values = sampleFrames(lanim, track.keys)
    const allSame = values.every((v) => v === values[0])
    lines.push('', allSame ? `${track.paramId}=${fmtNum(values[0])}` : `${track.paramId}=${values.map(fmtNum).join(',')}`)
  }
  return lines.join('\n') + '\n'
}

interface Motion3Curve {
  Target: string
  Id: string
  FadeInTime: number
  FadeOutTime: number
  Segments: number[]
}

/** 导出 Cubism 3+ motion3.json 文本（逐帧采样线性段）。 */
export function buildMotion3Json(
  lanim: LanimFile,
  opts: MotionExportOptions,
  defOf: (id: string) => ComposerDef | null = () => null,
): string {
  const curves: Motion3Curve[] = []
  let totalSegmentCount = 0
  let totalPointCount = 0

  for (const track of collectExportTracks(lanim, defOf)) {
    if (!track.keys.length) continue
    const values = sampleFrames(lanim, track.keys)
    const segments: number[] = [0, values[0]]
    let pointCount = 1
    let segmentCount = 0
    if (!values.every((v) => v === values[0])) {
      for (let i = 1; i < values.length; i++) {
        segments.push(0, i / lanim.fps, values[i])
        pointCount++
        segmentCount++
      }
    } else {
      // 常量曲线补 1 段延伸到 Duration：runtime parse 对 0 段曲线会越界写 segments[totalSegmentCount]
      segments.push(0, lanim.durationFrames / lanim.fps, values[0])
      pointCount++
      segmentCount++
    }
    curves.push({
      Target: 'Parameter',
      Id: track.paramId,
      FadeInTime: -1.0,
      FadeOutTime: -1.0,
      Segments: segments,
    })
    totalSegmentCount += segmentCount
    totalPointCount += pointCount
  }

  const doc = {
    Version: 3,
    Meta: {
      Duration: lanim.durationFrames / lanim.fps,
      Fps: lanim.fps,
      Loop: true,
      AreBeziersRestricted: true,
      FadeInTime: Math.max(0, opts.fadeInMs) / 1000,
      FadeOutTime: Math.max(0, opts.fadeOutMs) / 1000,
      CurveCount: curves.length,
      TotalSegmentCount: totalSegmentCount,
      TotalPointCount: totalPointCount,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: curves,
  }
  return JSON.stringify(doc, null, opts.minify ? 0 : 2)
}
