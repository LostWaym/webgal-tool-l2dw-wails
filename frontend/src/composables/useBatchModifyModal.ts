import { reactive } from 'vue'

/**
 * 全局"批量修改动作/表情"模态控制状态。
 *
 * 与 useBatchAddModal 同模式：reactive 单例，EditMotionsTab / EditExpressionsTab 触发 open()，
 * 由 ModelEditApp.vue 在顶层挂载 EditBatchModifyModal 来消费 visible。
 */
export interface BatchModifyModalState {
  visible: boolean
  kind: 'motion' | 'expression'
}

const state = reactive<BatchModifyModalState>({
  visible: false,
  kind: 'motion',
})

export function useBatchModifyModal() {
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
