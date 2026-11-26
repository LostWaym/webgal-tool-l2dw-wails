import { readonly, ref } from 'vue'
import { GetPreviewGuideOverflow, SetPreviewGuideOverflow } from '../../wailsjs/go/main/App'
import { createPreferencePersistence } from './preferencePersistence'

const length = ref(256)
const persistence = createPreferencePersistence('游标溢出长度', '使用默认值', '当前设置仅在本次会话有效')

function isValid(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

export function usePreviewGuideOverflow() {
  persistence.loadOnce(GetPreviewGuideOverflow, value => {
    if (isValid(value)) length.value = value
  })

  function update(value: number) {
    if (!isValid(value)) return
    persistence.commit(() => { length.value = value }, () => SetPreviewGuideOverflow(value))
  }

  return { length: readonly(length), update }
}
