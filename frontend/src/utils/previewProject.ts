import { ReadTextFile, WriteTextFile, PickPreviewProjectFile, SavePreviewProjectFileDialog, MissingPreviewProjectFiles } from '../../wailsjs/go/main/App'
import { choosePath } from './fileDialog'
import { pathCombine, pathDirname, pathRelative } from '../path_utils'
import { buildInMemoryWmdlConfig, buildModelItem, parseWmdlJson } from './wmdlUtils'
import { useModelStore } from '../stores/previewStore'
import type { ModelEntry, FigureGroupEntry, TransformSnapshot, TransformState, FilterState, FocusState, BlinkState } from '../stores/previewStore'

type Store = ReturnType<typeof useModelStore>
type ProjectModel = Pick<ModelEntry, 'id' | 'name' | 'kind' | 'visible' | 'playing' | 'state' | 'ignoreFigureGroupSelect'> & {
  source: string
  subModels: Array<{ path: string; offsetX: number; offsetY: number }>
  config?: { figureTemplate: string; transformTemplate: string; bounds?: [number, number, number, number] }
}

export interface PreviewProject {
  format: 'w2proj'
  version: 1
  models: ProjectModel[]
  figureGroups: FigureGroupEntry[]
  background: { path: string | null; state: TransformState; filter: FilterState; template: string; transformTemplate: string }
  stage: { state: TransformState; filter: FilterState; transformTemplate: string }
  snapshots: TransformSnapshot[]
  imageTemplates: { figure: string; transform: string }
  filters: Record<string, FilterState>
  focus: Record<string, FocusState>
  blink: Record<string, BlinkState>
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }
const relative = (base: string, path: string) => path ? pathRelative(base, path) : ''
const absolute = (base: string, path: string) => path ? pathCombine(base, path) : ''

export async function savePreviewProject(store: Store): Promise<boolean> {
  let path = await choosePath(() => SavePreviewProjectFileDialog())
  if (!path) return false
  if (!/\.w2proj$/i.test(path)) {
    path += '.w2proj'
    const missing = await MissingPreviewProjectFiles([path])
    if (!missing?.length && !window.confirm(`文件已存在，是否覆盖？\n${path}`)) return false
  }
  const base = pathDirname(path)
  const project: PreviewProject = {
    format: 'w2proj', version: 1,
    models: store.models.map(m => ({
      id: m.id, name: m.name, kind: m.kind, visible: m.visible, playing: copy(m.playing), state: copy(m.state),
      ignoreFigureGroupSelect: m.ignoreFigureGroupSelect,
      source: relative(base, m.kind === 'image' ? m.imageUrl || '' : m.wmdlConfig?.wmdlFilePath || m.jsonPath),
      subModels: m.wmdlModels.map(item => ({ path: relative(base, item.jsonAbsPath), offsetX: item.offsetX, offsetY: item.offsetY })),
      config: m.wmdlConfig ? { figureTemplate: m.wmdlConfig.figureTemplate, transformTemplate: m.wmdlConfig.transformTemplate, bounds: copy(m.wmdlConfig.bounds ?? m.wmdlConfig.live2dBounds) } : undefined,
    })),
    figureGroups: copy(store.figureGroups),
    background: { path: store.backgroundUrl ? relative(base, store.backgroundUrl) : null, state: copy(store.bgState), filter: copy(store.bgFilterState), template: store.bgTemplate, transformTemplate: store.bgTransformTemplate },
    stage: { state: copy(store.stageState), filter: copy(store.stageFilterState), transformTemplate: store.stageTransformTemplate },
    snapshots: copy(store.transformSnapshots),
    imageTemplates: { figure: store.imageFigureTemplate, transform: store.imageTransformTemplate },
    filters: copy(store.figureFilterStates), focus: copy(store.figureFocusStates), blink: copy(store.figureBlinkStates),
  }
  await WriteTextFile(path, JSON.stringify(project, null, 2))
  return true
}

function validate(raw: any): asserts raw is PreviewProject {
  const transform = (v: any) => v && [v.x, v.y, v.rotation, v.scale?.x, v.scale?.y].every(Number.isFinite)
  const record = (v: any) => v && typeof v === 'object' && !Array.isArray(v)
  const numericRecord = (v: any) => record(v) && Object.values(v).every(Number.isFinite)
  if (!record(raw) || raw.format !== 'w2proj' || raw.version !== 1 || !Array.isArray(raw.models) || !Array.isArray(raw.figureGroups) || !Array.isArray(raw.snapshots) || !record(raw.background) || !record(raw.stage) || !record(raw.imageTemplates) || !record(raw.filters) || !record(raw.focus) || !record(raw.blink)) throw new Error('项目格式无效或版本不受支持')
  if (!transform(raw.background.state) || !transform(raw.stage.state) || !numericRecord(raw.background.filter) || !numericRecord(raw.stage.filter) || (raw.background.path !== null && typeof raw.background.path !== 'string') || [raw.background.template, raw.background.transformTemplate, raw.stage.transformTemplate, raw.imageTemplates.figure, raw.imageTemplates.transform].some(v => typeof v !== 'string') || Object.values(raw.filters).some(v => !numericRecord(v))) throw new Error('项目场景数据无效')
  const ids = new Set<string>()
  for (const m of raw.models) {
    if (!record(m) || typeof m.id !== 'string' || !m.id || ids.has(m.id) || typeof m.name !== 'string' || !['live2d', 'image'].includes(m.kind) || typeof m.source !== 'string' || typeof m.visible !== 'boolean' || !transform(m.state) || !record(m.playing) || (m.playing.motion !== null && (!record(m.playing.motion) || typeof m.playing.motion.group !== 'string' || !Number.isInteger(m.playing.motion.index) || typeof m.playing.motion.name !== 'string')) || (m.playing.expression !== null && (!record(m.playing.expression) || !Number.isInteger(m.playing.expression.index) || typeof m.playing.expression.name !== 'string')) || !Array.isArray(m.subModels) || m.subModels.some((s: any) => !record(s) || typeof s.path !== 'string' || !Number.isFinite(s.offsetX) || !Number.isFinite(s.offsetY)) || (m.config !== undefined && (!record(m.config) || typeof m.config.figureTemplate !== 'string' || typeof m.config.transformTemplate !== 'string' || (m.config.bounds !== undefined && (!Array.isArray(m.config.bounds) || m.config.bounds.length !== 4 || !m.config.bounds.every(Number.isFinite)))))) throw new Error('项目立绘数据无效')
    ids.add(m.id)
  }
  for (const g of raw.figureGroups) {
    if (!record(g) || typeof g.id !== 'string' || !g.id.startsWith('group:') || ids.has(g.id) || typeof g.name !== 'string' || !Number.isFinite(g.x) || !Number.isFinite(g.y) || !Array.isArray(g.targetIds) || !Array.isArray(g.targetGroupIds) || [...g.targetIds, ...g.targetGroupIds].some((id: any) => typeof id !== 'string') || [g.includeBackground, g.includeAllFigures, g.includeStageMainCmdCopy, g.editAnchorOnly].some(v => typeof v !== 'boolean')) throw new Error('项目立绘组数据无效')
    ids.add(g.id)
  }
  if (raw.snapshots.some((s: any) => !record(s) || typeof s.id !== 'string' || typeof s.name !== 'string' || !transform(s))) throw new Error('项目快照数据无效')
}

export async function choosePreviewProject(): Promise<{ path: string; project: PreviewProject; missing: string[] } | null> {
  const path = await choosePath(() => PickPreviewProjectFile())
  if (!path) return null
  const project: unknown = JSON.parse(await ReadTextFile(path))
  validate(project)
  const base = pathDirname(path)
  const paths = new Set<string>()
  if (project.background.path) paths.add(absolute(base, project.background.path))
  for (const m of project.models) {
    if (m.source) paths.add(absolute(base, m.source))
    for (const sub of m.subModels) if (sub.path) paths.add(absolute(base, sub.path))
  }
  // Model descriptors reference additional assets, including textures, motions and expressions.
  for (const model of project.models) {
    const descriptors = model.subModels.map(s => absolute(base, s.path))
    const source = absolute(base, model.source)
    if (model.kind === 'live2d' && /\.wmdl$/i.test(source)) {
      try {
        const config = (await parseWmdlJson(await ReadTextFile(source), source)).config
        for (const sub of config.models) { descriptors.push(sub.jsonAbsPath); paths.add(sub.jsonAbsPath) }
      } catch { /* The source itself is checked below. */ }
    }
    for (const descriptor of descriptors) {
      try {
        const data = JSON.parse(await ReadTextFile(descriptor))
        const refs = data.FileReferences ?? { model: data.model, textures: data.textures, physics: data.physics, pose: data.pose, motions: data.motions, expressions: data.expressions }
        const collect = (value: any) => {
          if (typeof value === 'string' && /\.(moc3?|png|jpe?g|webp|json|mtn|wav|mp3|ogg)$/i.test(value)) paths.add(absolute(pathDirname(descriptor), value))
          else if (Array.isArray(value)) value.forEach(collect)
          else if (recordValue(value)) Object.values(value).forEach(collect)
        }
        collect(refs)
      } catch { /* Missing or invalid descriptors are reported when loading. */ }
    }
  }
  const missing = await MissingPreviewProjectFiles([...paths])
  return { path, project, missing: missing || [] }
}

function recordValue(value: any): boolean { return !!value && typeof value === 'object' }

export async function applyPreviewProject(store: Store, project: PreviewProject, path: string): Promise<void> {
  const base = pathDirname(path)
  const models: ModelEntry[] = []
  for (const saved of project.models) {
    const source = absolute(base, saved.source)
    let config
    if (saved.kind === 'live2d') {
      try {
        config = /\.wmdl$/i.test(source) ? (await parseWmdlJson(await ReadTextFile(source), source)).config : await buildInMemoryWmdlConfig(source)
      } catch {
        const items = await Promise.all(saved.subModels.map(async s => {
          const item = await buildModelItem(absolute(base, s.path), source)
          if (item) { item.offsetX = s.offsetX; item.offsetY = s.offsetY }
          return item
        }))
        config = { name: saved.name, figureTemplate: '', transformTemplate: '', live2dBounds: [0, 0, 0, 0] as [number, number, number, number], models: items.filter((item): item is NonNullable<typeof item> => !!item), wmdlFilePath: source }
      }
      if (saved.config) Object.assign(config, saved.config)
    }
    models.push({ id: saved.id, name: saved.name, kind: saved.kind, jsonPath: config?.models[0]?.jsonAbsPath || '', imageUrl: saved.kind === 'image' ? source : undefined, visible: saved.visible, playing: copy(saved.playing), state: copy(saved.state), wmdlModels: config?.models || [], wmdlConfig: config, isMoc3: config?.models[0]?.isMoc3 || false, ignoreFigureGroupSelect: saved.ignoreFigureGroupSelect })
  }
  store.$reset()
  store.$patch({ models, figureGroups: copy(project.figureGroups), backgroundUrl: project.background.path ? absolute(base, project.background.path) : null, bgState: copy(project.background.state), bgFilterState: copy(project.background.filter), bgTemplate: project.background.template, bgTransformTemplate: project.background.transformTemplate, stageState: copy(project.stage.state), stageFilterState: copy(project.stage.filter), stageTransformTemplate: project.stage.transformTemplate, transformSnapshots: copy(project.snapshots), imageFigureTemplate: project.imageTemplates.figure, imageTransformTemplate: project.imageTemplates.transform, figureFilterStates: copy(project.filters), figureFocusStates: copy(project.focus), figureBlinkStates: copy(project.blink) })
}
