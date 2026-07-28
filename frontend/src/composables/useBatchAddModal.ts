import { reactive } from 'vue'

/**
 * 全局"批量添加动作/表情"模态控制状态。
 *
 * 通过 reactive 单例共享，让 EditMotionsTab / EditExpressionsTab 触发 open()，
 * 而由 ModelEditApp.vue 在顶层挂载 EditBatchAddModal 来消费 visible。
 *
 * 为什么不用 mitt：项目尚未引入该依赖，使用 reactive 单例更轻量。
 */
export interface BatchAddModalState {
  visible: boolean
  kind: 'motion' | 'expression'
}

const state = reactive<BatchAddModalState>({
  visible: false,
  kind: 'motion',
})

export function useBatchAddModal() {
  return {
    state,
    open(kind: 'motion' | 'expression') {
      state.kind = kind
      state.visible = true
    },
    close() {
      state.visible = false
    },
  }
}