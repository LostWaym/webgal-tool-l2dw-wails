import { reactive } from 'vue'

/**
 * 全局"变换快照"模态控制状态。
 *
 * 通过 reactive 单例共享，让 ModelActionPanel 调用 open()，
 * 而由 App.vue 在顶层挂载 TransformSnapshotModal 来消费 visible。
 *
 * 为什么不用 mitt：项目尚未引入该依赖，使用 reactive 单例更轻量。
 */

export interface TransformSnapshotModalState {
  visible: boolean
}

const state = reactive<TransformSnapshotModalState>({
  visible: false,
})

export function useTransformSnapshotModal() {
  return {
    state,
    open() {
      state.visible = true
    },
    close() {
      state.visible = false
    },
  }
}