import { reactive } from 'vue'

/** 全局"历史背景"模态控制状态（reactive 单例，App.vue 顶层挂载消费） */
export interface BackgroundHistoryModalState {
  visible: boolean
}

const state = reactive<BackgroundHistoryModalState>({
  visible: false,
})

export function useBackgroundHistoryModal() {
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
