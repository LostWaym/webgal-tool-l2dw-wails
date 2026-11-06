import type { LanimFile, MotionKeyframe, MotionTrack } from '../stores/motionEditor'

export function parseMtn(text: string, name: string): LanimFile {
  let fps = 0
  const tracks: MotionTrack[] = []
  const ids = new Set<string>()
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
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
    ids.add(id)
    tracks.push({ paramId: id, keys: values.map((v, frame) => ({ frame, v: Number(v) })) })
  }
  if (!Number.isFinite(fps) || fps <= 0 || !tracks.length) throw new Error('动作缺少有效帧率或参数')
  const durationFrames = Math.max(1, ...tracks.map((track) => track.keys.length - 1))
  return { version: 1, name, fps, durationFrames, tracks }
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
