import { readonly, ref } from 'vue'
import { GetPreviewRotationSnap, SetPreviewRotationSnap } from '../../wailsjs/go/main/App'
import { createPreferencePersistence } from './preferencePersistence'

const interval = ref(5)
const persistence = createPreferencePersistence('旋转吸附间隔', '使用默认值', '当前设置仅在本次会话有效')

function isValid(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0.01
}

export function usePreviewRotationSnap() {
  persistence.loadOnce(GetPreviewRotationSnap, value => {
    if (isValid(value)) interval.value = value
  })

  function update(value: number) {
    if (!isValid(value)) return
    persistence.commit(() => { interval.value = value }, () => SetPreviewRotationSnap(value))
  }

  return { interval: readonly(interval), update }
}
