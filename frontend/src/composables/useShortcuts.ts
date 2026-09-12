import { computed } from 'vue'
import { useModelStore, type FilterState } from '../stores/previewStore'
import { SpecialId, isSpecialId, isFigureGroupId } from '../live2d/specialIds'
import { parseInst, createEmptyInst, Inst } from '../utils/inst_utils'
import { SetClipboardText } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'
import { previewRuntime } from '../utils/runtimeRegistry'
import { FILTER_PROPERTY_KEYS, DEFAULT_FILTER_PROPERTY_VALUES } from '../live2d/L2dwContainer'

/** 快捷键适用的目标类型；与 useShortcuts 内的 store.selectedId 判定保持一致 */
export type ShortcutTargetType = 'model' | 'background' | 'stage' | 'figureGroup' | 'none'

export interface ShortcutHint {
  /** 鼠标/键盘触发键，例如 'Ctrl + F'、'左键拖动' */
  keys: string
  /** 给用户看的简短操作说明 */
  description: string
}

/** 资源路径转相对路径（background/figure文件夹为基准） */
function getResourceRelativePath(absPath: string, markerFolder: 'background' | 'figure'): string {
  const norm = absPath.replace(/\\/g, '/')
  const markerFolderStr = `/game/${markerFolder}/`
  const idx = norm.toLowerCase().lastIndexOf(markerFolderStr)
  if (idx >= 0) {
    return norm.slice(idx + markerFolderStr.length)
  }
  return absPath
}

/** 根据 selectedId 解析快捷键目标类型（纯函数，便于复用于执行与展示） */
export function resolveShortcutTargetType(selectedId: string | null): ShortcutTargetType {
  if (!selectedId) return 'none'
  if (isFigureGroupId(selectedId)) return 'figureGroup'
  if (isSpecialId(selectedId)) {
    return selectedId === SpecialId.BgContainer ? 'background' : 'stage'
  }
  return 'model'
}

/**
 * 把当前滤镜状态与默认值对比，过滤出"非默认"的字段。
 *  - 默认值：来自 L2dwContainer.DEFAULT_FILTER_PROPERTY_VALUES + l2dwAlphaFilter=1
 *  - 默认快照与 DEFAULT_FILTER_STATE 完全一致，沿用现成常量，避免在 useShortcuts 里再硬编码一遍
 */
function pickNonDefaultFilters(state: FilterState): Partial<FilterState> {
  const out: Partial<FilterState> = {}
  const sAny = state as any
  for (const key of FILTER_PROPERTY_KEYS) {
    const v = sAny[key]
    const dv = DEFAULT_FILTER_PROPERTY_VALUES[key]
    if (v !== dv) (out as any)[key] = v
  }
  if (state.l2dwAlphaFilter !== 1) (out as Record<string, number>)['alpha'] = state.l2dwAlphaFilter
  return out
}

/**
 * 组装 setTransform 的 transformData JSON：position/scale/rotation + 非默认滤镜（扁平）
 */
function buildTransformData(
  x: number, y: number, scaleX: number, scaleY: number, rotation: number,
  filters?: Partial<FilterState>,
) {
  return {
    position: { x, y },
    scale: { x: scaleX, y: scaleY },
    rotation,
    ...(filters ?? {}),
  }
}

// 快捷键处理（外层独立，方便管理）
const handler = {
  modelFigure: (): Inst | null => {
    const store = useModelStore()
    const entry = store.selectedModel
    if (!entry) return null

    // 图片立绘：用全局图片模板
    if (entry.kind === 'image') {
      if (!entry.imageUrl) {
        useMessage().error('图片路径为空!!')
        return null
      }
      const imgPath = getResourceRelativePath(entry.imageUrl, 'figure')
      const template = store.imageFigureTemplate
      const line = template.replace('%img_path%', imgPath).replace('%img_name%', entry.name)
      const inst = parseInst(line)

      console.log('[Shortcut] imageFigure:', { entry, imgPath, inst })
      console.log('[Shortcut] imageFigure:', inst.toInstString())
      useMessage().success('复制图片立绘指令成功!!')
      return inst
    }

    const name = entry.name
    const motion = entry.playing?.motion?.name ?? null
    const expression = entry.playing?.expression?.name ?? null
    const figurePath = getResourceRelativePath(entry.wmdlConfig?.wmdlFilePath ?? entry.jsonPath, 'figure')

    const template = entry.wmdlConfig?.figureTemplate || "changeFigure:%conf_path% -id=%name% %me% -writeDefault;";

    // 参数处理
    const emptyInst = createEmptyInst()
    if (motion)
    {
      emptyInst.setParamValue('motion', motion)
    }
    if (expression)
    {
      emptyInst.setParamValue('expression', expression)
    }
    var meArgs = emptyInst.toArgsString()

    // 模板替换
    const line = template.replace('%conf_path%', figurePath).replace('%name%', name).replace('%me%', meArgs)

    // 解析指令
    const inst = parseInst(line)

    // 注视 / 眨眼：enabled 时输出 -focus / -blink 参数
    const focus = store.getFocusState(entry.id)
    if (focus.enabled) {
      inst.setParamJson('focus', { x: focus.x, y: focus.y, instant: focus.instant })
    }
    const blink = store.getBlinkState(entry.id)
    if (blink.enabled) {
      inst.setParamJson('blink', {
        blinkInterval: blink.blinkInterval,
        blinkIntervalRandom: blink.blinkIntervalRandom,
        closingDuration: blink.closingDuration,
        closedDuration: blink.closedDuration,
        openingDuration: blink.openingDuration,
      })
    }

    // 输出结果
    console.log('[Shortcut] modelFigure:', { entry, name, motion, expression, figurePath, inst })
    console.log('[Shortcut] modelFigure:', inst.toInstString())
    useMessage().success(`复制立绘指令成功!!`)
    return inst
  },

  modelTransform: (): Inst | null => {
    const store = useModelStore()
    const entry = store.selectedModel
    if (!entry) return null

    // 图片立绘：用 wrapper 变换 + imageTransformTemplate
    if (entry.kind === 'image') {
      const wrapper = previewRuntime.modelWrappers.get(entry.id)
      const x = wrapper?.x ?? 0
      const y = wrapper?.y ?? 0
      const scaleX = wrapper?.scale?.x ?? 1
      const scaleY = wrapper?.scale?.y ?? 1
      const rotation = wrapper?.rotation ?? 0

      const filters = pickNonDefaultFilters(store.getFilterState(entry.id))

      const template = store.imageTransformTemplate
      const transformData = buildTransformData(x, y, scaleX, scaleY, rotation, filters)
      const line = template
        .replace('%me%', JSON.stringify(transformData))
        .replace('%img_name%', entry.name)

      const inst = parseInst(line)

      console.log('[Shortcut] imageTransform:', { entry, transform: { x, y, scaleX, scaleY, rotation }, filters, inst })
      console.log('[Shortcut] imageTransform:', inst.toInstString())
      useMessage().success('复制图片变换指令成功!!')
      return inst
    }

    const wrapper = previewRuntime.modelWrappers.get(entry.id)
    const x = wrapper?.x ?? 0
    const y = wrapper?.y ?? 0
    const scaleX = wrapper?.scale?.x ?? 1
    const scaleY = wrapper?.scale?.y ?? 1
    const rotation = wrapper?.rotation ?? 0
    const name = entry.name
    const filters = pickNonDefaultFilters(store.getFilterState(entry.id))

    const template = entry.wmdlConfig?.transformTemplate || "setTransform:%me% -target=%name% -writeDefault;";

    const transformData = buildTransformData(x, y, scaleX, scaleY, rotation, filters) // to %me%

    const line = template.replace('%me%', JSON.stringify(transformData)).replace('%name%', name)

    const inst = parseInst(line)

    console.log('[Shortcut] modelTransform:', { entry, transform: { x, y, scaleX, scaleY, rotation }, filters, inst })
    console.log('[Shortcut] modelTransform:', inst.toInstString())
    useMessage().success(`复制立绘变换指令成功!!`)
    return inst
  },

  modelSplit: (): string[] => {
    const figureInst = handler.modelFigure()
    const transformInst = handler.modelTransform()

    const lines: string[] = []
    if (figureInst) lines.push(figureInst.toInstString())
    if (transformInst) lines.push(transformInst.toInstString())

    console.log('[Shortcut] modelSplit:', lines)
    useMessage().success(`复制拆分布令成功!!`)
    return lines
  },

  modelMerge: (): string | null => {
    const figureInst = handler.modelFigure()
    const transformInst = handler.modelTransform()
    if (!figureInst) return null

    figureInst.setParamValue('transform', transformInst?.content ?? '')

    console.log('[Shortcut] modelMerge:', figureInst.toInstString())
    useMessage().success(`复制合并立绘指令成功!!`)
    return figureInst.toInstString()
  },

  modelHide: (): Inst | null => {
    const store = useModelStore()
    const entry = store.selectedModel
    const name = entry?.name ?? null

    // todo: 实现隐藏立绘指令逻辑

    const template = "changeFigure: -id=%name% -writeDefault;";
    const line = template.replace('%name%', name ?? '')

    const inst = parseInst(line)

    console.log('[Shortcut] modelHide:', { entry, inst })
    console.log('[Shortcut] modelHide:', inst.toInstString())
    useMessage().success(`复制隐藏立绘指令成功!!`)
    return inst
  },

  bgSetImage: (): Inst | null => {
    const store = useModelStore()
    const bgUrl = store.backgroundUrl
    const bgPath = bgUrl ? getResourceRelativePath(bgUrl, 'background') : null

    if (!bgPath)
    {
      useMessage().error(`背景路径为空!!`)
      return null
    }

    const template = store.bgTemplate

    const line = template.replace('%bg_path%', bgPath ?? '')

    const inst = parseInst(line)

    console.log('[Shortcut] bgSetImage:', { bgPath, inst })
    console.log('[Shortcut] bgSetImage:', inst.toInstString())
    useMessage().success(`复制背景切换指令成功!!`)
    return inst
  },

  bgTransform: (): Inst | null => {
    const store = useModelStore()
    const container = previewRuntime.specialContainers.get(SpecialId.BgContainer)
    const x = container?.x ?? 0
    const y = container?.y ?? 0
    const scaleX = container?.scale?.x ?? 1
    const scaleY = container?.scale?.y ?? 1
    const rotation = container?.rotation ?? 0

    const filters = pickNonDefaultFilters(store.getFilterState(SpecialId.BgContainer))

    const template = store.bgTransformTemplate

    const transformData = buildTransformData(x, y, scaleX, scaleY, rotation, filters) // to %me%
    const line = template.replace('%me%', JSON.stringify(transformData))

    const inst = parseInst(line)

    console.log('[Shortcut] bgTransform:', { transform: { x, y, scaleX, scaleY, rotation }, filters, inst })
    console.log('[Shortcut] bgTransform:', inst.toInstString())
    useMessage().success(`复制背景变换指令成功!!`)
    return inst
  },

  stageTransform: (): Inst | null => {
    const store = useModelStore()
    const container = previewRuntime.specialContainers.get(SpecialId.StageMain)
    const x = container?.x ?? 0
    const y = container?.y ?? 0
    const scaleX = container?.scale?.x ?? 1
    const scaleY = container?.scale?.y ?? 1
    const rotation = container?.rotation ?? 0

    const filters = pickNonDefaultFilters(store.getFilterState(SpecialId.StageMain))

    const template = store.stageTransformTemplate

    const transformData = buildTransformData(x, y, scaleX, scaleY, rotation, filters) // to %me%
    const line = template.replace('%me%', JSON.stringify(transformData))

    const inst = parseInst(line)

    console.log('[Shortcut] stageTransform:', { transform: { x, y, scaleX, scaleY, rotation }, filters, inst })
    console.log('[Shortcut] stageTransform:', inst.toInstString())
    useMessage().success(`复制主场景变换指令成功!!`)
    return inst
  },
}

/**
 * 同一份快捷键定义：同时驱动执行（handleShortcut）与展示（getShortcutHints）。
 * - `key`：e.key 的小写形式；与展示无关，纯用于匹配
 * - `keys`：展示用的按键描述（带 Ctrl 等修饰键）
 * - `description`：用户可读的功能说明
 * - `targets`：适用的目标类型列表，未列入的类型即便按键匹配也不会触发
 */
interface ShortcutEntry {
  key: string
  keys: string
  description: string
  targets: ShortcutTargetType[]
  /** handler key，用于立绘组分发时根据目标类型找正确 handler */
  handlerKey: ShortcutHandlerKey
  run: () => Inst | string | string[] | null
}

type ShortcutHandlerKey =
  | 'modelFigure' | 'modelTransform' | 'modelSplit' | 'modelMerge' | 'modelHide'
  | 'bgSetImage' | 'bgTransform' | 'stageTransform'

export const SHORTCUTS: readonly ShortcutEntry[] = [
  {
    key: 'f',
    keys: 'Ctrl + F',
    description: '复制立绘显示/切换指令 (changeFigure)',
    targets: ['model', 'figureGroup'],
    handlerKey: 'modelFigure',
    run: () => handler.modelFigure(),
  },
  {
    key: 't',
    keys: 'Ctrl + T',
    description: '复制立绘变换指令 (setTransform)',
    targets: ['model', 'figureGroup'],
    handlerKey: 'modelTransform',
    run: () => handler.modelTransform(),
  },
  {
    key: 'x',
    keys: 'Ctrl + X',
    description: '复制拆分的立绘 + 变换指令（两行）',
    targets: ['model', 'figureGroup'],
    handlerKey: 'modelSplit',
    run: () => handler.modelSplit(),
  },
  {
    key: 'a',
    keys: 'Ctrl + A',
    description: '复制合并后的立绘指令（含 transform 参数）',
    targets: ['model', 'figureGroup'],
    handlerKey: 'modelMerge',
    run: () => handler.modelMerge(),
  },
  {
    key: 'h',
    keys: 'Ctrl + H',
    description: '复制隐藏立绘指令',
    targets: ['model', 'figureGroup'],
    handlerKey: 'modelHide',
    run: () => handler.modelHide(),
  },
  {
    key: 'f',
    keys: 'Ctrl + F',
    description: '复制背景切换指令 (changeBg)',
    targets: ['background', 'figureGroup'],
    handlerKey: 'bgSetImage',
    run: () => handler.bgSetImage(),
  },
  {
    key: 't',
    keys: 'Ctrl + T',
    description: '复制背景变换指令 (setTransform)',
    targets: ['background', 'figureGroup'],
    handlerKey: 'bgTransform',
    run: () => handler.bgTransform(),
  },
  {
    key: 't',
    keys: 'Ctrl + T',
    description: '复制主场景变换指令 (setTransform)',
    targets: ['stage'],
    handlerKey: 'stageTransform',
    run: () => handler.stageTransform(),
  },
]

// 处理 handler 返回值的归一化：Inst→toInstString; string 保留; string[] 换行合并; null 跳过
function copyHandlerResult(result: unknown): void {
  if (result == null) return
  let text: string | null = null
  if (typeof result === 'string') {
    text = result
  } else if (Array.isArray(result)) {
    const parts = result.filter((v): v is string => typeof v === 'string')
    text = parts.length ? parts.join('\n') : null
  } else if (typeof result === 'object' && typeof (result as Inst).toInstString === 'function') {
    text = (result as Inst).toInstString()
  }
  if (!text) return
  SetClipboardText(text).catch((err) => {
    console.error('[Shortcut] SetClipboardText failed:', err)
  })
}

/**
 * 把单条 handler 的返回值转成"行"数组（用于多行拼接）。
 * - null → []
 * - string → [string]
 * - string[] → 过滤非字符串元素
 * - Inst → [toInstString()]
 */
function resultToLines(result: unknown): string[] {
  if (result == null) return []
  if (typeof result === 'string') return [result]
  if (Array.isArray(result)) {
    return result.filter((v): v is string => typeof v === 'string')
  }
  if (typeof result === 'object' && typeof (result as Inst).toInstString === 'function') {
    return [(result as Inst).toInstString()]
  }
  return []
}

/**
 * 立绘组快捷键分发：
 *  - 立绘类（modelFigure/modelTransform/...）：循环每个立绘目标，临时切 selectedId 复用 handler
 *  - 背景类（bgSetImage/bgTransform）：当 includeBackground=true 时，按 handlerKey 直接调 handler.bgSetImage/bgTransform，
 *    不再依赖 selectedId = BgContainer（避免"切到 BgContainer 后跑 modelFigure"返回 null 的问题）
 *  - 立绘 + 背景的结果按行拼接
 */
function runShortcutForFigureGroup(entry: ShortcutEntry): void {
  const store = useModelStore()
  const id = store.selectedId
  if (!id || !isFigureGroupId(id)) return

  const group = store.figureGroups.find((g) => g.id === id)
  if (!group) return

  store.cleanupInvalidFigureGroupTargets(id)

  const lines: string[] = []
  const isBackgroundHandler =
    entry.handlerKey === 'bgSetImage' || entry.handlerKey === 'bgTransform'

  // 立绘类：循环每个目标（仅在不是背景专用 handler 时才有意义）
  if (!isBackgroundHandler) {
    const figureTargets = store.flattenFigureGroupTargets(id)
    for (const targetId of figureTargets) {
      if (!store.models.some((m) => m.id === targetId)) continue
      const prev = store.selectedId
      store.selectedId = targetId
      try {
        lines.push(...resultToLines(entry.run()))
      } finally {
        store.selectedId = prev
      }
    }
  }

  // 背景：仅背景专用快捷键 + includeBackground 时处理
  if (group.includeBackground && isBackgroundHandler) {
    const fn = handler[entry.handlerKey]
    if (typeof fn === 'function') {
      lines.push(...resultToLines((fn as () => unknown)()))
    }
  }

  if (lines.length === 0) {
    useMessage().warning('无可用指令')
    return
  }
  const text = lines.join('\n')
  SetClipboardText(text).catch((err) => {
    console.error('[Shortcut] SetClipboardText failed:', err)
  })
  useMessage().success(`复制立绘组指令成功（${lines.length} 行）`)
}

/**
 * 返回当前目标类型下生效的快捷键展示列表。
 * 同一按键在不同目标下展示不同的说明，因此返回的是已经按 targets 过滤后的全部条目。
 */
export function getShortcutHints(target: ShortcutTargetType): ShortcutHint[] {
  return SHORTCUTS
    .filter((entry) => entry.targets.includes(target))
    .map((entry) => ({ keys: entry.keys, description: entry.description }))
}

export function useShortcuts() {
  const store = useModelStore()

  // 检测输入框焦点
  const isInputFocused = () => {
    const active = document.activeElement
    if (!active) return false
    const tag = active.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable
  }

  // 判断选中对象类型
  const targetType = computed(() => resolveShortcutTargetType(store.selectedId))

  // 快捷键处理
  const handleShortcut = (e: KeyboardEvent) => {
    if (!e.ctrlKey) return
    if (isInputFocused()) return

    const key = e.key.toLowerCase()
    const type = targetType.value
    if (type === 'none') return

    const entry = SHORTCUTS.find((s) => s.key === key && s.targets.includes(type))
    if (!entry) return
    e.preventDefault()

    // 立绘组：走专用分发（展平所有目标 + 多行拼接 + 可选背景）
    if (type === 'figureGroup') {
      runShortcutForFigureGroup(entry)
      return
    }

    copyHandlerResult(entry.run())
  }

  return { handleShortcut, targetType }
}
