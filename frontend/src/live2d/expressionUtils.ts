import { ReadTextFile, WriteTextFile } from '../../wailsjs/go/main/App'
import { toFileUrl, pathCombine, pathDirname } from '../path_utils'

/**
 * 表情文件 (.exp.json / .exp3.json) 的统一读写与序列化工具。
 *
 * 与 mtnExpMdf.ts 的区别：
 *   - mtnExpMdf 偏"批量修改现有文件"（保留顶层字段顺序，定位 params 段替换）；
 *   - 本文件偏"完整生成一个新文件"（直接 JSON.stringify），因为：
 *       ① 表情编辑模态里的输出就是"用户在左预览上点击后产生的参数快照"，
 *          文件结构由我们控制，不存在第三方顺序约束；
 *       ② 生成路径由 PickSaveFileDialog 选定，不依赖 mtnExpMdf 的"原文本保留"逻辑。
 *
 * 文件结构见计划文件：
 *   - .exp.json  (Cubism 2)   { type, fade_in, fade_out, params: [{ id, val, calc? }] }
 *   - .exp3.json (Cubism 3+)  { Type, Parameters: [{ Id, Value, Blend }] }
 */

export type CalcKind = 'none' | 'add' | 'mult' | 'set'

/** 内存中的统一快照条目。导出时按目标格式做字段映射。 */
export interface ParamSnapshot {
  id: string
  val: number
  calc: CalcKind
}

export interface ReadExpResult {
  format: 'exp' | 'exp3'
  snapshot: ParamSnapshot[]
}

/**
 * 从表情文件中读出参数快照，自动识别 .exp.json / .exp3.json。
 * 文件后缀不识别时抛错。
 */
export async function readExpressionFile(absPath: string): Promise<ReadExpResult> {
  const lower = absPath.toLowerCase()
  if (lower.endsWith('.exp3.json')) {
    const text = await ReadTextFile(absPath)
    return { format: 'exp3', snapshot: parseExp3Json(text) }
  }
  if (lower.endsWith('.exp.json')) {
    const text = await ReadTextFile(absPath)
    return { format: 'exp', snapshot: parseExpJson(text) }
  }
  throw new Error(`readExpressionFile: unsupported extension for ${absPath}`)
}

/**
 * 直接 fetch 一个表情文件 URL（用于浏览器内嵌的预览资源，不走 Go 后端 IO）。
 * 注意：路径必须是绝对路径，会通过 toFileUrl 走 /abs_files/ 路由。
 */
export async function fetchExpressionFile(absPath: string): Promise<ReadExpResult> {
  const url = toFileUrl(absPath)
  if (!url) return { format: 'exp', snapshot: [] }
  const resp = await fetch(url)
  if (!resp.ok) return { format: 'exp', snapshot: [] }
  const text = await resp.text()
  const lower = absPath.toLowerCase()
  if (lower.endsWith('.exp3.json')) {
    return { format: 'exp3', snapshot: parseExp3Json(text) }
  }
  return { format: 'exp', snapshot: parseExpJson(text) }
}

// ── Cubism 2 / .exp.json ─────────────────────────────────────────────────────

function parseExpJson(txt: string): ParamSnapshot[] {
  let data: any
  try {
    data = JSON.parse(txt)
  } catch {
    return []
  }
  const arr = Array.isArray(data?.params) ? data.params : []
  const out: ParamSnapshot[] = []
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue
    const id = typeof p.id === 'string' ? p.id : ''
    if (!id) continue
    const val = Number(p.val)
    if (!Number.isFinite(val)) continue
    const calc = normalizeCalc(p.calc)
    out.push({ id, val, calc })
  }
  return out
}

/**
 * 生成 .exp.json 的完整 JSON 文本。
 * 单行压缩风格，与样本一致。
 */
function buildExpJson(snapshot: ParamSnapshot[], fadeIn = 500, fadeOut = 500): string {
  const params = snapshot.map((p) => {
    const item: Record<string, unknown> = { id: p.id, val: p.val }
    if (p.calc !== 'none') item.calc = p.calc
    return item
  })
  return JSON.stringify({
    type: 'Live2D Expression',
    fade_in: fadeIn,
    fade_out: fadeOut,
    params,
  })
}

// ── Cubism 3+ / .exp3.json ──────────────────────────────────────────────────

function parseExp3Json(txt: string): ParamSnapshot[] {
  let data: any
  try {
    data = JSON.parse(txt)
  } catch {
    return []
  }
  const arr = Array.isArray(data?.Parameters) ? data.Parameters : []
  const out: ParamSnapshot[] = []
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue
    const id = typeof p.Id === 'string' ? p.Id : ''
    if (!id) continue
    const val = Number(p.Value)
    if (!Number.isFinite(val)) continue
    const blend = Number(p.Blend)
    out.push({ id, val, calc: blendToCalc(blend) })
  }
  return out
}

/**
 * 生成 .exp3.json 的完整 JSON 文本。
 * 使用 2 空格缩进的可读风格（与样本一致）。
 */
function buildExp3Json(snapshot: ParamSnapshot[], fadeIn = 500, fadeOut = 500): string {
  const Parameters = snapshot.map((p) => ({
    Id: p.id,
    Value: p.val,
    Blend: calcToBlend(p.calc),
  }))
  const obj: Record<string, unknown> = {
    Type: 'Live2D Expression',
    Parameters,
  }
  if (fadeIn !== undefined) obj.fade_in = fadeIn
  if (fadeOut !== undefined) obj.fade_out = fadeOut
  return JSON.stringify(obj, null, 2)
}

// ── Calc / Blend 互转（与 mtnExpMdf.ts CalcKind 对齐） ─────────────────────

function normalizeCalc(raw: unknown): CalcKind {
  if (raw === 'add' || raw === 'mult' || raw === 'set') return raw
  return 'none'
}

/**
 * Blend 数值 → CalcKind。
 *  - 0 = Override → 'set'
 *  - 1 = Add      → 'add'
 *  - 2 = Multiply → 'mult'
 *  - 其它 / 未指定 → 'none'
 */
function blendToCalc(blend: number): CalcKind {
  if (blend === 0) return 'set'
  if (blend === 1) return 'add'
  if (blend === 2) return 'mult'
  return 'none'
}

/**
 * CalcKind → Blend 数值。
 *  - 'add' / 'none' → 1
 *  - 'mult'         → 2
 *  - 'set'          → 0
 */
function calcToBlend(calc: CalcKind): 0 | 1 | 2 {
  if (calc === 'mult') return 2
  if (calc === 'set') return 0
  return 1
}

// ── 导出入口 ───────────────────────────────────────────────────────────────

/**
 * 写入 .exp.json（Cubism 2 表情格式）。
 */
export async function exportAsExpJson(
  targetPath: string,
  _name: string,
  snapshot: ParamSnapshot[],
  fadeIn = 500,
  fadeOut = 500,
): Promise<void> {
  const content = buildExpJson(snapshot, fadeIn, fadeOut)
  await WriteTextFile(targetPath, content)
}

/**
 * 写入 .exp3.json（Cubism 3+ 表情格式）。
 */
export async function exportAsExp3Json(
  targetPath: string,
  _name: string,
  snapshot: ParamSnapshot[],
  fadeIn = 500,
  fadeOut = 500,
): Promise<void> {
  const content = buildExp3Json(snapshot, fadeIn, fadeOut)
  await WriteTextFile(targetPath, content)
}

/**
 * 给定当前选中模型的描述 json 路径，推算默认导出目录。
 * 约定为：<modelDir>/expressions/，不存在则使用 modelDir 本身。
 */
export function defaultExportDirForModel(jsonAbsPath: string): string {
  const modelDir = pathDirname(jsonAbsPath)
  return pathCombine(modelDir, 'expressions')
}
