import { ReadModelJsonFile } from '../../wailsjs/go/main/App'
import { pathBasename, pathDirname, pathIsAbsolute, pathRelative, pathCombine, toFileUrl } from '../path_utils'
import type { WmdlConfig, WmdlModelItem, ExternalWmdl } from '../stores/wmdlTypes'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return a new array sorted by `name` (ascending, a → z).
 * Stable: items with equal `name` keep their original order.
 * Used to keep `motions` / `expressions` arrays ordered at the data-source
 * level so every write site stays sorted without needing UI-side sorting.
 */
export function sortByName<T extends { name: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.name.localeCompare(b.name))
}

export function deriveNameFromPath(jsonPath: string): string {
  const basename = pathBasename(jsonPath)
  if (/^model3?\.json$/i.test(basename)) {
    return pathBasename(pathDirname(jsonPath))
  }
  return basename.replace(/\.model\d?\.json$/i, '')
}

/**
 * Derive a display `name` from a motion/expression file path.
 * Strips known Cubism motion/expression extensions (case-insensitive):
 *   motion:    .mtn, .motion3.json
 *   expression: .exp.json, .exp3.json
 */
export function deriveNameFromFile(absPath: string, kind: 'motion' | 'expression'): string {
  const base = pathBasename(absPath)
  const lower = base.toLowerCase()
  const stripFromEnd = (suffix: string) =>
    lower.endsWith(suffix.toLowerCase()) ? base.slice(0, base.length - suffix.length) : null

  let stripped: string | null = null
  if (kind === 'motion') {
    stripped = stripFromEnd('.motion3.json') ?? stripFromEnd('.mtn')
  } else {
    stripped = stripFromEnd('.exp3.json') ?? stripFromEnd('.exp.json')
  }
  return stripped ?? base
}

/** 返回路径的 basename 是否以 model3.json 结尾（Cubism 3+ 模型描述）。 */
export function isMoc3JsonPath(absPath: string): boolean {
  if (!absPath) return false
  return /(^|[\\/])model3\.json$/i.test(absPath)
}

/**
 * Detect model type from JSON content.
 * - Has 'Version' field → Cubism 3+ (returns true)
 * - Has 'version' field → Cubism 2 (returns false)
 * - Default → false
 */
export function detectModelTypeFromJson(data: any): boolean {
  if (!data) return false
  if ('Version' in data) return true
  if ('version' in data) return false
  return false
}

/**
 * 读取模型描述 json 原始文本并 JSON.parse，失败/路径为空时返回 null。
 * 读取使用 Go 后端 ReadModelJsonFile（直接读盘），不依赖 /abs_files 路由。
 */
export async function readRawJsonObject(absPath: string): Promise<any | null> {
  if (!absPath) return null
  try {
    const text = await ReadModelJsonFile(absPath)
    return JSON.parse(text)
  } catch (e) {
    console.warn('readRawJsonObject failed', absPath, e)
    return null
  }
}

/**
 * 简易深拷贝：只覆盖 JSON 数据（object / array / primitive），适合描述 json
 * 这类纯数据场景。Pinia state 中保存的 rawJsonObject 因此可以安全地被拷贝修改。
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure functions for store actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a `WmdlModelItem` from a path stored in the wmdl file.
 *
 * Resolution rules:
 *  - `modelRelativePath` is absolute → used verbatim;
 *  - otherwise: reassembled into an absolute path via `pathCombine`
 *    anchored at `pathDirname(wmdlFilePath)` so the runtime `/abs_files/`
 *    route can serve it. If `wmdlFilePath` is empty, the relative path
 *    is returned as-is (no base to anchor against).
 */
export async function buildModelItem(
  modelRelativePath: string,
  wmdlFilePath: string | undefined,
): Promise<WmdlModelItem | null> {
  let jsonAbsPath: string
  if (pathIsAbsolute(modelRelativePath)) {
    jsonAbsPath = modelRelativePath
  } else {
    jsonAbsPath = pathCombine(wmdlFilePath ? pathDirname(wmdlFilePath) : '', modelRelativePath)
  }

  const id = crypto.randomUUID()
  const name = deriveNameFromPath(jsonAbsPath)
  const rawJsonObject = await readRawJsonObject(jsonAbsPath)
  const isMoc3 = detectModelTypeFromJson(rawJsonObject)

  return {
    id,
    name,
    modelRelativePath,
    jsonAbsPath,
    offsetX: 0,
    offsetY: 0,
    motions: [],
    expressions: [],
    initParams: [],
    initOpacities: [],
    rawJsonObject,
    state: { visible: true },
    isMoc3,
  }
}

/**
 * Serialize WmdlConfig to external wmdl JSON format string.
 * Recomputes every model's serialized path from its jsonAbsPath using the
 * current wmdlFilePath as anchor.
 */
export function configToJson(cfg: WmdlConfig): string {
  const saveDir = cfg.wmdlFilePath ? pathDirname(cfg.wmdlFilePath) : ''
  const relOf = (m: WmdlModelItem) => pathRelative(saveDir, m.jsonAbsPath)
  for (const m of cfg.models) {
    m.modelRelativePath = relOf(m)
  }

  const main = cfg.models[0]
  const external: ExternalWmdl = {
    name: cfg.name,
    figureTemplate: cfg.figureTemplate,
    transformTemplate: cfg.transformTemplate,
    live2dBounds: cfg.live2dBounds,
    modelRelativePath: main?.modelRelativePath ?? '',
    subModels: cfg.models.slice(1).map((m) => ({
      modelRelativePath: m.modelRelativePath,
      offsetX: m.offsetX,
      offsetY: m.offsetY,
    })),
  }
  return JSON.stringify(external, null, 2)
}

/**
 * Parse external wmdl JSON string into model items (without modifying store state).
 * Returns the parsed config object with loaded WmdlModelItem[].
 */
export async function parseWmdlJson(
  json: string,
  filePath: string,
): Promise<{
  config: Omit<WmdlConfig, 'models'> & { models: WmdlModelItem[] }
  items: WmdlModelItem[]
}> {
  console.log('parseWmdlJson', json, filePath)
  const ext: ExternalWmdl = JSON.parse(json)
  const items: WmdlModelItem[] = []

  if (ext.modelRelativePath) {
    const item = await buildModelItem(ext.modelRelativePath, filePath)
    if (item) items.push(item)
  }

  if (ext.subModels) {
    for (const sub of ext.subModels) {
      if (sub.modelRelativePath) {
        const item = await buildModelItem(sub.modelRelativePath, filePath)
        if (item) {
          item.offsetX = sub.offsetX ?? 0
          item.offsetY = sub.offsetY ?? 0
          items.push(item)
        }
      }
    }
  }

  const config = {
    name: ext.name,
    figureTemplate: ext.figureTemplate,
    transformTemplate: ext.transformTemplate,
    live2dBounds: ext.live2dBounds,
    wmdlFilePath: filePath,
    models: items,
  }

  return { config, items }
}

export { toFileUrl }
