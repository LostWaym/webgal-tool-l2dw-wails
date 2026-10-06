import { reactive } from 'vue'

/** 全局"帧率/时长设置"模态控制状态（reactive 单例，MotionEditApp 顶层挂载消费） */
export interface FrameSettingsModalState {
  visible: boolean
}

const state = reactive<FrameSettingsModalState>({
  visible: false,
})

export function useFrameSettingsModal() {
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
