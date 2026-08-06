import type { Live2DModel } from 'pixi-live2d-display-webgal'
import { toFileUrl } from '../path_utils'
import { editRuntime } from '../utils/runtimeRegistry'

/**
 * 选中模型对应的参数（"初始参数" / "部件参数" 页签）枚举与写回的统一适配层。
 *
 * 不同 Cubism 版本的 API 差异较大：
 *  - Cubism 4（moc3 / model3.json）
 *      coreModel = CubismModel
 *      枚举：coreModel.parameters.{ids,values,minimumValues,maximumValues}
 *           coreModel.parts.{ids,opacities}
 *      写回：coreModel.setParameterValueById(id, v)
 *           coreModel.setPartOpacityById(id, v)
 *  - Cubism 2（moc / model.json）
 *      coreModel = Live2DModelWebGL
 *      参数枚举：getModelContext()._$qo 取 param count；_$pb 取 {id}[] 列表
 *           min/max：ctx.getParamMin(i) / ctx.getParamMax(i)
 *           当前值：coreModel.getParamFloat(id)
 *      参数写回：coreModel.setParamFloat(id, v)
 *      部件枚举：coreModel._$5S._$F2 数组；i（数组下标）就是 part id（用于回写）
 *           显示名必须通过 e._$NL.id 取得——不是 e.id
 *           当前值：coreModel.getPartsOpacity(i)
 *      部件写回：coreModel.setPartsOpacity(id, value)
 *
 * 注意：不要从 internalModel.settings.initParams / initOpacities 拿 ID，
 * 那些只是 moc 里的初始声明值，不是运行时当前值。运行时当前值必须通过
 * coreModel.getParamFloat(id) / getPartsOpacity(id) 读取。
 *
 * 调用方（EditParamsTab / EditPartsTab）通过传入 selectedModelId 即可，
 * 不再关心 coreModel 的版本差异。
 */
export interface ParamEntry {
  id: string
  min: number
  max: number
  value: number
}

export interface PartEntry {
  /** part id（Cubism 2 下是数组下标 i；用于回写 setPartsOpacity） */
  id: string
  /** 显示名 —— Cubism 2 从 e._$NL.id 取，Cubism 4 直接用 ids[i] */
  name: string
  value: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion / Expression extraction from model descriptor JSON
// ─────────────────────────────────────────────────────────────────────────────
//
// Real-shape notes (scanned across the project's extres models):
//   model.json   (Cubism 2)   motions:     顶层 { [name]: [{ file }] }
//                                 expressions: 顶层 [{ name, file }]   (部分模型可能没有)
//   model3.json  (Cubism 3+)  FileReferences.Motions:     { [name]: [{ File }] }
//                                 FileReferences.Expressions: [{ Name, File }]   ← 实际位置
// 字段大小写自动容错：File/file, Name/name

export interface MotionEntry {
  name: string
  path: string
}

export interface ExprEntry {
  name: string
  path: string
}

export interface MotionsAndExpressions {
  motions: MotionEntry[]
  expressions: ExprEntry[]
}

/**
 * 从模型描述 json（model.json / model3.json）读取动作与表情条目，保留 json
 * 中的原始路径（不解析 blob URL）。
 *
 * @param jsonAbsPath 模型描述文件的**绝对路径**，由调用方保证。后端会按
 *                    `/abs_files/<encoded abs-path>` 直接吐出文件内容。
 */
export async function readMotionsAndExpressionsFromJson(
  jsonAbsPath: string,
): Promise<MotionsAndExpressions> {
  const empty: MotionsAndExpressions = { motions: [], expressions: [] }
  if (!jsonAbsPath) return empty
  try {
    const url = toFileUrl(jsonAbsPath)
    if (!url) return empty
    const resp = await fetch(url)
    if (!resp.ok) return empty
    const data: any = await resp.json()
    return {
      motions: parseMotions(data),
      expressions: parseExpressions(data),
    }
  } catch {
    return empty
  }
}

// ── 内部分析函数 ────────────────────────────────────────────────────────────

function pickField<T = any>(obj: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = readPath(obj, k)
    if (v !== undefined && v !== null) return v as T
  }
  return undefined
}

function readPath(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') return undefined
  let cur: any = obj
  for (const p of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return cur
}

function parseMotions(data: any): MotionEntry[] {
  const motionsObj = pickField<Record<string, any[]>>(
    data,
    'FileReferences.Motions',
    'motions',
  )
  if (!motionsObj || typeof motionsObj !== 'object') return []

  const out: MotionEntry[] = []
  for (const [name, list] of Object.entries(motionsObj)) {
    if (!Array.isArray(list) || list.length === 0) continue
    const first = list[0]
    if (!first || typeof first !== 'object') continue
    const file = pickField<string>(first, 'File', 'file')
    if (typeof file !== 'string' || !file) continue
    out.push({ name, path: file })
  }
  return out
}

function parseExpressions(data: any): ExprEntry[] {
  const arr = pickField<any[]>(
    data,
    'FileReferences.Expressions',
    'expressions',
  )
  if (!Array.isArray(arr)) return []

  const out: ExprEntry[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const name = pickField<string>(item, 'Name', 'name')
    const file = pickField<string>(item, 'File', 'file')
    if (typeof name !== 'string' || !name) continue
    if (typeof file !== 'string' || !file) continue
    out.push({ name, path: file })
  }
  return out
}

function readEditModelsMap(): Map<string, Live2DModel> {
  return editRuntime.live2dModels
}

/** 按 id 拿 Live2DModel 实例，找不到返回 null。 */
export function getModelById(selectedModelId: string | null): Live2DModel | null {
  if (!selectedModelId) return null
  return readEditModelsMap().get(selectedModelId) ?? null
}

/** 按 id 拿 coreModel（任意版本统一返回 any，找不到返回 null）。 */
export function getCoreById(selectedModelId: string | null): any | null {
  const m = getModelById(selectedModelId)
  if (!m) return null
  return (m as any).internalModel?.coreModel ?? null
}

/** 列出当前模型所有参数（id + 范围 + 当前值）。找不到模型返回空数组。 */
export function listParameters(selectedModelId: string | null): ParamEntry[] {
  const model = getModelById(selectedModelId)
  if (!model) return []
  return readParametersInternal(model)
}

/** 列出当前模型所有部件（id + 不透明度）。找不到模型返回空数组。 */
export function listParts(selectedModelId: string | null): PartEntry[] {
  const model = getModelById(selectedModelId)
  if (!model) return []
  return readPartsInternal(model)
}

/** 写入参数。id 不存在或核心未就绪时静默忽略。 */
export function writeParameter(selectedModelId: string | null, id: string, value: number): void {
  const core = getCoreById(selectedModelId)
  if (!core) return
  if (typeof core.setParameterValueById === 'function') {
    core.setParameterValueById(id, value)
    return
  }
  if (typeof core.setParamFloat === 'function') {
    core.setParamFloat(id, value)
  }
}

/** 写入部件不透明度。id 是 part id（Cubism 4 为字符串，Cubism 2 为数组下标 i）。 */
export function writePartOpacity(selectedModelId: string | null, id: string, value: number): void {
  const core = getCoreById(selectedModelId)
  if (!core) return
  if (typeof core.setPartOpacityById === 'function') {
    core.setPartOpacityById(id, value)
    return
  }
  // Cubism 2：getPartsOpacity / setPartsOpacity 接受 string 或 number id
  if (typeof core.setPartsOpacity === 'function') {
    core.setPartsOpacity(id, value)
  }
}

/* 内部实现 */

function readParametersInternal(model: Live2DModel): ParamEntry[] {
  const core: any = (model as any).internalModel?.coreModel
  if (!core) return []

  // Cubism 4：getParameterCount / getParameterId / getParameterValueById
  // 这条是 Cubism 4 的"按 index 枚举"风格；min/max 用 getParameterMinimumValue/MaximumValue(i)
  const pcount = typeof core.getParameterCount === 'function' ? core.getParameterCount() : -1
  if (pcount > 0 && typeof core.getParameterValueById === 'function') {
    const out: ParamEntry[] = []
    for (let i = 0; i < pcount; i++) {
      const id = core._parameterIds[i]
      if (!id) continue
      out.push({
        id: String(id),
        min: core.getParameterMinimumValue(i),
        max: core.getParameterMaximumValue(i),
        value:
          typeof core.getParameterDefaultValue === 'function'
            ? core.getParameterDefaultValue(i)
            : 0,
      })
    }
    return out
  }

  // Cubism 2：通过 getModelContext()._$qo 取 param count，_$pb 取 param 数组
  // 每个元素形如 { id: 'PARAM_ANGLE_X' }；min/max 用 getParamMin/Max(index) 取
  // 当前值用 core.getParamFloat(id)
  const ctx = (core as any).getModelContext?.()
  const totalParams: number | undefined = ctx?._$qo
  const params2: Array<{ id: string }> | undefined = ctx?._$pb
  const params:Array<any> = (core as any)._$MT._$vo._$4S
  if (
    typeof totalParams === 'number' &&
    totalParams > 0 &&
    Array.isArray(params2) &&
    params2.length > 0
  ) {
    const out: ParamEntry[] = []
    for (let i = 0; i < totalParams; i++) {
      const entry = params2[i]
      const id = entry && typeof entry === 'object' && entry.id ? String(entry.id) : ''
      if (!id) continue
      const p = params[i]
      out.push({
        id,
        min: p._$TT,
        max: p._$LT,
        value: p._$FS,
      })
    }
    return out
  }

  return []
}

function readPartsInternal(model: Live2DModel): PartEntry[] {
  const core: any = (model as any).internalModel?.coreModel
  if (!core) return []

  // Cubism 4：getPartCount / getPartIdByIndex / getPartOpacityByIndex
  // 这条是 Cubism 4 的"按 index 枚举"风格；part id 本身就是显示名
  const count = typeof core.getPartCount === 'function' ? core.getPartCount() : -1
  if (count > 0 && typeof core.getPartOpacityByIndex === 'function') {
    const out: PartEntry[] = []
    for (let i = 0; i < count; i++) {
      const partId = core._partIds[i]
      if (!partId) continue
      const name = String(partId)
      out.push({
        id: name,
        name,
        value: core.getPartOpacityByIndex(i),
      })
    }
    return out
  }

  // Cubism 2：通过 core._$5S._$F2 数组读取部件；i 本身就是 part id，
  // 显示名必须从 e._$NL.id 读。当前值用 core.getPartsOpacity(i) 读。
  const partsArr: any[] | undefined = (core as any)._$5S?._$F2
  if (Array.isArray(partsArr) && partsArr.length > 0) {
    const out: PartEntry[] = []
    // i 本身就是 part id；显示名从 e._$NL.id 读
    for (let i = 0; i < partsArr.length; i++) {
      const e = partsArr[i]
      const displayName = e._$NL.id
      out.push({
        id: displayName,
        name: displayName,
        value: e.visible ? 1 : 0,
      })
    }
    return out
  }

  return []
}