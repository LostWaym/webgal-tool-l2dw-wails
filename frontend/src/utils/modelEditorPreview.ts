import { Cubism2ExpressionManager, Cubism4ExpressionManager, MotionPriority, type Live2DModel } from 'pixi-live2d-display-webgal'
import { pathCombine, pathDirname, toFileUrl } from '../path_utils'
import { restoreModelParameters, writePartOpacity } from '../live2d/coreAdapter'
import type { WmdlModelItem } from '../stores/wmdlTypes'

export interface ModelEditorPreviewRequest {
  modelId: string
  kind: 'motion' | 'expression'
  name?: string
  path?: string
}

const group = '__l2dw_editor_preview__'
const sequences = new WeakMap<Live2DModel, number>()

export interface ModelEditorPreviewTarget {
  model: Live2DModel
  item: WmdlModelItem
}

function resetModelEntry(model: Live2DModel, item: WmdlModelItem, kind: ModelEditorPreviewRequest['kind']) {
  const manager = model.internalModel.motionManager as any
  if (kind === 'motion') manager.stopAllMotions()
  else if (manager.expressionManager) {
    const expressions = manager.expressionManager
    expressions.reserveExpressionIndex = -1
    expressions.stopAllExpressions()
    expressions.currentExpression = expressions.defaultExpression
  }
  restoreModelParameters({ model, values: item.initParams.map(p => ({ id: p.id, value: p.override ?? p.value })) })
  for (const p of item.initOpacities) writePartOpacity(item.id, p.id, p.override ?? p.value)
}

async function prepareModelEntry(model: Live2DModel, item: WmdlModelItem, kind: ModelEditorPreviewRequest['kind'], path: string) {
  const manager = model.internalModel.motionManager as any
  const url = toFileUrl(pathCombine(pathDirname(item.jsonAbsPath), path))
  const definition = { file: url, File: url, name: path, Name: path }
  if (kind === 'motion') {
    manager.definitions[group] ??= []
    manager.motionGroups[group] ??= []
    let index = manager.definitions[group].findIndex((d: any) => d.file === url)
    if (index < 0) index = manager.definitions[group].push(definition) - 1
    const loaded = await manager.loadMotion(group, index)
    if (!loaded) throw new Error('动作文件无法加载')
    return async () => {
      manager.stopAllMotions()
      if (!await manager.startMotion(group, index, MotionPriority.FORCE)) throw new Error('动作文件无法播放')
    }
  }
  if (!manager.expressionManager) {
    manager.expressionManager = item.isMoc3
      ? new Cubism4ExpressionManager(manager.settings)
      : new Cubism2ExpressionManager(manager.settings)
  }
  const expressions = manager.expressionManager
  let index = expressions.definitions.findIndex((d: any) => (d.file ?? d.File) === url)
  if (index < 0) index = expressions.definitions.push(definition) - 1
  const loaded = await expressions.loadExpression(index)
  if (!loaded) throw new Error('表情文件无法加载')
  return async () => {
    const played = await expressions.setExpression(index)
    if (!played && expressions.currentExpression !== loaded) throw new Error('表情文件无法播放')
  }
}

export async function previewModelEntries(
  targets: ModelEditorPreviewTarget[],
  request: ModelEditorPreviewRequest,
  onError: (item: WmdlModelItem, error: unknown) => void,
) {
  // 所有已加载模型都更新序号，缺项模型也不能被上次的慢请求重新启动。
  const pending = targets.map(({ model, item }) => {
    const sequence = (sequences.get(model) ?? 0) + 1
    sequences.set(model, sequence)
    const isCurrent = () => sequences.get(model) === sequence && !model.destroyed
    return { model, item, isCurrent }
  })
  const prepared = await Promise.all(pending.map(async ({ model, item, isCurrent }) => {
    if (!isCurrent()) return
    try {
      if (!request.name && !request.path) {
        resetModelEntry(model, item, request.kind)
        return
      }
      const entries = request.kind === 'motion' ? item.motions : item.expressions
      const path = item.id === request.modelId && request.path
        ? request.path
        : entries.find(entry => entry.name === request.name)?.path
      if (!path) return
      const start = await prepareModelEntry(model, item, request.kind, path)
      return { item, isCurrent, start }
    } catch (error) {
      if (isCurrent()) onError(item, error)
    }
  }))
  // 资源屏障之后不逐个 await，让所有缓存命中的起播在同一轮微任务内完成。
  await Promise.all(prepared.map(async ready => {
    if (!ready?.isCurrent()) return
    try { await ready.start() }
    catch (error) {
      if (ready.isCurrent()) onError(ready.item, error)
    }
  }))
}
