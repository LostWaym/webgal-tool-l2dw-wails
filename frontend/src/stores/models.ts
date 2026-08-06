import { defineStore } from 'pinia'
import { Live2DModel, MotionPriority } from 'pixi-live2d-display-webgal'
import { PickLive2DModel, PickWmdlFile, ReadWmdlFile, SaveWmdlFile, GetFileModifyTime } from '../../wailsjs/go/main/App'
import { pathDirname, pathRelative } from '../path_utils'
import { parseWmdlJson } from '../utils/wmdlUtils'
import { deriveNameFromPath } from '../utils/wmdlUtils'
import {
  DEFAULT_BG_TEMPLATE,
  DEFAULT_BG_TRANSFORM_TEMPLATE,
  DEFAULT_STAGE_TRANSFORM_TEMPLATE,
  DEFAULT_FIGURE_TEMPLATE,
  DEFAULT_TRANSFORM_TEMPLATE,
} from '../utils/consts'
import { SpecialId } from '../live2d/specialIds'
import type { WmdlModelItem, WmdlConfig } from './wmdlTypes'
import { previewRuntime } from '../utils/runtimeRegistry'

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
  scale: number
  rotation: number
  alpha: number
}

export const DEFAULT_TRANSFORM_STATE: TransformState = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  alpha: 1,
}

export interface ModelEntry {
  id: string
  name: string
  /**
   * 模型描述 json 的**绝对路径**。
   * Wails 的 `PickLive2DModel` 返回的就是 OS 给出的绝对路径，
   * 直接拿去做 `/abs_files/<encoded>` 的资源访问。
   */
  jsonPath: string
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

export const useModelStore = defineStore('models', {
  state: () => ({
    models: [] as ModelEntry[],
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
  }),
  getters: {
    selectedModel(state): ModelEntry | null {
      if (!state.selectedId) return null
      return state.models.find((m) => m.id === state.selectedId) ?? null
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
        this.models.push(entry)
      }
      return entry
    },
    async loadWmdl(): Promise<ModelEntry | null> {
      const filePath = await PickWmdlFile()
      if (!filePath) return null

      const entry = await this._loadWmdlFromFile(filePath)
      if (entry) {
        this.models.push(entry)
      }
      return entry
    },
    async _loadWmdlFromFile(filePath: string): Promise<ModelEntry | null> {
      const content = await ReadWmdlFile(filePath)
      const { config } = await parseWmdlJson(content, filePath)

      const mainModel = config.models[0]
      return {
        id: crypto.randomUUID(),
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
    /** 编辑器保存 figure/transform template 到当前选中 wmdl entry */
    setModelWmdlConfig(entryId: string, patch: Partial<Pick<WmdlConfig, 'figureTemplate' | 'transformTemplate'>>): void {
      const entry = this.models.find((m) => m.id === entryId)
      if (!entry?.wmdlConfig) return
      if (patch.figureTemplate !== undefined) entry.wmdlConfig.figureTemplate = patch.figureTemplate
      if (patch.transformTemplate !== undefined) entry.wmdlConfig.transformTemplate = patch.transformTemplate
    },
    async playMotion(modelId: string, group: string, index: number, name: string) {
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
      const model = this.models.find((m) => m.id === modelId)
      if (model) {
        model.playing = { motion: null, expression: null }
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
  },
})