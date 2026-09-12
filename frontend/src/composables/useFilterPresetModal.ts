import { reactive, ref } from 'vue'

/**
 * 全局"滤镜预设"模态控制状态。
 *
 * 通过 reactive 单例共享，让 ModelActionPanel 调用 open()，
 * 而由 App.vue 在顶层挂载 FilterPresetModal 来消费 visible。
 *
 * state 保存当前选中的预设文件名；currentDraft 持有正在编辑的
 * 滤镜数据副本（与磁盘上的原始值分离，编辑不会自动写回）。
 */

export interface FilterPresetModalState {
  visible: boolean
  /** 当前选中的预设文件名（含 .json 后缀），null 表示未选中 */
  selectedFilename: string | null
}

const state = reactive<FilterPresetModalState>({
  visible: false,
  selectedFilename: null,
})

/** 当前正在编辑的滤镜数据（编辑区双向绑定的对象） */
const currentDraft = ref<Record<string, number> | null>(null)

/** 磁盘上读取的原始数据（用于"重置"按钮回滚） */
const originalSnapshot = ref<Record<string, number> | null>(null)

export function useFilterPresetModal() {
  return {
    state,
    currentDraft,
    originalSnapshot,
    open() {
      state.visible = true
    },
    close() {
      state.visible = false
      state.selectedFilename = null
      currentDraft.value = null
      originalSnapshot.value = null
    },
  }
}
