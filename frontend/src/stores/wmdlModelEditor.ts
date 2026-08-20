import { defineStore } from 'pinia'
import {
  PickLive2DModel,
  ListMotionAndExpressionFiles,
  SaveModelJsonFile,
  SaveModelJsonFileDialog,
} from '../../wailsjs/go/main/App'
import { pathDirname, pathRelative, pathBasename, pathCombine } from '../path_utils'
import {
  readMotionsAndExpressionsFromJson,
  listParameters,
  listParts,
  writeParameter,
  writePartOpacity,
} from '../live2d/coreAdapter'
import type { WmdlConfig, WmdlModelItem, InitParamEntry } from './wmdlTypes'

/** Editor-specific: output of `scanDirectory`. */
export interface ScannedEntry {
  kind: 'motion' | 'expression'
  name: string
  absPath: string
  relPath: string
  subFolders: string[]
}
export type { WmdlConfig, WmdlModelItem, InitParamEntry }
import { deriveNameFromFile, buildModelItem, configToJson, parseWmdlJson, sortByName, deepClone, detectModelTypeFromJson, readRawJsonObject, toFileUrl, deriveNameFromPath } from '../utils/wmdlUtils'
export { deriveNameFromFile }

export const useWmdlModelEditorStore = defineStore('wmdlModelEditor', {
  state: (): { currentWmdl: WmdlConfig; selectedModelId: string | null; dynamicTextureWatch: boolean } => ({
    currentWmdl: {
      name: '',
      figureTemplate: '',
      transformTemplate: '',
      live2dBounds: [0, 0, 0, 0],
      models: [],
      wmdlFilePath: undefined,
    },
    selectedModelId: null,
    dynamicTextureWatch: false,
  }),

  getters: {
    selectedModel(state): WmdlModelItem | null {
      if (!state.selectedModelId) return null
      return state.currentWmdl.models.find((m) => m.id === state.selectedModelId) ?? null
    },
  },

  actions: {
    /** Add a new model by prompting the user to pick a file. */
    async addModel(): Promise<WmdlModelItem | null> {
      const jsonPath = await PickLive2DModel()
      if (!jsonPath) return null

      const id = crypto.randomUUID()

      const base = this.currentWmdl.wmdlFilePath ? pathDirname(this.currentWmdl.wmdlFilePath) : ''
      const modelRelativePath = pathRelative(base, jsonPath)
      const name = deriveNameFromPath(jsonPath)

      const rawJsonObject = await readRawJsonObject(jsonPath)
      const isMoc3 = detectModelTypeFromJson(rawJsonObject)

      const item: WmdlModelItem = {
        id,
        name,
        modelRelativePath,
        jsonAbsPath: jsonPath,
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
      this.currentWmdl.models.push(item)
      this.selectedModelId = id
      return item
    },

    /** Remove a model by id. */
    async removeModel(id: string): Promise<void> {
      this.currentWmdl.models = this.currentWmdl.models.filter((m) => m.id !== id)
      if (this.selectedModelId === id) {
        this.selectedModelId =
          this.currentWmdl.models.length > 0
            ? this.currentWmdl.models[this.currentWmdl.models.length - 1].id
            : null
      }
    },

    /** Select a model by id. */
    selectModel(id: string | null): void {
      this.selectedModelId = id
    },

    /** 设置动态更新纹理开关；具体启停逻辑由 EditStage 中的 watcher 监听该字段变化来驱动。 */
    setDynamicTextureWatch(enabled: boolean): void {
      this.dynamicTextureWatch = enabled
    },

    /** Toggle a model's runtime visibility flag. Not persisted to the wmdl file. */
    toggleVisible(id: string): void {
      const model = this.currentWmdl.models.find((m) => m.id === id)
      if (model) {
        model.state.visible = !model.state.visible
      }
    },

    /** Serialize currentWmdl to external wmdl JSON format. */
    toJson(): string {
      return configToJson(this.currentWmdl)
    },

    /** Parse external wmdl JSON into currentWmdl and load all model directories. */
    async fromJson(json: string, filePath: string): Promise<void> {
      const { config } = await parseWmdlJson(json, filePath)
      this.currentWmdl = config
      this.selectedModelId = config.models.length > 0 ? config.models[0].id : null
    },

    /** Update currentWmdl fields directly (for wmdl panel editing). */
    updateConfig(patch: Partial<Pick<WmdlConfig, 'name' | 'figureTemplate' | 'transformTemplate' | 'live2dBounds'>>): void {
      Object.assign(this.currentWmdl, patch)
    },

    /** Update a single model's offset. */
    updateModelOffset(id: string, offsetX: number, offsetY: number): void {
      const model = this.currentWmdl.models.find((m) => m.id === id)
      if (model) {
        model.offsetX = offsetX
        model.offsetY = offsetY
      }
    },

    /** Update a single model's path by picking a new file. */
    async changeModelPath(id: string): Promise<void> {
      const jsonPath = await PickLive2DModel()
      if (!jsonPath) return

      const model = this.currentWmdl.models.find((m) => m.id === id)
      if (!model) return

      const base = this.currentWmdl.wmdlFilePath ? pathDirname(this.currentWmdl.wmdlFilePath) : ''
      const modelRelativePath = pathRelative(base, jsonPath)
      const name = deriveNameFromPath(jsonPath)

      model.modelRelativePath = modelRelativePath
      model.jsonAbsPath = jsonPath
      model.name = name

      model.motions = []
      model.expressions = []
      model.initParams = []
      model.initOpacities = []
      model.rawJsonObject = await readRawJsonObject(jsonPath)
      await this.populateMotionsExps(id)
      await this.populateInitValues(id)
    },

    /** Reset to a blank wmdl config. */
    reset(): void {
      this.currentWmdl = {
        name: '',
        figureTemplate: '',
        transformTemplate: '',
        live2dBounds: [0, 0, 0, 0],
        models: [],
        wmdlFilePath: undefined,
      }
      this.selectedModelId = null
    },

    /**
     * Populate cached motions / expressions for a model by reading its model
     * descriptor json (model.json / model3.json) via /abs_files/... fetch.
     */
    async populateMotionsExps(modelId: string): Promise<void> {
      const item = this.currentWmdl.models.find((m) => m.id === modelId)
      if (!item || !item.jsonAbsPath) return
      const { motions, expressions } = await readMotionsAndExpressionsFromJson(
        item.jsonAbsPath,
      )
      item.motions = sortByName(motions)
      item.expressions = sortByName(expressions)
    },

    /**
     * Populate initParams / initOpacities from coreModel snapshot.
     */
    async populateInitValues(modelId: string): Promise<void> {
      const item = this.currentWmdl.models.find((m) => m.id === modelId)
      if (!item) return
      const params = listParameters(modelId)
      const parts = listParts(modelId)
      const oldParamMap = new Map(item.initParams.map((p) => [p.id, p]))
      const oldPartMap = new Map(item.initOpacities.map((p) => [p.id, p]))

      const isMoc3 = item.isMoc3
      let jsonInitParamMap = new Map<string, number>()
      let jsonInitOpacityMap = new Map<string, number>()
      if (!isMoc3 && item.rawJsonObject && typeof item.rawJsonObject === 'object') {
        const jsonParams = Array.isArray(item.rawJsonObject.init_params)
          ? item.rawJsonObject.init_params
          : []
        const jsonOpacities = Array.isArray(item.rawJsonObject.init_opacities)
          ? item.rawJsonObject.init_opacities
          : []
        jsonInitParamMap = new Map(
          jsonParams
            .filter((p: any) => p && typeof p.id === 'string')
            .map((p: any) => [p.id, Number(p.value) as number]),
        )
        jsonInitOpacityMap = new Map(
          jsonOpacities
            .filter((p: any) => p && typeof p.id === 'string')
            .map((p: any) => [p.id, Number(p.value) as number]),
        )
      }

      item.initParams = params.map((p) => {
        const old = oldParamMap.get(p.id)
        const jsonVal = jsonInitParamMap.get(p.id)
        const override =
          old?.override !== undefined
            ? old.override
            : jsonVal !== undefined
              ? jsonVal
              : undefined
        const entry: InitParamEntry = {
          id: p.id,
          value: p.value,
          min: p.min,
          max: p.max,
        }
        if (override !== undefined) {
          entry.override = override
          writeParameter(item.id, p.id, override)
        }
        return entry
      })
      item.initOpacities = parts.map((p) => {
        const old = oldPartMap.get(p.id)
        const jsonVal = jsonInitOpacityMap.get(p.id)
        const override =
          old?.override !== undefined
            ? old.override
            : jsonVal !== undefined
              ? jsonVal
              : undefined
        const entry: InitParamEntry = { id: p.id, value: p.value }
        if (override !== undefined) {
          entry.override = override
          writePartOpacity(item.id, p.id, override)
        }
        return entry
      })
    },

    /** Build the asset URL for a model (used by EditStage to load via /abs_files/). */
    getModelAssetUrl(model: WmdlModelItem): string {
      return toFileUrl(model.jsonAbsPath)
    },

    /**
     * 给所有已加载模型写入同一参数值。命中的模型会同步写入 override 与
     * coreModel；未命中该参数 id 的模型跳过。
     */
    applyParamToAll(paramId: string, value: number): void {
      for (const m of this.currentWmdl.models) {
        const entry = m.initParams.find((p) => p.id === paramId)
        if (!entry) continue
        writeParameter(m.id, paramId, value)
        entry.override = value
      }
    },

    /**
     * 重置所有已加载模型上同一参数的覆写。命中的模型会写回 value 并移除
     * override；未命中或本来就没有 override 的模型跳过。
     */
    resetParamForAll(paramId: string): void {
      for (const m of this.currentWmdl.models) {
        const entry = m.initParams.find((p) => p.id === paramId)
        if (!entry) continue
        writeParameter(m.id, paramId, entry.value)
        delete entry.override
      }
    },

    // ─── Motion / Expression entry edits (in-memory only) ────────────────────

    /** Append a single motion entry to the selected model. */
    addMotion(name: string, path: string): void {
      const m = this.selectedModel
      if (!m) return
      const modelDir = pathDirname(m.jsonAbsPath)
      const relPath = pathRelative(modelDir, path)
      if (m.motions.some((it) => it.path === relPath)) return
      m.motions = sortByName([...m.motions, { name, path: relPath }])
    },

    /** Append a single expression entry to the selected model. */
    addExpression(name: string, path: string): void {
      const m = this.selectedModel
      if (!m) return
      const modelDir = pathDirname(m.jsonAbsPath)
      const relPath = pathRelative(modelDir, path)
      if (m.expressions.some((it) => it.path === relPath)) return
      m.expressions = sortByName([...m.expressions, { name, path: relPath }])
    },

    /** Append a batch of motion entries to the selected model, deduplicated by path. */
    addMotionsBatch(items: Array<{ name: string; path: string }>): void {
      const m = this.selectedModel
      if (!m) return
      const modelDir = pathDirname(m.jsonAbsPath)
      const existing = new Set(m.motions.map((it) => it.path))
      const next = [...m.motions]
      for (const it of items) {
        const relPath = pathRelative(modelDir, it.path)
        if (existing.has(relPath)) continue
        existing.add(relPath)
        next.push({ name: it.name, path: relPath })
      }
      m.motions = sortByName(next)
    },

    /** Append a batch of expression entries to the selected model, deduplicated by path. */
    addExpressionsBatch(items: Array<{ name: string; path: string }>): void {
      const m = this.selectedModel
      if (!m) return
      const modelDir = pathDirname(m.jsonAbsPath)
      const existing = new Set(m.expressions.map((it) => it.path))
      const next = [...m.expressions]
      for (const it of items) {
        const relPath = pathRelative(modelDir, it.path)
        if (existing.has(relPath)) continue
        existing.add(relPath)
        next.push({ name: it.name, path: relPath })
      }
      m.expressions = sortByName(next)
    },

    /** Clear all motions on the selected model. */
    clearMotions(): void {
      const m = this.selectedModel
      if (!m) return
      m.motions = []
    },

    /** Clear all expressions on the selected model. */
    clearExpressions(): void {
      const m = this.selectedModel
      if (!m) return
      m.expressions = []
    },

    /**
     * 把当前选中模型的 motions 数组整体覆盖到其余所有模型。
     */
    syncMotionsToOthers(): void {
      const src = this.selectedModel
      if (!src) return
      const items = src.motions
      const srcBase = pathDirname(src.jsonAbsPath)
      for (const target of this.currentWmdl.models) {
        if (target.id === src.id) continue
        const targetBase = pathDirname(target.jsonAbsPath)
        target.motions = items.map((it) => ({
          name: it.name,
          path: pathRelative(targetBase, pathCombine(srcBase, it.path)),
        }))
      }
    },

    /** 同 syncMotionsToOthers，作用于 expressions 数组。 */
    syncExpressionsToOthers(): void {
      const src = this.selectedModel
      if (!src) return
      const items = src.expressions
      const srcBase = pathDirname(src.jsonAbsPath)
      for (const target of this.currentWmdl.models) {
        if (target.id === src.id) continue
        const targetBase = pathDirname(target.jsonAbsPath)
        target.expressions = items.map((it) => ({
          name: it.name,
          path: pathRelative(targetBase, pathCombine(srcBase, it.path)),
        }))
      }
    },

    /** Remove a single motion. Matches both `name` and `path` to avoid deleting a same-named entry. */
    removeMotion(name: string, path: string): void {
      const m = this.selectedModel
      if (!m) return
      m.motions = m.motions.filter((it) => !(it.name === name && it.path === path))
    },

    /** Remove a single expression. Matches both `name` and `path` to avoid deleting a same-named entry. */
    removeExpression(name: string, path: string): void {
      const m = this.selectedModel
      if (!m) return
      m.expressions = m.expressions.filter((it) => !(it.name === name && it.path === path))
    },

    /**
     * Scan a directory for motion and expression files via the Go backend.
     */
    async scanDirectory(dir: string, modelDir: string, recursive = true): Promise<ScannedEntry[]> {
      if (!dir) return []
      const list = (await ListMotionAndExpressionFiles(dir, recursive)) as any[]
      return list.map((it) => {
        const absPath = String(it.absPath ?? '')
        const subFolders = Array.isArray(it.subFolders)
          ? (it.subFolders as any[]).map((s) => String(s)).filter((s) => s.length > 0)
          : []
        return {
          kind: String(it.kind) as 'motion' | 'expression',
          name: String(it.name ?? ''),
          absPath,
          relPath: absPath ? pathRelative(modelDir, absPath) : '',
          subFolders,
        }
      })
    },

    /**
     * 把指定模型的 motions / expressions / initParams / initOpacities 写回到
     * rawJsonObject 的对应位置。
     */
    serializeModelToJson(item: WmdlModelItem): any {
      if (!item.rawJsonObject || typeof item.rawJsonObject !== 'object') {
        throw new Error(`serializeModelToJson: ${item.name} 缺少 rawJsonObject，请重新加载模型`)
      }
      const out = deepClone(item.rawJsonObject)
      const isMoc3 = item.isMoc3

      if (isMoc3) {
        if (!out.FileReferences || typeof out.FileReferences !== 'object') {
          out.FileReferences = {}
        }
        const motionsObj: Record<string, Array<{ File: string }>> = {}
        for (const m of item.motions) {
          motionsObj[m.name] = [{ File: m.path }]
        }
        out.FileReferences.Motions = motionsObj
        out.FileReferences.Expressions = item.expressions.map((e) => ({
          Name: e.name,
          File: e.path,
        }))
      } else {
        const motionsObj: Record<string, Array<{ file: string }>> = {}
        for (const m of item.motions) {
          motionsObj[m.name] = [{ file: m.path }]
        }
        out.motions = motionsObj
        out.expressions = item.expressions.map((e) => ({
          name: e.name,
          file: e.path,
        }))
        out.init_params = item.initParams
          .filter((p) => p.override !== undefined)
          .map((p) => ({ id: p.id, value: p.override as number }))
        out.init_opacities = item.initOpacities
          .filter((p) => p.override !== undefined)
          .map((p) => ({ id: p.id, value: p.override as number }))
      }
      return out
    },

    /** Save the specified model's descriptor json to its jsonAbsPath. */
    async saveModelJson(modelId: string): Promise<{ path: string } | null> {
      const item = this.currentWmdl.models.find((m) => m.id === modelId)
      if (!item) return null
      const obj = this.serializeModelToJson(item)
      const content = JSON.stringify(obj, null, 2)
      await SaveModelJsonFile(item.jsonAbsPath, content)
      return { path: item.jsonAbsPath }
    },

    /** Save descriptor jsons for every model. Returns the list of saved paths. */
    async saveAllModelJsons(): Promise<string[]> {
      const saved: string[] = []
      for (const item of this.currentWmdl.models) {
        const res = await this.saveModelJson(item.id)
        if (res) saved.push(res.path)
      }
      return saved
    },

    /**
     * Prompt for a destination path and save the specified model's descriptor json there.
     */
    async saveModelJsonAs(modelId: string): Promise<{ path: string } | null> {
      const item = this.currentWmdl.models.find((m) => m.id === modelId)
      if (!item) return null
      const newPath = await SaveModelJsonFileDialog(item.jsonAbsPath)
      if (!newPath) return null
      const obj = this.serializeModelToJson(item)
      const content = JSON.stringify(obj, null, 2)
      await SaveModelJsonFile(newPath, content)
      item.jsonAbsPath = newPath
      item.rawJsonObject = obj
      const base = this.currentWmdl.wmdlFilePath ? pathDirname(this.currentWmdl.wmdlFilePath) : ''
      item.modelRelativePath = pathRelative(base, newPath)
      return { path: newPath }
    },
  },
})