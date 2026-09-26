import { reactive } from 'vue'

/**
 * 演出编辑器（独立窗口）的导出覆盖层状态。
 *
 * 与原 useExpressionEditorModal 相比：
 *   - 移除了 `visible`（独立窗口始终可见，不再有显隐概念）；
 *   - 保留 `exportMode / selectedExportFormat`，驱动导出覆盖层 UI；
 *   - reactive 单例，整个 ActorEditApp 共享。
 *
 * 入口：ActorEditApp 在顶层挂载即可，没有"打开/关闭"。
 */
export type ExportFormat = 'exp' | 'exp3'

export interface ActorEditorState {
  exportMode: boolean
  selectedExportFormat: ExportFormat | null
}

const state = reactive<ActorEditorState>({
  exportMode: false,
  selectedExportFormat: null,
})

export function useActorEditorState() {
  return {
    state,
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
