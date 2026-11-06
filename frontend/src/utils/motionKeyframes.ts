import type { LanimFile, MotionKeyframe } from '../stores/motionEditor'

export interface KeyRef {
  kind: 'param' | 'composer'
  id: string
  frame: number
}

export interface KeySnapshot extends KeyRef {
  v: number
}

export interface KeyframePreview {
  sources: KeyRef[]
  keys: KeySnapshot[]
}

export function keyId(key: KeyRef): string {
  return JSON.stringify([key.kind, key.id, key.frame])
}

export function keysFor(lanim: LanimFile, key: KeyRef): MotionKeyframe[] | undefined {
  return key.kind === 'param'
    ? lanim.tracks.find((track) => track.paramId === key.id)?.keys
    : lanim.composers?.find((track) => track.id === key.id)?.keys
}

export function snapshotKeys(lanim: LanimFile, refs: KeyRef[]): KeySnapshot[] {
  return refs.flatMap((ref) => {
    const key = keysFor(lanim, ref)?.find((item) => item.frame === ref.frame)
    return key ? [{ ...ref, v: key.v }] : []
  })
}

export function previewLanim(lanim: LanimFile, preview: KeyframePreview | null | undefined): LanimFile {
  if (!preview) return lanim
  const targets = new Map(preview.sources.map((source, i) => [keyId(source), preview.keys[i]]))
  const previewKeys = (kind: KeyRef['kind'], id: string, keys: MotionKeyframe[]) => {
    if (!preview.sources.some((source) => source.kind === kind && source.id === id)) return keys
    return keys.map((key) => {
      const target = targets.get(keyId({ kind, id, frame: key.frame }))
      return target ? { frame: target.frame, v: target.v } : key
    }).sort((a, b) => a.frame - b.frame)
  }
  return {
    ...lanim,
    tracks: lanim.tracks.map((track) => ({ ...track, keys: previewKeys('param', track.paramId, track.keys) })),
    composers: lanim.composers?.map((track) => ({ ...track, keys: previewKeys('composer', track.id, track.keys) })),
  }
}

/** 校验整批目标；移动时源位置视为空。 */
export function validateKeyPlacement(lanim: LanimFile, keys: KeySnapshot[], sources: KeyRef[] = []): string | null {
  const sourceIds = new Set(sources.map(keyId))
  const targets = new Set<string>()
  for (const key of keys) {
    const trackKeys = keysFor(lanim, key)
    if (!trackKeys) return `轨道「${key.id}」不存在`
    if (!Number.isInteger(key.frame) || key.frame < 0 || key.frame > lanim.durationFrames) return '目标帧超出动画时长'
    const id = keyId(key)
    if (targets.has(id) || (trackKeys.some((item) => item.frame === key.frame) && !sourceIds.has(id))) {
      return `轨道「${key.id}」的第 ${key.frame} 帧已被占用`
    }
    targets.add(id)
  }
  return null
}
