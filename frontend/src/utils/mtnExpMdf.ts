import { ReadTextFile, WriteTextFile } from '../../wailsjs/go/main/App'

// 批量改写动作 / 表情文件。逻辑全部在前端，Go 只承担纯 IO 读写。
//
// 设计要点：
//   - 每个文件独立 try/catch，单文件失败不影响其它文件；
//   - 失败项收集到 `failed`，调用方最后用 useMessage 弹「成功 N 失败 M」；
//   - .mtn 与 .exp.json 之外的文件（包括 .motion3.json / .exp3.json）暂不支持，
//     写入失败列表并 console.info 提示，不抛错。
//
//   - 表情文件改写时尽量保留顶层字段顺序与缩进：按 key 切分原始文本，
//     仅替换 `params` 那一段的 RawMessage，其余字段原样回填。

export type CalcKind = 'none' | 'add' | 'mult' | 'set'

export interface MotionModifyOp {
  paramName: string
  paramValue: number
  action: 'set' | 'remove'
}

export interface ExpressionModifyOp {
  calc: CalcKind
  paramName: string
  paramValue: number
  action: 'set' | 'remove' | 'applyCalcOne' | 'applyCalcAll'
}

export interface BatchModifyFailed {
  path: string
  error: string
}

export interface BatchModifyResult {
  ok: number
  failed: BatchModifyFailed[]
}

// ─────────────────────────────────────────────────────────────────────────────
// .mtn
// ─────────────────────────────────────────────────────────────────────────────

const MTN_PARAM_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

/**
 * 批量修改 .mtn 文件。
 * - set：定位 `参数名=...` 那一行整行替换；找不到则在末尾追加一行（保留末尾换行）。
 * - remove：找到该行后整行删除（含紧随的换行符）。
 */
export async function modifyMtnFiles(
  paths: string[],
  op: MotionModifyOp,
): Promise<BatchModifyResult> {
  const result: BatchModifyResult = { ok: 0, failed: [] }
  for (const p of paths) {
    try {
      const txt = await ReadTextFile(p)
      const next = applyMtnChange(txt, op)
      await WriteTextFile(p, next)
      result.ok++
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      console.error('modifyMtnFiles failed', p, msg)
      result.failed.push({ path: p, error: msg })
    }
  }
  return result
}

function applyMtnChange(txt: string, op: MotionModifyOp): string {
  const lines = txt.split(/\r?\n/)
  // 末尾是否带换行：保留，避免无限循环添加空行
  const trailing = /\r?\n$/.test(txt)
  let matchedIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MTN_PARAM_RE)
    if (m && m[1] === op.paramName) {
      matchedIdx = i
      break
    }
  }
  if (op.action === 'remove') {
    if (matchedIdx < 0) {
      console.info(`modifyMtnFiles: ${op.paramName} not found, skip remove`)
      return txt
    }
    lines.splice(matchedIdx, 1)
    return lines.join('\n') + (trailing ? '\n' : '')
  }
  // set
  const valueStr = formatNumber(op.paramValue)
  if (matchedIdx >= 0) {
    lines[matchedIdx] = `${op.paramName}=${valueStr}`
  } else {
    lines.push(`${op.paramName}=${valueStr}`)
  }
  return lines.join('\n') + (trailing ? '\n' : '')
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '0'
  // 整数不带小数点；浮点保留必要精度，去掉尾随 0
  if (Number.isInteger(v)) return String(v)
  return String(parseFloat(v.toFixed(6)))
}

// ─────────────────────────────────────────────────────────────────────────────
// .exp.json
// ─────────────────────────────────────────────────────────────────────────────

interface ExpParam {
  id: string
  val: number
  calc?: string
}

function isExpJsonPath(p: string): boolean {
  const lower = p.toLowerCase()
  return lower.endsWith('.exp.json')
}

function isMotionPath(p: string): boolean {
  const lower = p.toLowerCase()
  return lower.endsWith('.mtn')
}

/**
 * 批量修改 .exp.json 文件。
 * - 顶层 `params` 数组按 op.action 增删改条目；其它顶层字段（如 type / fade_in / fade_out）原样保留。
 * - calc=none 时不写 `calc` 字段；非 none 时设置或覆盖 `calc`。
 * - 写回时按原文本的 key 顺序与缩进，仅替换 `params` 那一段。
 */
export async function modifyExpFiles(
  paths: string[],
  op: ExpressionModifyOp,
): Promise<BatchModifyResult> {
  const result: BatchModifyResult = { ok: 0, failed: [] }
  for (const p of paths) {
    if (!isExpJsonPath(p)) {
      const msg = 'only .exp.json supported (skip)'
      console.info('modifyExpFiles skip', p, msg)
      result.failed.push({ path: p, error: msg })
      continue
    }
    try {
      const txt = await ReadTextFile(p)
      const next = applyExpChange(txt, op)
      await WriteTextFile(p, next)
      result.ok++
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      console.error('modifyExpFiles failed', p, msg)
      result.failed.push({ path: p, error: msg })
    }
  }
  return result
}

/** 对单个 .exp.json 文本做改动，返回新文本。 */
function applyExpChange(txt: string, op: ExpressionModifyOp): string {
  const data = JSON.parse(txt) as Record<string, any>
  const params: ExpParam[] = Array.isArray(data.params) ? (data.params as ExpParam[]) : []
  const nextParams = mutateExpParams(params, op)
  data.params = nextParams
  return rebuildExpJson(txt, data)
}

/** 按 op 修改 params 数组。 */
function mutateExpParams(params: ExpParam[], op: ExpressionModifyOp): ExpParam[] {
  switch (op.action) {
    case 'set': {
      const idx = params.findIndex((p) => p && p.id === op.paramName)
      if (idx >= 0) {
        const next = { ...params[idx], val: op.paramValue }
        applyCalcField(next, op.calc)
        const copy = [...params]
        copy[idx] = next
        return copy
      }
      const fresh: ExpParam = { id: op.paramName, val: op.paramValue }
      applyCalcField(fresh, op.calc)
      return [...params, fresh]
    }
    case 'remove': {
      return params.filter((p) => p && p.id !== op.paramName)
    }
    case 'applyCalcOne': {
      const idx = params.findIndex((p) => p && p.id === op.paramName)
      if (idx < 0) {
        console.info(`applyCalcOne: ${op.paramName} not found, skip`)
        return params
      }
      const next = { ...params[idx] }
      applyCalcField(next, op.calc)
      const copy = [...params]
      copy[idx] = next
      return copy
    }
    case 'applyCalcAll': {
      return params.map((p) => {
        if (!p) return p
        const next = { ...p }
        applyCalcField(next, op.calc)
        return next
      })
    }
  }
}

/** 把 calc 同步到 item：none 则删除字段；非 none 则覆盖写入。 */
function applyCalcField(item: ExpParam, calc: CalcKind): void {
  if (calc === 'none') {
    delete item.calc
  } else {
    item.calc = calc
  }
}

/**
 * 保留原顶层字段顺序与缩进，仅替换 `params` 这一段。
 *
 * 思路：
 *   1. 用一个轻量扫描器把顶层对象按 key 切分，记录每个 key 的原始 RawMessage。
 *   2. 顶层 `params` 整段替换为新值序列化结果。
 *   3. 其它 key 的 raw text 原样回填，保留原顺序与缩进。
 *
 * 若解析失败，回退到 JSON.stringify(obj, null, 2)。
 */
function rebuildExpJson(originalTxt: string, obj: Record<string, any>): string {
  const segments = splitTopLevelObject(originalTxt)
  if (!segments) {
    return JSON.stringify(obj, null, 2)
  }
  const indent = segments.indent
  const paramsText = JSON.stringify(obj.params, null, indent)
    .split('\n')
    .map((line, i) => (i === 0 ? line : indent + line))
    .join('\n')

  let result = segments.beforeFirst
  for (let i = 0; i < segments.keys.length; i++) {
    const k = segments.keys[i]
    const raw = segments.rawValues[i]
    const head = i === 0
      ? JSON.stringify(k) + ':'
      : ',' + indent + JSON.stringify(k) + ':'
    const value = k === 'params' ? paramsText : raw
    result += head + value
  }
  result += segments.afterLast
  return result
}

interface TopLevelSplit {
  beforeFirst: string
  keys: string[]
  rawValues: string[]
  afterLast: string
  indent: string
}

/**
 * 把顶层 JSON 对象切分为「前缀 / key / raw value / 后缀」。
 * 仅在 `txt` 是合法 JSON 对象时返回；否则返回 null。
 *
 * 仅识别顶层 key 的形式：`<indent>"key": <raw value>`（value 不重新解析），
 * 用于保留原始字段顺序与缩进。
 */
function splitTopLevelObject(txt: string): TopLevelSplit | null {
  // 找到第一个 '{'
  const openIdx = txt.indexOf('{')
  if (openIdx < 0) return null
  const closeIdx = findMatchingClose(txt, openIdx)
  if (closeIdx < 0) return null

  // beforeFirst: 包括 '{' 之前的空白 + '{'
  const beforeFirst = txt.slice(0, openIdx + 1)
  // afterLast: 从 '}' 到结尾
  const afterLast = txt.slice(closeIdx)

  const body = txt.slice(openIdx + 1, closeIdx)

  const keys: string[] = []
  const rawValues: string[] = []
  let indent = '  '
  let i = 0

  while (i < body.length) {
    // 跳过空白与逗号
    while (i < body.length && /\s/.test(body[i])) i++
    if (i >= body.length) break
    if (body[i] === ',') {
      i++
      continue
    }
    // 期望是 "key"
    if (body[i] !== '"') return null
    const keyStart = i
    i++
    while (i < body.length && body[i] !== '"') {
      if (body[i] === '\\') i++
      i++
    }
    if (i >= body.length) return null
    const keyStr = body.slice(keyStart, i + 1)
    i++
    const keyName = JSON.parse(keyStr) as string
    keys.push(keyName)
    // 跳过冒号与空白
    while (i < body.length && /\s/.test(body[i])) i++
    if (i >= body.length || body[i] !== ':') return null
    i++
    while (i < body.length && /\s/.test(body[i])) {
      indent = deriveIndent(body, i)
      i++
    }
    // 读取 raw value
    const valueStart = i
    i = skipTopLevelValue(body, i)
    if (i <= valueStart) return null
    rawValues.push(body.slice(valueStart, i))
    // i 现在指向 value 结尾之后；外层 while 会再跳过逗号 / 空白
  }

  return { beforeFirst, keys, rawValues, afterLast, indent }
}

function deriveIndent(body: string, start: number): string {
  let j = start
  while (j < body.length && (body[j] === ' ' || body[j] === '\t')) j++
  return body.slice(start, j)
}

/** 从 idx 开始跳过一段顶层 value（string / number / bool / null / object / array），返回新 idx。 */
function skipTopLevelValue(body: string, idx: number): number {
  if (idx >= body.length) return idx
  const c = body[idx]
  if (c === '"') {
    let i = idx + 1
    while (i < body.length) {
      if (body[i] === '\\') {
        i += 2
        continue
      }
      if (body[i] === '"') {
        return i + 1
      }
      i++
    }
    return body.length
  }
  if (c === '{' || c === '[') {
    const close = c === '{' ? '}' : ']'
    let depth = 1
    let i = idx + 1
    while (i < body.length && depth > 0) {
      const cc = body[i]
      if (cc === '"') {
        i = skipTopLevelValue(body, i)
        continue
      }
      if (cc === '{' || cc === '[') depth++
      else if (cc === close) depth--
      i++
    }
    return i
  }
  // number / true / false / null
  let i = idx
  while (i < body.length && /[^,\s}]/.test(body[i])) i++
  return i
}

function findMatchingClose(txt: string, openIdx: number): number {
  if (txt[openIdx] !== '{') return -1
  let depth = 0
  let i = openIdx
  while (i < txt.length) {
    const c = txt[i]
    if (c === '"') {
      i++
      while (i < txt.length) {
        if (txt[i] === '\\') {
          i += 2
          continue
        }
        if (txt[i] === '"') break
        i++
      }
    } else if (c === '{' || c === '[') {
      depth++
    } else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

// 兼容 .mtn：暴露 isMotionPath 便于调用方预先按后缀过滤
export { isMotionPath, isExpJsonPath }
