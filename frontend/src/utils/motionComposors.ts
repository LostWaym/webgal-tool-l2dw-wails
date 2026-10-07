/**
 * 组合器（composer）定义文件的解析与模型参数解析。
 *
 * 定义文件位于 assets/motion_composors/*.json，一个文件一个组合器，
 * 文件名去 .json 后缀 = 组合器 id。lanim 中只存 id 引用与帧数据，
 * def 结构不写入 lanim（单一数据出口）。
 */

export type ComposerType = 'switch'

/** 激活/非激活写入值；缺省为 1/0。 */
export interface ComposerRange {
  active: number
  inactive: number
}

export interface ComposerDef {
  /** 组合器 id（= 文件名去 .json 后缀） */
  id: string
  /** 显示名 */
  name: string
  type: ComposerType
  /** 成员 ID 与模型参数匹配时是否忽略大小写 */
  ignoreNameCase: boolean
  /** 激活/非激活写入值 */
  range: ComposerRange
  /** 成员参数 ID（原始值），顺序 = dropdown 顺序 */
  members: string[]
  /** 成员解析到模型真实参数 ID 的结果（无效成员位为 null） */
  resolvedMembers: Array<string | null>
}

/** 把任意 json 解析为 ComposerDef；结构不合法返回 null。 */
export function parseComposerFile(text: string, id: string): ComposerDef | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (obj.type !== 'switch') return null
  if (!Array.isArray(obj.members) || obj.members.length === 0) return null
  const members: string[] = []
  for (const m of obj.members) {
    if (typeof m !== 'string' || !m) return null
    if (!members.includes(m)) members.push(m)
  }
  let range: ComposerRange = { active: 1, inactive: 0 }
  if (obj.range !== undefined) {
    if (typeof obj.range !== 'object' || obj.range === null) return null
    const r = obj.range as Record<string, unknown>
    if (typeof r.active !== 'number' || typeof r.inactive !== 'number') return null
    range = { active: r.active, inactive: r.inactive }
  }
  const name = typeof obj.name === 'string' && obj.name ? obj.name : id
  const ignoreNameCase = obj.ignoreNameCase === true
  return {
    id,
    name,
    type: 'switch',
    ignoreNameCase,
    range,
    members,
    resolvedMembers: members.map(() => null),
  }
}

/**
 * 用模型参数列表解析组合器成员的真实参数 ID。
 * ignoreNameCase 时按小写映射查找；冲突取参数列表靠前者。
 * 就地写入 def.resolvedMembers（唯一入口，下游只消费 resolved 结果）。
 */
export function resolveComposerMembers(def: ComposerDef, paramIds: string[]) {
  const exact = new Set(paramIds)
  const lowerMap = new Map<string, string>()
  for (const id of paramIds) {
    const key = id.toLowerCase()
    if (!lowerMap.has(key)) lowerMap.set(key, id)
  }
  def.resolvedMembers = def.members.map((m) => {
    if (exact.has(m)) return m
    if (def.ignoreNameCase) return lowerMap.get(m.toLowerCase()) ?? null
    return null
  })
}

/** 成员是否有效（可采样 / 可 k 帧 / dropdown 可选）。 */
export function isMemberValid(def: ComposerDef, index: number): boolean {
  return def.resolvedMembers[index] != null
}

/**
 * 按 id 批量加载 composer def（id + '.json'）。
 * 返回成功加载的 {id → def}；文件缺失 / 读取失败 / 解析失败的 id 跳过并收集到 failed。
 */
export async function loadComposerDefsByIds(
  ids: string[],
): Promise<{ defs: Record<string, ComposerDef>; failed: Array<{ id: string; reason: string }> }> {
  const result: { defs: Record<string, ComposerDef>; failed: Array<{ id: string; reason: string }> } = {
    defs: {},
    failed: [],
  }
  if (!ids.length) return result
  const { ListComposerFiles, ReadComposerFile } = await import('../../wailsjs/go/main/App')
  let files: string[] = []
  try {
    files = await ListComposerFiles()
  } catch (e) {
    return { defs: {}, failed: ids.map((id) => ({ id, reason: `列目录失败：${e}` })) }
  }
  for (const id of ids) {
    const filename = files.find((f) => f.replace(/\.json$/i, '') === id)
    if (!filename) {
      result.failed.push({ id, reason: '定义文件不存在' })
      continue
    }
    try {
      const content = await ReadComposerFile(filename)
      const def = parseComposerFile(content, id)
      if (!def) {
        result.failed.push({ id, reason: '定义文件内容无效' })
        continue
      }
      result.defs[id] = def
    } catch (e) {
      result.failed.push({ id, reason: `读取失败：${e}` })
    }
  }
  return result
}
