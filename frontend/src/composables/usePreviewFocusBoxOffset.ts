import { readonly, ref } from 'vue'
import { GetPreviewFocusBoxOffsetY, SetPreviewFocusBoxOffsetY } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'

const offsetY = ref(384)
let initialized = false
let changed = false
let save = Promise.resolve()

export function usePreviewFocusBoxOffset() {
  if (!initialized) {
    initialized = true
    GetPreviewFocusBoxOffsetY().then((value) => {
      if (!changed && value !== null && Number.isFinite(value)) offsetY.value = value
    }).catch((err) => {
      console.error('读取注视框偏移失败', err)
      useMessage().warning('读取注视框偏移失败，使用默认值')
    })
  }

  function update(value: number) {
    if (!Number.isFinite(value)) return
    changed = true
    offsetY.value = value
    save = save.then(() => SetPreviewFocusBoxOffsetY(value)).catch((err) => {
      console.error('保存注视框偏移失败', err)
      useMessage().warning('保存注视框偏移失败，当前选项仅在本次会话有效')
    })
  }

  return { offsetY: readonly(offsetY), update }
}
