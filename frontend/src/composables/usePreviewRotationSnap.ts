import { readonly, ref } from 'vue'
import { GetPreviewRotationSnap, SetPreviewRotationSnap } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'

const interval = ref(5)
let initialized = false
let changed = false
let save = Promise.resolve()

function isValid(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0.01
}

export function usePreviewRotationSnap() {
  if (!initialized) {
    initialized = true
    GetPreviewRotationSnap().then((value) => {
      if (!changed && isValid(value)) interval.value = value
    }).catch((err) => {
      console.error('读取旋转吸附间隔失败', err)
      useMessage().warning('读取旋转吸附间隔失败，使用默认值')
    })
  }

  function update(value: number) {
    if (!isValid(value)) return
    changed = true
    interval.value = value
    save = save.then(() => SetPreviewRotationSnap(value)).catch((err) => {
      console.error('保存旋转吸附间隔失败', err)
      useMessage().warning('保存旋转吸附间隔失败，当前设置仅在本次会话有效')
    })
  }

  return { interval: readonly(interval), update }
}
