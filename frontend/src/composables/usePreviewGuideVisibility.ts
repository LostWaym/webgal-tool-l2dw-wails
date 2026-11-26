import { readonly, ref } from 'vue'
import { GetPreviewGuidesVisible, SetPreviewGuidesVisible } from '../../wailsjs/go/main/App'
import { createPreferencePersistence } from './preferencePersistence'

export const PREVIEW_GUIDE_VISIBILITY_KEYS = 'Ctrl + M'
const alwaysShowGuides = ref(false)
const persistence = createPreferencePersistence('游标显示设置', '使用默认选项', '当前选项仅在本次会话有效')

export function usePreviewGuideVisibility() {
  persistence.loadOnce(GetPreviewGuidesVisible, visible => { alwaysShowGuides.value = visible })

  function update(visible: boolean) {
    persistence.commit(() => { alwaysShowGuides.value = visible }, () => SetPreviewGuidesVisible(visible))
  }

  return { alwaysShowGuides: readonly(alwaysShowGuides), update }
}
