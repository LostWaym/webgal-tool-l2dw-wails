import { readonly, ref } from 'vue'
import { GetPreviewGuideOverflow, SetPreviewGuideOverflow } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'

const length = ref(256)
let initialized = false
let changed = false
let save = Promise.resolve()

function isValid(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

export function usePreviewGuideOverflow() {
  if (!initialized) {
    initialized = true
    GetPreviewGuideOverflow().then((value) => {
      if (!changed && isValid(value)) length.value = value
    }).catch((err) => {
      console.error('读取游标溢出长度失败', err)
      useMessage().warning('读取游标溢出长度失败，使用默认值')
    })
  }

  function update(value: number) {
    if (!isValid(value)) return
    changed = true
    length.value = value
    save = save.then(() => SetPreviewGuideOverflow(value)).catch((err) => {
      console.error('保存游标溢出长度失败', err)
      useMessage().warning('保存游标溢出长度失败，当前设置仅在本次会话有效')
    })
  }

  return { length: readonly(length), update }
}
