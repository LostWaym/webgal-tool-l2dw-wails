import { readonly, ref } from 'vue'
import { GetPreviewFocusBoxOffsetY, SetPreviewFocusBoxOffsetY } from '../../wailsjs/go/main/App'
import { createPreferencePersistence } from './preferencePersistence'

const offsetY = ref(384)
const persistence = createPreferencePersistence('注视框偏移', '使用默认值', '当前选项仅在本次会话有效')

export function usePreviewFocusBoxOffset() {
  persistence.loadOnce(GetPreviewFocusBoxOffsetY, value => {
    if (value !== null && Number.isFinite(value)) offsetY.value = value
  })

  function update(value: number) {
    if (!Number.isFinite(value)) return
    persistence.commit(() => { offsetY.value = value }, () => SetPreviewFocusBoxOffsetY(value))
  }

  return { offsetY: readonly(offsetY), update }
}
