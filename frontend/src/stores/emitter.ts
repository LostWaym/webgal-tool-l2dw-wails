// 本文件已经封装 mitt，使用方无需阅读 mitt 源码。
import mitt from 'mitt'

export type EventName = string
export type EventHandler<T = unknown> = (payload: T) => void

const bus = mitt()

export const emitter = {
  on<T = unknown>(name: EventName, handler: EventHandler<T>): void {
    bus.on(name, handler as EventHandler)
  },
  off<T = unknown>(name: EventName, handler: EventHandler<T>): void {
    bus.off(name, handler as EventHandler)
  },
  emit<T = unknown>(name: EventName, payload?: T): void {
    bus.emit(name, payload as unknown)
  },
}

/**
 * Stage / 编辑器面板之间的事件名集合。
 * 集中维护，避免散落的字符串。
 */
export const StageEvents = {
  TransformChange: 'stage:transform-change',
  ReloadModel: 'stage:reload-model',
} as const

export default emitter
