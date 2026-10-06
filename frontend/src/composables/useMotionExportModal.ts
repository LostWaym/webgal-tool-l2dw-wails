import { reactive } from 'vue'

export type MotionExportFormat = 'mtn' | 'motion3'

export interface MotionExportModalState {
  visible: boolean
  format: MotionExportFormat
}

const state = reactive<MotionExportModalState>({
  visible: false,
  format: 'motion3',
})

export function useMotionExportModal() {
  return {
    state,
    open() {
      state.visible = true
    },
    close() {
      state.visible = false
    },
    setFormat(format: MotionExportFormat) {
      state.format = format
    },
  }
}
