import { defineStore } from 'pinia'
import { Live2DModel, MotionPriority, baseBlinkParam } from 'pixi-live2d-display-webgal'
import { PickLive2DModel, PickWmdlFile, ReadWmdlFile, SaveWmdlFile, GetFileModifyTime, PickImageFile } from '../../wailsjs/go/main/App'
import { pathDirname, pathRelative } from '../path_utils'
import { parseWmdlJson } from '../utils/wmdlUtils'
import { deriveNameFromPath } from '../utils/wmdlUtils'
import {
  DEFAULT_BG_TEMPLATE,
  DEFAULT_BG_TRANSFORM_TEMPLATE,
  DEFAULT_STAGE_TRANSFORM_TEMPLATE,
  DEFAULT_FIGURE_TEMPLATE,
  DEFAULT_TRANSFORM_TEMPLATE,
  DEFAULT_IMAGE_FIGURE_TEMPLATE,
  DEFAULT_IMAGE_TRANSFORM_TEMPLATE,
} from '../utils/consts'
import { SpecialId, isSpecialId, isFigureGroupId, makeFigureGroupId } from '../live2d/specialIds'
import type { WmdlModelItem, WmdlConfig } from './wmdlTypes'
import { previewRuntime } from '../utils/runtimeRegistry'
import type { L2dwContainer } from '../live2d/L2dwContainer'
import { DEFAULT_FILTER_PROPERTY_VALUES, FILTER_PROPERTY_KEYS } from '../live2d/L2dwContainer'

interface MotionState {
  group: string
  index: number
  name: string
}

interface ExpressionState {
  index: number
  name: string
}

interface PlayingState {
  motion: MotionState | null
  expression: ExpressionState | null
}

export interface TransformState {
  x: number
  y: number
  scale: { x: number; y: number }
  rotation: number
}

export const DEFAULT_TRANSFORM_STATE: TransformState = {
  x: 0,
  y: 0,
  scale: { x: 1, y: 1 },
  rotation: 0,
}

/** 变换快照：仅缓存 x/y/scale/rotation */
export interface TransformSnapshot {
  id: string
  name: string
  x: number
  y: number
  scale: { x: number; y: number }
  rotation: number
}

/**
 * 滤镜状态（仅运行时，不持久化到 wmdl）。
 * 与 L2dwContainer 的 PROPERTY_CONFIGS 一一对应；多出 `l2dwAlphaFilter`
 * 表示"整容器 alpha 滤镜"（与父类 `PIXI.Container.alpha` 区分开）。
 */
export interface FilterState {
  blur: number
  brightness: number
  contrast: number
  saturation: number
  gamma: number
  colorRed: number
  colorGreen: number
  colorBlue: number
  oldFilm: number
  dotFilm: number
  reflectionFilm: number
  glitchFilm: number
  rgbFilm: number
  godrayFilm: number
  bevel: number
  bevelThickness: number
  bevelRotation: number
  bevelSoftness: number
  bevelRed: number
  bevelGreen: number
  bevelBlue: number
  bloom: number
  bloomBrightness: number
  bloomBlur: number
  bloomThreshold: number
  l2dwAlphaFilter: number
}

export const DEFAULT_FILTER_STATE: FilterState = {
  ...DEFAULT_FILTER_PROPERTY_VALUES,
  l2dwAlphaFilter: 1,
} as FilterState

/**
 * 注视状态（仅运行时，不持久化到 wmdl）。
 * `enabled` 为 false 时不应用控制器（眼睛居中）且不输出 -focus 参数。
 */
export interface FocusState {
  enabled: boolean
  x: number
  y: number
  instant: boolean
}

export const DEFAULT_FOCUS_STATE: FocusState = {
  enabled: false,
  x: 0,
  y: 0,
  instant: false,
}

/**
 * 眨眼状态（仅运行时，不持久化到 wmdl）。
 * `enabled` 为 false 时回退 baseBlinkParam（接近不眨眼）且不输出 -blink 参数。
 */
export interface BlinkState {
  enabled: boolean
  blinkInterval: number
  blinkIntervalRandom: number
  closingDuration: number
  closedDuration: number
  openingDuration: number
}

export const DEFAULT_BLINK_STATE: BlinkState = {
  enabled: false,
  ...baseBlinkParam,
}

export interface ModelEntry {
  id: string
  name: string
  /**
   * 'live2d'：.model.json / .model3.json（wmdl 子模型列表）
   * 'image'：单张图片（PIXI.Sprite，FitInside）
   * 缺省视为 'live2d'，老数据兼容。
   */
  kind: 'live2d' | 'image'
  /**
   * 模型描述 json 的**绝对路径**。
   * Wails 的 `PickLive2DModel` 返回的就是 OS 给出的绝对路径，
   * 直接拿去做 `/abs_files/<encoded>` 的资源访问。
   */
  jsonPath: string
  /** 仅 kind==='image' 时使用：图片绝对路径 */
  imageUrl?: string
  visible: boolean
  playing: PlayingState
  /** 变换状态（x, y, scale, rotation） */
  state: TransformState
  wmdlModels: WmdlModelItem[]
  /** 存放 figureTemplate / transformTemplate 等 */
  wmdlConfig?: WmdlConfig
  /** Cached: whether this is a Cubism 3+ model (true) or Cubism 2 (false). */
  isMoc3: boolean
}

/**
 * 立绘组：把多个立绘（或嵌套立绘组）组合在一起，共享统一的 GRS 变换。
 * - id 形如 'group:<uuid>'，通过 isFigureGroupId 识别
 * - 变换中心 (x, y) 是 GRS 操作的基准点
 * - targetIds 指向具体立绘；targetGroupIds 指向嵌套立绘组（递归展平）
 * - includeBackground / includeAllFigures 用于复制指令时的扩展范围
 */
export interface FigureGroupEntry {
  id: string
  name: string
  /** 变换中心 x */
  x: number
  /** 变换中心 y */
  y: number
  /** 目标立绘 ID 列表 */
  targetIds: string[]
  /** 目标立绘组 ID 列表（支持嵌套） */
  targetGroupIds: string[]
  /** 是否在复制指令时也复制背景 */
  includeBackground: boolean
  /** 是否在复制指令时包含当前所有立绘 */
  includeAllFigures: boolean
  /** 是否仅编辑锚点（X/Y 与 G 拖拽只改锚点本身，不动目标与背景） */
  editAnchorOnly: boolean
}

export const useModelStore = defineStore('models', {
  state: () => ({
    models: [] as ModelEntry[],
    figureGroups: [] as FigureGroupEntry[],
    selectedId: null as string | null,
    backgroundUrl: null as string | null,
    bgTemplate: DEFAULT_BG_TEMPLATE,
    bgTransformTemplate: DEFAULT_BG_TRANSFORM_TEMPLATE,
    stageTransformTemplate: DEFAULT_STAGE_TRANSFORM_TEMPLATE,
    bgHistory: [] as string[],
    /** 背景容器（BgContainer）的变换状态 */
    bgState: { ...DEFAULT_TRANSFORM_STATE } as TransformState,
    /** 主场景容器（StageMain）的变换状态 */
    stageState: { ...DEFAULT_TRANSFORM_STATE } as TransformState,
    /** 变换快照列表 */
    transformSnapshots: [] as TransformSnapshot[],
    /** 模态打开时缓存的原始变换（关闭时用于恢复） */
    cachedTransformBeforeModal: null as TransformState | null,
    /** 图片立绘全局模板：所有 kind==='image' 共用 */
    imageFigureTemplate: DEFAULT_IMAGE_FIGURE_TEMPLATE,
    imageTransformTemplate: DEFAULT_IMAGE_TRANSFORM_TEMPLATE,
    /** 滤镜状态：按 modelId 索引（仅运行时，不写入 wmdl） */
    figureFilterStates: {} as Record<string, FilterState>,
    bgFilterState: { ...DEFAULT_FILTER_STATE } as FilterState,
    stageFilterState: { ...DEFAULT_FILTER_STATE } as FilterState,
    /** 注视状态：按 modelId 索引（仅 live2d 模型，仅运行时） */
    figureFocusStates: {} as Record<string, FocusState>,
    /** 眨眼状态：按 modelId 索引（仅 live2d 模型，仅运行时） */
    figureBlinkStates: {} as Record<string, BlinkState>,
  }),
  getters: {
    selectedModel(state): ModelEntry | null {
      if (!state.selectedId) return null
      return state.models.find((m) => m.id === state.selectedId) ?? null
    },
    selectedFigureGroup(state): FigureGroupEntry | null {
      const id = state.selectedId
      if (!id || !isFigureGroupId(id)) return null
      return state.figureGroups.find((g) => g.id === id) ?? null
    },
    getPlayingState: (state) => (modelId: string): PlayingState => {
      return state.models.find((m) => m.id === modelId)?.playing ?? { motion: null, expression: null }
    },
    getTransformState: (state) => (id: string): TransformState => {
      // 特殊容器
      if (id === SpecialId.StageMain) return state.stageState
      if (id === SpecialId.BgContainer) return state.bgState
      // 普通模型
      const model = state.models.find((m) => m.id === id)
      return model?.state ?? { ...DEFAULT_TRANSFORM_STATE }
    },
    getFilterState: (state) => (id: string | null): FilterState => {
      if (!id) return { ...DEFAULT_FILTER_STATE }
      if (id === SpecialId.StageMain) return state.stageFilterState
      if (id === SpecialId.BgContainer) return state.bgFilterState
      const own = state.figureFilterStates[id]
      // 惰性初始化通过 setFilterState 完成；此处读到 undefined 直接给默认快照
      return own ?? { ...DEFAULT_FILTER_STATE }
    },
    getFocusState: (state) => (id: string | null): FocusState => {
      if (!id) return { ...DEFAULT_FOCUS_STATE }
      return state.figureFocusStates[id] ?? { ...DEFAULT_FOCUS_STATE }
    },
    getBlinkState: (state) => (id: string | null): BlinkState => {
      if (!id) return { ...DEFAULT_BLINK_STATE }
      return state.figureBlinkStates[id] ?? { ...DEFAULT_BLINK_STATE }
    },
  },
  actions: {
    async add(): Promise<ModelEntry | null> {
      const jsonPath = await PickLive2DModel()
      if (!jsonPath) return null

      const wmdlPath = jsonPath.replace(/\.json$/, '.wmdl')
      let entry: ModelEntry | null = null

      try {
        const mtime = await GetFileModifyTime(wmdlPath)
        if (mtime > 0) {
          entry = await this._loadWmdlFromFile(wmdlPath)
        }
      } catch {
        // wmdl 不存在，继续创建
      }

      if (!entry) {
        const name = deriveNameFromPath(jsonPath)
        const wmdlDir = pathDirname(wmdlPath)
        const modelRelativePath = pathRelative(wmdlDir, jsonPath)

        const wmdlContent = JSON.stringify(
          {
            name,
            figureTemplate: DEFAULT_FIGURE_TEMPLATE,
            transformTemplate: DEFAULT_TRANSFORM_TEMPLATE,
            live2dBounds: [0, 0, 0, 0] as [number, number, number, number],
            modelRelativePath,
            subModels: [],
          },
          null,
          2,
        )
        await SaveWmdlFile(wmdlPath, wmdlContent)
        entry = await this._loadWmdlFromFile(wmdlPath)
      }

      if (entry) {
        entry.kind = 'live2d'
        this.models.push(entry)
      }
      return entry
    },
    async loadWmdl(): Promise<ModelEntry | null> {
      const filePath = await PickWmdlFile()
      if (!filePath) return null

      const entry = await this._loadWmdlFromFile(filePath)
      if (entry) {
        entry.kind = 'live2d'
        this.models.push(entry)
      }
      return entry
    },
    /** 新增"加载图片"类型：以图片作为立绘（FitInside） */
    async addImageFigure(): Promise<ModelEntry | null> {
      const imagePath = await PickImageFile()
      if (!imagePath) return null

      // 去掉扩展名（.png / .jpg / .jpeg / .webp）
      const name = deriveNameFromPath(imagePath).replace(/\.[^.]+$/, '')

      const entry: ModelEntry = {
        id: crypto.randomUUID(),
        kind: 'image',
        name,
        jsonPath: '',
        imageUrl: imagePath,
        visible: true,
        playing: { motion: null, expression: null },
        state: { ...DEFAULT_TRANSFORM_STATE },
        wmdlModels: [],
        isMoc3: false,
      }
      this.models.push(entry)
      return entry
    },
    async _loadWmdlFromFile(filePath: string): Promise<ModelEntry | null> {
      const content = await ReadWmdlFile(filePath)
      const { config } = await parseWmdlJson(content, filePath)

      const mainModel = config.models[0]
      return {
        id: crypto.randomUUID(),
        kind: 'live2d',
        name: config.name || mainModel?.name || 'Wmdl Model',
        jsonPath: mainModel?.jsonAbsPath || '',
        visible: true,
        playing: { motion: null, expression: null },
        state: { ...DEFAULT_TRANSFORM_STATE },
        wmdlModels: config.models,
        wmdlConfig: {
          name: config.name,
          figureTemplate: config.figureTemplate,
          transformTemplate: config.transformTemplate,
          live2dBounds: config.live2dBounds,
          models: config.models,
          wmdlFilePath: config.wmdlFilePath,
        },
        isMoc3: mainModel?.isMoc3 ?? false,
      }
    },
    /** 重新读取 wmdl 配置文件，更新 wmdlModels 和 wmdlConfig，保留 id 和 state */
    async reloadWmdlConfig(entryId: string): Promise<boolean> {
      const entry = this.models.find((m) => m.id === entryId)
      if (!entry || !entry.wmdlConfig?.wmdlFilePath) {
        return false
      }

      const content = await ReadWmdlFile(entry.wmdlConfig.wmdlFilePath)
      const { config } = await parseWmdlJson(content, entry.wmdlConfig.wmdlFilePath)

      // 更新配置
      Object.assign(entry, {
        name: config.name || entry.name,
        jsonPath: config.models[0]?.jsonAbsPath || entry.jsonPath,
        wmdlModels: config.models,
        wmdlConfig: {
          name: config.name,
          figureTemplate: config.figureTemplate,
          transformTemplate: config.transformTemplate,
          live2dBounds: config.live2dBounds,
          models: config.models,
          wmdlFilePath: config.wmdlFilePath,
        },
        isMoc3: config.models[0]?.isMoc3 ?? entry.isMoc3,
      })

      return true
    },
    async remove(id: string): Promise<void> {
      const entry = this.models.find((m) => m.id === id)
      // 清理 wmdl 子模型引用（实际渲染清理由 Stage.vue 处理）
      previewRuntime.wmdlSubModels.delete(id)
      this.models = this.models.filter((m) => m.id !== id)
      if (this.selectedId === id) {
        this.selectedId = this.models.length > 0 ? this.models[this.models.length - 1].id : null
      }
    },
    select(id: string): void {
      this.selectedId = id
    },
    move(fromIndex: number, toIndex: number): void {
      if (fromIndex === toIndex) return
      const models = this.models
      const [item] = models.splice(fromIndex, 1)
      models.splice(toIndex, 0, item)
    },
    toggleVisible(id: string): void {
      const model = this.models.find((m) => m.id === id)
      if (model) {
        model.visible = !model.visible
      }
    },
    setBackground(url: string | null): void {
      this.backgroundUrl = url
      if (url) {
        const filtered = this.bgHistory.filter((p) => p !== url)
        filtered.unshift(url)
        this.bgHistory = filtered.slice(0, 10)
      }
    },
    setBgTemplate(template: string): void {
      this.bgTemplate = template
    },
    setBgTransformTemplate(template: string): void {
      this.bgTransformTemplate = template
    },
    setStageTransformTemplate(template: string): void {
      this.stageTransformTemplate = template
    },
    setImageFigureTemplate(template: string): void {
      this.imageFigureTemplate = template
    },
    setImageTransformTemplate(template: string): void {
      this.imageTransformTemplate = template
    },
    /** 编辑器保存 figure/transform template 到当前选中 wmdl entry */
    setModelWmdlConfig(entryId: string, patch: Partial<Pick<WmdlConfig, 'figureTemplate' | 'transformTemplate'>>): void {
      const entry = this.models.find((m) => m.id === entryId)
      if (!entry?.wmdlConfig) return
      if (patch.figureTemplate !== undefined) entry.wmdlConfig.figureTemplate = patch.figureTemplate
      if (patch.transformTemplate !== undefined) entry.wmdlConfig.transformTemplate = patch.transformTemplate
    },
    async playMotion(modelId: string, group: string, index: number, name: string) {
      const entry = this.models.find((m) => m.id === modelId)
      if (entry?.kind === 'image') return

      const wmdlInfo = previewRuntime.wmdlSubModels.get(modelId)
      for (const subId of wmdlInfo?.subModelIds ?? []) {
        const model = previewRuntime.live2dModels.get(subId)
        if (model) {
          await model.internalModel.motionManager?.startMotion(group, index, MotionPriority.FORCE)
        }
      }

      this.setMotion(modelId, group, index, name)
    },

    async playExpression(modelId: string, index: number, name: string) {
      const entry = this.models.find((m) => m.id === modelId)
      if (entry?.kind === 'image') return

      const wmdlInfo = previewRuntime.wmdlSubModels.get(modelId)
      for (const subId of wmdlInfo?.subModelIds ?? []) {
        const model = previewRuntime.live2dModels.get(subId)
        if (model) {
          const mm = model.internalModel.motionManager as any
          await mm?.expressionManager?.setExpression(index)
        }
      }

      this.setExpression(modelId, index, name)
    },

    clearModel(modelId: string) {
      const entry = this.models.find((m) => m.id === modelId)
      if (entry) {
        entry.playing = { motion: null, expression: null }
      }
    },

    setMotion(modelId: string, group: string, index: number, name: string) {
      const model = this.models.find((m) => m.id === modelId)
      if (model) {
        model.playing.motion = { group, index, name }
      }
    },

    setExpression(modelId: string, index: number, name: string) {
      const model = this.models.find((m) => m.id === modelId)
      if (model) {
        model.playing.expression = { index, name }
      }
    },

    setTransformState(id: string | null, state: TransformState) {
      if (id == null)
        return;

      // 特殊容器
      if (id === SpecialId.StageMain) {
        this.stageState = state
        return
      }
      if (id === SpecialId.BgContainer) {
        this.bgState = state
        return
      }
      // 普通模型
      const model = this.models.find((m) => m.id === id)
      if (model) {
        model.state = state
      }
    },

    /** 记录当前选中模型的变换快照，默认名为时间戳 */
    recordTransformSnapshot(): TransformSnapshot | null {
      if (!this.selectedId) return null
      const state = this.getTransformState(this.selectedId)
      const snapshot: TransformSnapshot = {
        id: crypto.randomUUID(),
        name: formatSnapshotTimestamp(new Date()),
        x: state.x,
        y: state.y,
        scale: { x: state.scale.x, y: state.scale.y },
        rotation: state.rotation,
      }
      this.transformSnapshots.push(snapshot)
      return snapshot
    },

    /** 应用指定快照的变换到当前选中模型 */
    applyTransformSnapshot(id: string): boolean {
      const snap = this.transformSnapshots.find((s) => s.id === id)
      if (!snap || !this.selectedId) return false
      const current = this.getTransformState(this.selectedId)
      const newState: TransformState = {
        ...current,
        x: snap.x,
        y: snap.y,
        scale: { x: snap.scale.x, y: snap.scale.y },
        rotation: snap.rotation,
      }
      this.setTransformState(this.selectedId, newState)
      syncTransformToPixi(this.selectedId, newState)
      return true
    },

    /** 直接应用快照的原始数据（不做合并），用于预览 */
    applyTransformSnapshotRaw(snap: TransformSnapshot): void {
      if (!this.selectedId) return
      const current = this.getTransformState(this.selectedId)
      const newState: TransformState = {
        ...current,
        x: snap.x,
        y: snap.y,
        scale: { x: snap.scale.x, y: snap.scale.y },
        rotation: snap.rotation,
      }
      this.setTransformState(this.selectedId, newState)
      syncTransformToPixi(this.selectedId, newState)
    },

    /** 删除指定快照 */
    deleteTransformSnapshot(id: string): void {
      this.transformSnapshots = this.transformSnapshots.filter((s) => s.id !== id)
    },

    /** 重命名快照 */
    renameTransformSnapshot(id: string, name: string): void {
      const snap = this.transformSnapshots.find((s) => s.id === id)
      if (snap) snap.name = name
    },

    /** 缓存当前选中模型的变换（模态打开时调用） */
    setCachedTransform(): void {
      if (!this.selectedId) {
        this.cachedTransformBeforeModal = null
        return
      }
      const state = this.getTransformState(this.selectedId)
      this.cachedTransformBeforeModal = {
        ...state,
        scale: { x: state.scale.x, y: state.scale.y },
      }
    },

    /** 恢复缓存的变换（鼠标移出列表项时调用） */
    restoreCachedTransform(): void {
      if (!this.cachedTransformBeforeModal || !this.selectedId) return
      this.setTransformState(this.selectedId, this.cachedTransformBeforeModal)
      syncTransformToPixi(this.selectedId, this.cachedTransformBeforeModal)
    },

    /** 清除缓存 */
    clearCachedTransform(): void {
      this.cachedTransformBeforeModal = null
    },

    /**
     * 写入滤镜状态（仅运行时），并立即把字段同步到对应的 L2dwContainer。
     * patch 为部分字段，merge 到现有 state 上。
     */
    setFilterState(id: string | null, patch: Partial<FilterState>): void {
      if (id == null) return

      let target: FilterState
      if (id === SpecialId.StageMain) {
        target = { ...this.stageFilterState, ...patch }
        this.stageFilterState = target
      } else if (id === SpecialId.BgContainer) {
        target = { ...this.bgFilterState, ...patch }
        this.bgFilterState = target
      } else {
        const own = this.figureFilterStates[id]
        target = own
          ? { ...own, ...patch }
          : { ...DEFAULT_FILTER_STATE, ...patch }
        this.figureFilterStates[id] = target
      }
      syncFilterToContainer(id, target)
    },

    /** 把指定 id 的滤镜属性读回 store（用于选中切换时把容器当前值同步到 UI） */
    readFilterStateFromContainer(id: string | null): void {
      if (id == null) return
      const container = resolveFilterContainer(id)
      if (!container) return
      const next: FilterState = {
        ...DEFAULT_FILTER_STATE,
        l2dwAlphaFilter: container.l2dwAlphaFilter,
      }
      for (const key of FILTER_PROPERTY_KEYS) {
        ;(next as any)[key] = (container as any)[key]
      }
      if (id === SpecialId.StageMain) {
        this.stageFilterState = next
      } else if (id === SpecialId.BgContainer) {
        this.bgFilterState = next
      } else {
        this.figureFilterStates[id] = next
      }
    },

    /** 把指定 id 的 FilterState 重置回 DEFAULT_FILTER_STATE，并写回容器 */
    resetFilterState(id: string | null): void {
      if (id == null) return
      const fresh = { ...DEFAULT_FILTER_STATE }
      if (id === SpecialId.StageMain) {
        this.stageFilterState = fresh
      } else if (id === SpecialId.BgContainer) {
        this.bgFilterState = fresh
      } else {
        this.figureFilterStates[id] = fresh
      }
      syncFilterToContainer(id, fresh)
    },

    /**
     * 写入注视状态（仅运行时），并立即同步到该模型的全部子 Live2DModel。
     * 仅 live2d 立绘有意义；图片/背景/主场景传入时静默忽略。
     */
    setFocusState(id: string | null, patch: Partial<FocusState>): void {
      if (id == null) return
      const own = this.figureFocusStates[id]
      const target = own
        ? { ...own, ...patch }
        : { ...DEFAULT_FOCUS_STATE, ...patch }
      this.figureFocusStates[id] = target
      syncFocusToModels(id, target)
    },

    /** 把指定 id 的 FocusState 重置回默认，并写回模型 */
    resetFocusState(id: string | null): void {
      if (id == null) return
      this.figureFocusStates[id] = { ...DEFAULT_FOCUS_STATE }
      syncFocusToModels(id, this.figureFocusStates[id])
    },

    /**
     * 写入眨眼状态（仅运行时），并立即同步到该模型的全部子 Live2DModel。
     * 仅 live2d 立绘有意义；图片/背景/主场景传入时静默忽略。
     */
    setBlinkState(id: string | null, patch: Partial<BlinkState>): void {
      if (id == null) return
      const own = this.figureBlinkStates[id]
      const target = own
        ? { ...own, ...patch }
        : { ...DEFAULT_BLINK_STATE, ...patch }
      this.figureBlinkStates[id] = target
      syncBlinkToModels(id, target)
    },

    /** 把指定 id 的 BlinkState 重置回默认，并写回模型 */
    resetBlinkState(id: string | null): void {
      if (id == null) return
      this.figureBlinkStates[id] = { ...DEFAULT_BLINK_STATE }
      syncBlinkToModels(id, this.figureBlinkStates[id])
    },

    // ───────── 立绘组 CRUD ─────────

    /** 新建立绘组，返回新条目；name 默认为"立绘组 N" */
    addFigureGroup(name?: string): FigureGroupEntry {
      const id = makeFigureGroupId()
      const sameNameCount = this.figureGroups.filter((g) => g.name.startsWith('立绘组')).length
      const group: FigureGroupEntry = {
        id,
        name: name ?? `立绘组 ${sameNameCount + 1}`,
        x: 0,
        y: 0,
        targetIds: [],
        targetGroupIds: [],
        includeBackground: false,
        includeAllFigures: false,
        editAnchorOnly: false,
      }
      this.figureGroups.push(group)
      return group
    },

    /** 移除立绘组 */
    removeFigureGroup(id: string): void {
      // 同步清理其它立绘组对它的引用
      for (const g of this.figureGroups) {
        g.targetGroupIds = g.targetGroupIds.filter((gid) => gid !== id)
      }
      this.figureGroups = this.figureGroups.filter((g) => g.id !== id)
      if (this.selectedId === id) {
        this.selectedId = this.figureGroups.length > 0
          ? this.figureGroups[this.figureGroups.length - 1].id
          : null
      }
    },

    /** 更新立绘组的部分字段（patch 中可包含 name / x / y / targetIds / targetGroupIds / includeBackground / includeAllFigures） */
    updateFigureGroup(id: string, patch: Partial<Omit<FigureGroupEntry, 'id'>>): void {
      const group = this.figureGroups.find((g) => g.id === id)
      if (!group) return
      Object.assign(group, patch)
    },

    /**
     * 修改立绘组锚点坐标：把整组连同目标立绘（含可选背景）一起平移到新锚点。
     * 等价于 G 模式拖动后再 endTransform commit。
     * 当 group.editAnchorOnly=true 时，只更新锚点本身，不动目标与背景。
     */
    applyFigureGroupAnchor(groupId: string, axis: 'x' | 'y', value: number): void {
      const group = this.figureGroups.find((g) => g.id === groupId)
      if (!group) return
      const delta = value - group[axis]
      // 总是先把锚点数值更新到新值（groupContainer 会通过 watcher 跟随移动）
      this.updateFigureGroup(groupId, { [axis]: value })
      if (group.editAnchorOnly) return

      const ids: string[] = this.flattenFigureGroupTargets(groupId)
      if (group.includeBackground) ids.push(SpecialId.BgContainer)
      for (const id of ids) {
        if (isSpecialId(id)) {
          const current = this.getTransformState(id)
          const next: TransformState = { ...current, [axis]: current[axis] + delta }
          this.setTransformState(id, next)
          syncTransformToPixi(id, next)
          continue
        }
        const model = this.models.find((m) => m.id === id)
        if (!model) continue
        const next: TransformState = { ...model.state, [axis]: model.state[axis] + delta }
        model.state = next
        syncTransformToPixi(id, next)
      }
    },

    /** 切换立绘组里某个立绘目标（已存在则移除，不存在则追加） */
    toggleFigureGroupTarget(groupId: string, figureId: string): void {
      const group = this.figureGroups.find((g) => g.id === groupId)
      if (!group) return
      const idx = group.targetIds.indexOf(figureId)
      if (idx >= 0) group.targetIds.splice(idx, 1)
      else group.targetIds.push(figureId)
    },

    /** 切换立绘组里某个立绘组目标 */
    toggleFigureGroupNestedTarget(groupId: string, nestedGroupId: string): void {
      const group = this.figureGroups.find((g) => g.id === groupId)
      if (!group || nestedGroupId === groupId) return
      const idx = group.targetGroupIds.indexOf(nestedGroupId)
      if (idx >= 0) group.targetGroupIds.splice(idx, 1)
      else group.targetGroupIds.push(nestedGroupId)
    },

    /**
     * 清理立绘组中已不存在的目标。
     * 用于变换前后、复制指令前调用，避免空指针/无效引用。
     */
    cleanupInvalidFigureGroupTargets(groupId: string): void {
      const group = this.figureGroups.find((g) => g.id === groupId)
      if (!group) return
      const modelIds = new Set(this.models.map((m) => m.id))
      const groupIds = new Set(this.figureGroups.map((g) => g.id))
      group.targetIds = group.targetIds.filter((id) => modelIds.has(id))
      group.targetGroupIds = group.targetGroupIds.filter((gid) => gid !== groupId && groupIds.has(gid))
    },

    /**
     * 递归展平立绘组的所有目标立绘 ID（含嵌套立绘组）。
     * includeAllFigures=true 时直接返回当前所有立绘。
     */
    flattenFigureGroupTargets(groupId: string, visited: Set<string> = new Set()): string[] {
      if (visited.has(groupId)) return []
      visited.add(groupId)
      const group = this.figureGroups.find((g) => g.id === groupId)
      if (!group) return []

      if (group.includeAllFigures) {
        return this.models.map((m) => m.id)
      }

      const result: string[] = [...group.targetIds]
      for (const nestedId of group.targetGroupIds) {
        result.push(...this.flattenFigureGroupTargets(nestedId, visited))
      }
      return result
    },
  },
})

/** 生成快照默认名称：年年年年-月月-日日-时时分分秒秒 */
function formatSnapshotTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 把指定 id 对应模型的 TransformState 同步到 PIXI 容器。
 *
 * 与 ModelActionPanel 中 onTransformInput 的写入保持一致：
 * rotation 在 store 中以"度"存储，PIXI 期望"弧度"。
 * 普通模型容器是 L2dwContainer（含 alpha），特殊容器是普通 Container（无 alpha）。
 */
function syncTransformToPixi(id: string, state: TransformState): void {
  const container = isSpecialId(id)
    ? previewRuntime.specialContainers.get(id)
    : previewRuntime.modelWrappers.get(id)
  if (!container) return

  container.x = state.x
  container.y = state.y
  container.scale.x = state.scale.x
  container.scale.y = state.scale.y
  container.rotation = (state.rotation * Math.PI) / 180
}

/** 取 id 对应的容器：模型从 modelWrappers，特殊容器从 specialContainers。 */
function resolveFilterContainer(id: string): L2dwContainer | undefined {
  return isSpecialId(id)
    ? (previewRuntime.specialContainers.get(id) as L2dwContainer | undefined)
    : previewRuntime.modelWrappers.get(id)
}

/** 把 FilterState 字段写回对应 L2dwContainer；不存在的容器直接跳过。 */
function syncFilterToContainer(id: string, state: FilterState): void {
  const container = resolveFilterContainer(id)
  if (!container) return
  for (const key of FILTER_PROPERTY_KEYS) {
    ;(container as any)[key] = (state as any)[key]
  }
  container.l2dwAlphaFilter = state.l2dwAlphaFilter
}

/** 取指定模型的全部子 Live2DModel（wmdl 子模型），不存在则返回空数组。 */
function resolveSubLive2DModels(id: string): Live2DModel[] {
  const wmdlInfo = previewRuntime.wmdlSubModels.get(id)
  if (!wmdlInfo) return []
  return wmdlInfo.subModelIds
    .map((subId) => previewRuntime.live2dModels.get(subId))
    .filter((m): m is Live2DModel => !!m)
}

/** 把 FocusState 同步到子模型：enabled=false 时注视归零（眼睛居中）。 */
function syncFocusToModels(id: string, state: FocusState): void {
  const x = state.enabled ? state.x : 0
  const y = state.enabled ? state.y : 0
  const instant = state.enabled ? state.instant : true
  for (const model of resolveSubLive2DModels(id)) {
    model.internalModel.focusController.focus(x, y, instant)
  }
}

/** 把 BlinkState 同步到子模型：enabled=false 时回退库默认眨眼参数。 */
function syncBlinkToModels(id: string, state: BlinkState): void {
  const param = state.enabled
    ? {
        blinkInterval: state.blinkInterval,
        blinkIntervalRandom: state.blinkIntervalRandom,
        closingDuration: state.closingDuration,
        closedDuration: state.closedDuration,
        openingDuration: state.openingDuration,
      }
    : baseBlinkParam
  for (const model of resolveSubLive2DModels(id)) {
    model.internalModel.setBlinkParam(param)
  }
}