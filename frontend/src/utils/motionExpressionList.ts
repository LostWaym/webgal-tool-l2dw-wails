import type { Live2DModel } from 'pixi-live2d-display-webgal'
import { filterBySearch } from './searchUtils'

export interface MotionInfo { group: string; index: number; name: string }
export interface ExpressionInfo { index: number; name: string }

export function extractMotions(model: Live2DModel): MotionInfo[] {
  const defs = model.internalModel?.motionManager?.definitions as Record<string, any[]> | undefined
  const result: MotionInfo[] = []
  for (const [group, list] of Object.entries(defs ?? {})) {
    list.forEach((def, index) => result.push({ group, index, name: def.name || group }))
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export function extractExpressions(model: Live2DModel): ExpressionInfo[] {
  const defs = (model.internalModel?.motionManager as any)?.expressionManager?.definitions as any[] | undefined
  return (defs ?? []).map((def, index) => ({
    index, name: def.name || def.Name || def.file || def.File || `expression_${index}`,
  })).sort((a, b) => a.name.localeCompare(b.name))
}

export function nameSegments(name: string, enabled: boolean, separator: string): string[] {
  if (!enabled) return [name]
  const segments = name.split(separator).filter(Boolean)
  return segments.length ? segments : [name]
}

export function directoryContents<T extends { name: string }>(
  items: T[], path: string[], query: string, enabled: boolean, separator: string,
) {
  if (query.trim()) {
    const matching = filterBySearch(items, query, item => item.name)
    return { matching, folders: [] as string[], entries: matching }
  }
  const matching = items.filter(item => {
    const segments = nameSegments(item.name, enabled, separator)
    return path.every((part, index) => segments[index] === part) && segments.length > path.length
  })
  const folders = new Set<string>()
  const entries: T[] = []
  for (const item of matching) {
    const segments = nameSegments(item.name, enabled, separator)
    if (segments.length > path.length + 1) folders.add(segments[path.length])
    else entries.push(item)
  }
  return { matching, folders: Array.from(folders).sort((a, b) => a.localeCompare(b)), entries }
}
