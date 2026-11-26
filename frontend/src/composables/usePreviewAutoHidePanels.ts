import { readonly, ref } from 'vue'
import { GetPreviewAutoHideLeftPanel, SetPreviewAutoHideLeftPanel, GetPreviewAutoHideRightPanel, SetPreviewAutoHideRightPanel } from '../../wailsjs/go/main/App'
import { createPreferencePersistence } from './preferencePersistence'

const leftEnabled = ref(false)
const rightEnabled = ref(false)
const leftPersistence = createPreferencePersistence('左侧栏自动隐藏设置', '使用默认选项', '当前选项仅在本次会话有效')
const rightPersistence = createPreferencePersistence('右侧栏自动隐藏设置', '使用默认选项', '当前选项仅在本次会话有效')

export function usePreviewAutoHidePanels() {
  leftPersistence.loadOnce(GetPreviewAutoHideLeftPanel, value => { leftEnabled.value = value })
  rightPersistence.loadOnce(GetPreviewAutoHideRightPanel, value => { rightEnabled.value = value })

  function updateLeft(value: boolean) {
    leftPersistence.commit(() => { leftEnabled.value = value }, () => SetPreviewAutoHideLeftPanel(value))
  }

  function updateRight(value: boolean) {
    rightPersistence.commit(() => { rightEnabled.value = value }, () => SetPreviewAutoHideRightPanel(value))
  }

  return { leftEnabled: readonly(leftEnabled), rightEnabled: readonly(rightEnabled), updateLeft, updateRight }
}
