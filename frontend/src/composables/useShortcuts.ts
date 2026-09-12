import { computed, ref } from 'vue'
import { useModelStore, type FilterState } from '../stores/previewStore'
import { SpecialId, isSpecialId, isFigureGroupId } from '../live2d/specialIds'
import { parseInst, createEmptyInst, Inst } from '../utils/inst_utils'
import { SetClipboardText } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'
import { previewRuntime } from '../utils/runtimeRegistry'
import { FILTER_PROPERTY_KEYS, DEFAULT_FILTER_PROPERTY_VALUES } from '../live2d/L2dwContainer'

/** 复制指令时 `-next` flag 的处理模式 */
export type NextArgMode = 'none' | 'all' | 'allButLast'

export const NEXT_ARG_MODE_OPTIONS: ReadonlyArray<{ value: NextArgMode; label: string }> = [
  { value: 'none', label: '不处理' },
  { value: 'all', label: '全部处理' },
  { value: 'allButLast', label: '除了最后一个' },
]

/** 会话内 next 后处理模式：默认除了最后一个 */
const nextArgMode = ref<NextArgMode>('allButLast')

export function getNextMode(): NextArgMode {
  return nextArgMode.value
}

export function setNextMode(mode: NextArgMode): void {
  nextArgMode.value = mode
}

/** 给单条指令行追加 `-next` flag（行尾有 `;` 时插在 `;` 前）；无法安全解析则原样返回 */
function appendNextFlag(line: string): string {
  const inst = parseInst(line)
  inst.setParamValue('next', true)
  return inst.toInstString()
}

/**
 * 按当前模式对指令行数组做 -next 后处理。
 * - none: 原样返回
 * - all: 全部行追加 -next
 * - allButLast: 除最后一行外都追加 -next
 */
export function applyNextFlag(lines: string[]): string[] {
  const mode = nextArgMode.value
  if (mode === 'none' || lines.length === 0) return lines
  const last = lines.length - 1
  return lines.map((line, i) => {
    if (mode === 'allButLast' && i === last) return line
    return appendNextFlag(line)
  })
}

/** 快捷键适用的目标类型；与 useShortcuts 内的 store.selectedId 判定保持一致 */
export type ShortcutTargetType = 'model' | 'background' | 'stage' | 'figureGroup' | 'none'

export interface ShortcutEntry {
  key: string
  keys: string
  description: string
  targets: ShortcutTargetType[]
  /** handler key，用于立绘组分发时根据目标类型找正确 handler */
  handlerKey: ShortcutHandlerKey
  /** 执行入口：返回需要复制到剪贴板的指令，或 void（用于打开编辑器等不复制指令的动作） */
  run: () => Inst | string | string[] | null | void
}

type ShortcutHandlerKey =
  | 'modelFigure' | 'modelTransform' | 'modelSplit' | 'modelMerge' | 'modelHide'
  | 'bgSetImage' | 'bgTransform' | 'stageTransform'
  | 'openEditor'

export interface ShortcutHint {
  /** 鼠标/键盘触发键，例如 'Ctrl + F'、'左键拖动' */
  keys: string
  /** 给用户看的简短操作说明 */
  description: string
  /** 对应的可执行 entry；快捷键展示项点击时复用其 run() */
  entry: ShortcutEntry
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
  modelFigure: (shouldShowToast: boolean = true): Inst | null => {
    const store = useModelStore()
    const entry = store.selectedModel
    if (!entry) return null

    // 图片立绘：用全局图片模板
    if (entry.kind === 'image') {
      if (!entry.imageUrl) {
        if (shouldShowToast) useMessage().error('图片路径为空!!')
        return null
      }
      const imgPath = getResourceRelativePath(entry.imageUrl, 'figure')
      const template = store.imageFigureTemplate
      const line = template.replace('%img_path%', imgPath).replace('%img_name%', entry.name)
      const inst = parseInst(line)

      console.log('[Shortcut] imageFigure:', { entry, imgPath, inst })
      console.log('[Shortcut] imageFigure:', inst.toInstString())
      if (shouldShowToast) useMessage().success('复制图片立绘指令成功!!')
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
    if (shouldShowToast) useMessage().success(`复制立绘指令成功!!`)
    return inst
  },

  modelTransform: (shouldShowToast: boolean = true): Inst | null => {
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
      if (shouldShowToast) useMessage().success('复制图片变换指令成功!!')
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
    if (shouldShowToast) useMessage().success(`复制立绘变换指令成功!!`)
    return inst
  },

  modelSplit: (shouldShowToast: boolean = true): string[] => {
    const figureInst = handler.modelFigure(false)
    const transformInst = handler.modelTransform(false)

    const lines: string[] = []
    if (figureInst) lines.push(figureInst.toInstString())
    if (transformInst) lines.push(transformInst.toInstString())

    console.log('[Shortcut] modelSplit:', lines)
    if (shouldShowToast) useMessage().success(`复制拆分布令成功!!`)
    return lines
  },

  modelMerge: (shouldShowToast: boolean = true): string | null => {
    const figureInst = handler.modelFigure(false)
    const transformInst = handler.modelTransform(false)
    if (!figureInst) return null

    figureInst.setParamValue('transform', transformInst?.content ?? '')

    console.log('[Shortcut] modelMerge:', figureInst.toInstString())
    if (shouldShowToast) useMessage().success(`复制合并立绘指令成功!!`)
    return figureInst.toInstString()
  },

  modelHide: (shouldShowToast: boolean = true): Inst | null => {
    const store = useModelStore()
    const entry = store.selectedModel
    const name = entry?.name ?? null

    // todo: 实现隐藏立绘指令逻辑

    const template = "changeFigure: -id=%name% -writeDefault;";
    const line = template.replace('%name%', name ?? '')

    const inst = parseInst(line)

    console.log('[Shortcut] modelHide:', { entry, inst })
    console.log('[Shortcut] modelHide:', inst.toInstString())
    if (shouldShowToast) useMessage().success(`复制隐藏立绘指令成功!!`)
    return inst
  },

  bgSetImage: (shouldShowToast: boolean = true): Inst | null => {
    const store = useModelStore()
    const bgUrl = store.backgroundUrl
    const bgPath = bgUrl ? getResourceRelativePath(bgUrl, 'background') : null

    if (!bgPath)
    {
      if (shouldShowToast) useMessage().error(`背景路径为空!!`)
      return null
    }

    const template = store.bgTemplate

    const line = template.replace('%bg_path%', bgPath ?? '')

    const inst = parseInst(line)

    console.log('[Shortcut] bgSetImage:', { bgPath, inst })
    console.log('[Shortcut] bgSetImage:', inst.toInstString())
    if (shouldShowToast) useMessage().success(`复制背景切换指令成功!!`)
    return inst
  },

  bgTransform: (shouldShowToast: boolean = true): Inst | null => {
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
    if (shouldShowToast) useMessage().success(`复制背景变换指令成功!!`)
    return inst
  },

  stageTransform: (shouldShowToast: boolean = true): Inst | null => {
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
    if (shouldShowToast) useMessage().success(`复制主场景变换指令成功!!`)
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
  const lines = resultToLines(result)
  if (lines.length === 0) return
  const processed = applyNextFlag(lines)
  SetClipboardText(processed.join('\n')).catch((err) => {
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
 * 立绘组快捷键分发（按 key 聚合，按 targets 区分）：
 *  - 立绘类：SHORTCUTS.filter(s => s.key === key && s.targets.includes('model'))
 *    （即 modelFigure / modelTransform / modelSplit / modelMerge / modelHide）
 *  - 背景类：SHORTCUTS.filter(s => s.key === key && s.targets.includes('background'))
 *    （即 bgSetImage / bgTransform），仅在 includeBackground=true 时执行
 *  - 立绘类循环每个立绘组目标，临时切 selectedId 复用 handler
 *  - 背景类直接调 handler，不依赖 selectedId = BgContainer
 *  - 其他 entry（如 stageTransform，targets 只有 stage）自然不会命中，跳过
 *  - 所有结果按 SHORTCUTS 声明顺序 + 目标顺序，行拼接后写入剪贴板
 */
function runShortcutForFigureGroup(key: string): void {
  const store = useModelStore()
  const id = store.selectedId
  if (!id || !isFigureGroupId(id)) return

  const group = store.figureGroups.find((g) => g.id === id)
  if (!group) return
  store.cleanupInvalidFigureGroupTargets(id)

  // 按 key + targets 筛选：
  //   立绘类：targets 含 'model'（即 model/figureGroup）
  //   背景类：targets 含 'background'（即 background/figureGroup）
  const figureEntries = SHORTCUTS.filter(
    (s) => s.key === key && s.targets.includes('model'),
  )
  const backgroundEntries = SHORTCUTS.filter(
    (s) => s.key === key && s.targets.includes('background'),
  )
  if (figureEntries.length === 0 && backgroundEntries.length === 0) return

  const figureTargets = store.flattenFigureGroupTargets(id)
  const lines: string[] = []
  // const seen = new Set<ShortcutHandlerKey>()

  const tryRun = (entry: ShortcutEntry): void => {
    // if (seen.has(entry.handlerKey)) return
    // seen.add(entry.handlerKey)
    const fn = (handler as Record<string, unknown>)[entry.handlerKey]
    if (typeof fn !== 'function') return
    lines.push(...resultToLines((fn as (shouldShowToast?: boolean) => unknown)(false)))
  }

  // 1) 立绘类：循环每个目标，临时切 selectedId 复用 handler
  for (const entry of figureEntries) {
    for (const targetId of figureTargets) {
      if (!store.models.some((m) => m.id === targetId)) continue
      const prev = store.selectedId
      store.selectedId = targetId
      try {
        tryRun(entry)
      } finally {
        store.selectedId = prev
      }
    }
  }

  // 2) 背景类：仅 includeBackground 时执行
  if (group.includeBackground) {
    for (const entry of backgroundEntries) {
      tryRun(entry)
    }
  }

  if (lines.length === 0) {
    useMessage().warning('无可用指令')
    return
  }
  const processed = applyNextFlag(lines)
  const text = processed.join('\n')
  SetClipboardText(text).catch((err) => {
    console.error('[Shortcut] SetClipboardText failed:', err)
  })
  useMessage().success(`复制立绘组指令成功（${processed.length} 行）`)
}

/** 检测当前焦点是否在文本输入控件内（input[非 checkbox/radio] / textarea / contentEditable） */
export function isInputFocused(): boolean {
  const active = document.activeElement
  if (!active) return false
  const tag = active.tagName.toLowerCase()
  if (tag === 'input') {
    const type = (active as HTMLInputElement).type.toLowerCase()
    if (type === 'checkbox' || type === 'radio') return false
    return true
  }
  return tag === 'textarea' || (active as HTMLElement).isContentEditable
}

/**
 * 返回当前目标类型下生效的快捷键 entry 列表（保留可执行入口）。
 * 同一按键在不同目标下展示不同的说明，因此返回的是已经按 targets 过滤后的全部条目。
 */
export function getShortcutEntries(target: ShortcutTargetType): ShortcutEntry[] {
  return SHORTCUTS.filter((entry) => entry.targets.includes(target))
}

/**
 * 返回当前目标类型下生效的快捷键展示列表（仅展示字段）。
 */
export function getShortcutHints(target: ShortcutTargetType): ShortcutHint[] {
  return getShortcutEntries(target).map((entry) => ({
    keys: entry.keys,
    description: entry.description,
    entry,
  }))
}

/**
 * 根据当前选中状态执行一条快捷键 entry。等价于键盘 handleShortcut 对该 entry 的执行路径。
 * - figureGroup 走专用分发（多行 + 可选背景）
 * - 输入框聚焦时不触发
 * - selectedId 为空（type === 'none'）时静默忽略
 */
export function runShortcutEntry(entry: ShortcutEntry): void {
  const store = useModelStore()
  const type = resolveShortcutTargetType(store.selectedId)
  if (type === 'none') return
  if (isInputFocused()) return
  if (type === 'figureGroup') {
    runShortcutForFigureGroup(entry.key)
    return
  }
  copyHandlerResult(entry.run())
}

export function useShortcuts() {
  const store = useModelStore()

  // 判断选中对象类型
  const targetType = computed(() => resolveShortcutTargetType(store.selectedId))

  // 快捷键处理
  const handleShortcut = (e: KeyboardEvent) => {
    if (!e.ctrlKey) return
    if (isInputFocused()) return

    const key = e.key.toLowerCase()
    const type = targetType.value
    if (type === 'none') return

    // 立绘组：直接走专用分发（按 key + targets 收集立绘/背景 entry）
    if (type === 'figureGroup') {
      runShortcutForFigureGroup(key)
      e.preventDefault()
      return
    }

    const entry = SHORTCUTS.find((s) => s.key === key && s.targets.includes(type))
    if (!entry) return
    e.preventDefault()

    copyHandlerResult(entry.run())
  }

  return { handleShortcut, targetType, runShortcutEntry, isInputFocused }
}
