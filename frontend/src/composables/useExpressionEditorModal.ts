import { reactive } from 'vue'

/**
 * 全局"表情编辑"模态控制状态。
 *
 * 模态内部存在两种模式：
 * - 编辑模式（exportMode = false）：左侧预览 + 右侧 [参数/表情] Tab，
 *   表情 Tab 点击会覆盖模型当前参数。
 * - 导出模式（exportMode = true）：在主内容上覆盖一层导出对话框，
 *   用户选择 .exp.json / .exp3.json 后写入文件。
 *
 * 与 useBatchAddModal 同模式：reactive 单例，ExpressionsToolbar 触发 open()，
 * 由 ModelEditApp.vue 在顶层挂载 ExpressionEditorModal 来消费 visible。
 */
export type ExportFormat = 'exp' | 'exp3'

export interface ExpressionEditorModalState {
  visible: boolean
  exportMode: boolean
  selectedExportFormat: ExportFormat | null
}

const state = reactive<ExpressionEditorModalState>({
  visible: false,
  exportMode: false,
  selectedExportFormat: null,
})

export function useExpressionEditorModal() {
  return {
    state,
    open(initialFormat: ExportFormat | null = null) {
      state.selectedExportFormat = initialFormat
      state.exportMode = false
      state.visible = true
    },
    close() {
      state.visible = false
      state.exportMode = false
      state.selectedExportFormat = null
    },
    startExport() {
      state.exportMode = true
    },
    cancelExport() {
      state.exportMode = false
    },
    setExportFormat(fmt: ExportFormat) {
      state.selectedExportFormat = fmt
    },
  }
}
