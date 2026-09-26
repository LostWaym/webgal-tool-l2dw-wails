import type { MotionEntry, ExprEntry } from '../live2d/coreAdapter'

export type { MotionEntry, ExprEntry }

// ─────────────────────────────────────────────────────────────────────────────
// Data structures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 参数 calc 类型：写入 Live2D coreModel 时的合成方式。
 *   - set: 直接覆盖当前值
 *   - add: 在当前值上叠加增量
 *   - mult: 在当前值上乘以倍数
 * 仅运行时由编辑器设置，不持久化到 .wmdl。
 *
 * 默认值为 'set'（演出编辑器刚加载时 calc 缺省走覆盖语义）。
 * 注意：表达式文件中的 'none' 不会以 ParamCalc 形式出现，
 *       而是由 EditPanel 通过 toRangeCalc 从 CalcKind 映射为 'add'。
 */
export type ParamCalc = 'set' | 'add' | 'mult'

/**
 * 单条参数/部件初始值。
 *   - value: 加载完成时由 coreModel 抓取的快照（"原始值"）。
 *   - override: 编辑器里拖动产生的用户覆写值；不存在则表示未覆写。
 *   - calc:   override 与当前舞台值合成方式；默认 'add'。
 *   - min/max: 仅 initParams 用（部件页签固定 [0,1]，不存）。可选以便后续
 *     部件也能扩展。
 */
export interface InitParamEntry {
  id: string
  value: number
  override?: number
  calc?: ParamCalc
  min?: number
  max?: number
}

export interface WmdlModelItem {
  id: string
  name: string
  /**
   * 相对于 wmdl 的相对路径
   */
  modelRelativePath: string
  /** 模型描述 json 的**绝对路径**。运行时资源通过 `/abs_files/<encoded>` 获取。 */
  jsonAbsPath: string
  offsetX: number
  offsetY: number
  /** Cached motions parsed from this model's descriptor json. */
  motions: MotionEntry[]
  /** Cached expressions parsed from this model's descriptor json. */
  expressions: ExprEntry[]
  /**
   * 加载完成时由 coreModel 抓取的"参数"快照；编辑器拖动时写入 override。
   * 纯运行时状态，不写入 .wmdl 文件。
   */
  initParams: InitParamEntry[]
  /**
   * 加载完成时由 coreModel 抓取的"部件不透明度"快照；编辑器拖动时写入 override。
   * 纯运行时状态，不写入 .wmdl 文件。
   */
  initOpacities: InitParamEntry[]
  /**
   * 加载时读出的模型描述 json 原始对象（在 save 时被深拷贝、就地修改后写回磁盘）。
   * 未加载时为 null（例如用户刚打开 wmdl 但尚未解析过模型描述）。
   */
  rawJsonObject: any | null
  /**
   * 运行时状态数据 —— 不会序列化到 .wmdl 文件，仅在内存中持有。
   * 用于驱动编辑器的渲染层（如显隐），避免污染配置。
   */
  state: {
    visible: boolean
  }
  /** Cached: whether this is a Cubism 3+ model (true) or Cubism 2 (false). */
  isMoc3: boolean
}

export interface WmdlConfig {
  name: string
  figureTemplate: string
  transformTemplate: string
  live2dBounds: [number, number, number, number]
  models: WmdlModelItem[] // 主模型，...副模型
  wmdlFilePath?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// External wmdl JSON format
// ─────────────────────────────────────────────────────────────────────────────

export interface ExternalWmdl {
  name: string
  figureTemplate: string
  transformTemplate: string
  live2dBounds: [number, number, number, number]
  modelRelativePath: string // 主模型
  subModels?: Array<{ // 副模型
    modelRelativePath: string
    offsetX?: number
    offsetY?: number
  }>
}
