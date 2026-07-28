import { reactive } from 'vue'

/** 气泡透明度，范围 0-1。改这里即可全局生效。 */
const MESSAGE_OPACITY = 0.8

export type MessageType = 'success' | 'info' | 'warning' | 'error'

export type MessagePlacement =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'

export interface MessageItem {
  id: number
  type: MessageType
  text: string
  duration: number
  showClose: boolean
  grouping: boolean
  placement: MessagePlacement
  repeatNum: number
  closed: boolean
}

export interface MessageOptions {
  type?: MessageType
  duration?: number
  showClose?: boolean
  grouping?: boolean
  placement?: MessagePlacement
}

const DEFAULT_DURATION = 3000

export const messageState = reactive({
  items: [] as MessageItem[],
})

let nextId = 1

export function addMessage(text: string, options: MessageOptions = {}): MessageItem {
  const type: MessageType = options.type ?? 'info'
  const grouping = options.grouping ?? false

  if (grouping) {
    const exist = messageState.items.find(
      (m) => !m.closed && m.text === text && m.type === type,
    )
    if (exist) {
      exist.repeatNum += 1
      return exist
    }
  }

  const item: MessageItem = {
    id: nextId++,
    type,
    text,
    duration: options.duration ?? DEFAULT_DURATION,
    showClose: options.showClose ?? false,
    grouping,
    placement: options.placement ?? 'top',
    repeatNum: 1,
    closed: false,
  }
  messageState.items.push(item)
  return item
}

export function removeMessage(id: number) {
  const idx = messageState.items.findIndex((m) => m.id === id)
  if (idx >= 0) messageState.items.splice(idx, 1)
}

export function closeAllMessages() {
  messageState.items.splice(0, messageState.items.length)
}

export interface MessageApi {
  (text: string, options?: Omit<MessageOptions, 'type'>): MessageItem
  success: (text: string, options?: Omit<MessageOptions, 'type'>) => MessageItem
  info: (text: string, options?: Omit<MessageOptions, 'type'>) => MessageItem
  warning: (text: string, options?: Omit<MessageOptions, 'type'>) => MessageItem
  error: (text: string, options?: Omit<MessageOptions, 'type'>) => MessageItem
  closeAll: () => void
}

function createMessageApi(): MessageApi {
  const base = (text: string, options: Omit<MessageOptions, 'type'> = {}) =>
    addMessage(text, { ...options, type: undefined })

  const fn = ((text: string, options?: Omit<MessageOptions, 'type'>) =>
    addMessage(text, options ?? {})) as MessageApi

  fn.success = (text, options) => addMessage(text, { ...(options ?? {}), type: 'success' })
  fn.info = (text, options) => addMessage(text, { ...(options ?? {}), type: 'info' })
  fn.warning = (text, options) => addMessage(text, { ...(options ?? {}), type: 'warning' })
  fn.error = (text, options) => addMessage(text, { ...(options ?? {}), type: 'error' })
  fn.closeAll = closeAllMessages
  return fn
}

const globalApi = createMessageApi()

export function useMessage(): MessageApi {
  return globalApi
}

export { MESSAGE_OPACITY }
