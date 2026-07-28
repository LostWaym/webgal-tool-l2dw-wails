import { computed } from 'vue'
import { useModelStore } from '../stores/models'
import { SpecialId, isSpecialId } from '../live2d/specialIds'
import { parseInst, createEmptyInst, Inst } from '../utils/inst_utils'
import { SetClipboardText } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'

/** 快捷键适用的目标类型；与 useShortcuts 内的 store.selectedId 判定保持一致 */
export type ShortcutTargetType = 'model' | 'background' | 'stage' | 'none'

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
  if (isSpecialId(selectedId)) {
    return selectedId === SpecialId.BgContainer ? 'background' : 'stage'
  }
  return 'model'
}

// 快捷键处理（外层独立，方便管理）
const handler = {
  modelFigure: (): Inst | null => {
    const store = useModelStore()
    const entry = store.selectedModel
    if (!entry) return null
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
    const containers = (window as any).__l2dwContainers as Map<string, any> | undefined
    const wrapper = containers?.get(entry.id)
    const x = wrapper?.x ?? 0
    const y = wrapper?.y ?? 0
    const scaleX = wrapper?.scale?.x ?? 1
    const scaleY = wrapper?.scale?.y ?? 1
    const rotation = wrapper?.rotation ?? 0
    const name = entry.name

    const template = entry.wmdlConfig?.transformTemplate || "setTransform:%me% -target=%name% -writeDefault;";

    const transformData = { position: { x: x, y: y }, scale: { x: scaleX, y: scaleY }, rotation } // to %me%

    const line = template.replace('%me%', JSON.stringify(transformData)).replace('%name%', name)

    const inst = parseInst(line)

    console.log('[Shortcut] modelTransform:', { entry, transform: { x, y, scaleX, scaleY, rotation }, inst })
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
    const specials = (window as any).__l2dwSpecialContainers as Map<string, any> | undefined
    const container = specials?.get(SpecialId.BgContainer)
    const x = container?.x ?? 0
    const y = container?.y ?? 0
    const scaleX = container?.scale?.x ?? 1
    const scaleY = container?.scale?.y ?? 1
    const rotation = container?.rotation ?? 0

    const template = store.bgTransformTemplate

    const transformData = { position: { x: x, y: y }, scale: { x: scaleX, y: scaleY }, rotation } // to %me%
    const line = template.replace('%me%', JSON.stringify(transformData))

    const inst = parseInst(line)

    console.log('[Shortcut] bgTransform:', { transform: { x, y, scaleX, scaleY, rotation }, inst })
    console.log('[Shortcut] bgTransform:', inst.toInstString())
    useMessage().success(`复制背景变换指令成功!!`)
    return inst
  },

  stageTransform: (): Inst | null => {
    const store = useModelStore()
    const specials = (window as any).__l2dwSpecialContainers as Map<string, any> | undefined
    const container = specials?.get(SpecialId.StageMain)
    const x = container?.x ?? 0
    const y = container?.y ?? 0
    const scaleX = container?.scale?.x ?? 1
    const scaleY = container?.scale?.y ?? 1
    const rotation = container?.rotation ?? 0

    const template = store.stageTransformTemplate

    const transformData = { position: { x: x, y: y }, scale: { x: scaleX, y: scaleY }, rotation } // to %me%
    const line = template.replace('%me%', JSON.stringify(transformData))

    const inst = parseInst(line)

    console.log('[Shortcut] stageTransform:', { transform: { x, y, scaleX, scaleY, rotation }, inst })
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
  run: () => Inst | string | string[] | null
}

export const SHORTCUTS: readonly ShortcutEntry[] = [
  {
    key: 'f',
    keys: 'Ctrl + F',
    description: '复制立绘显示/切换指令 (changeFigure)',
    targets: ['model'],
    run: () => handler.modelFigure(),
  },
  {
    key: 't',
    keys: 'Ctrl + T',
    description: '复制立绘变换指令 (setTransform)',
    targets: ['model'],
    run: () => handler.modelTransform(),
  },
  {
    key: 'x',
    keys: 'Ctrl + X',
    description: '复制拆分的立绘 + 变换指令（两行）',
    targets: ['model'],
    run: () => handler.modelSplit(),
  },
  {
    key: 'a',
    keys: 'Ctrl + A',
    description: '复制合并后的立绘指令（含 transform 参数）',
    targets: ['model'],
    run: () => handler.modelMerge(),
  },
  {
    key: 'h',
    keys: 'Ctrl + H',
    description: '复制隐藏立绘指令',
    targets: ['model'],
    run: () => handler.modelHide(),
  },
  {
    key: 'f',
    keys: 'Ctrl + F',
    description: '复制背景切换指令 (changeBg)',
    targets: ['background'],
    run: () => handler.bgSetImage(),
  },
  {
    key: 't',
    keys: 'Ctrl + T',
    description: '复制背景变换指令 (setTransform)',
    targets: ['background'],
    run: () => handler.bgTransform(),
  },
  {
    key: 't',
    keys: 'Ctrl + T',
    description: '复制主场景变换指令 (setTransform)',
    targets: ['stage'],
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
    copyHandlerResult(entry.run())
  }

  return { handleShortcut, targetType }
}
