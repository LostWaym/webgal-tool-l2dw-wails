import { readonly, ref } from 'vue'
import { GetPreviewGuidesVisible, SetPreviewGuidesVisible } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'

export const PREVIEW_GUIDE_VISIBILITY_KEYS = 'Ctrl + M'
const alwaysShowGuides = ref(false)
let initialized = false
let changed = false
let save = Promise.resolve()

export function usePreviewGuideVisibility() {
  if (!initialized) {
    initialized = true
    GetPreviewGuidesVisible().then((visible) => {
      if (!changed) alwaysShowGuides.value = visible
    }).catch((err) => {
      console.error('读取游标显示设置失败', err)
      useMessage().warning('读取游标显示设置失败，使用默认选项')
    })
  }

  function update(visible: boolean) {
    changed = true
    alwaysShowGuides.value = visible
    save = save.then(() => SetPreviewGuidesVisible(visible)).catch((err) => {
      console.error('保存游标显示设置失败', err)
      useMessage().warning('保存游标显示设置失败，当前选项仅在本次会话有效')
    })
  }

  return { alwaysShowGuides: readonly(alwaysShowGuides), update }
}
