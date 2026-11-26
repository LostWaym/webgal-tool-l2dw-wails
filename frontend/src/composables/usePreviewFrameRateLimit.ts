import { readonly, ref } from 'vue'
import { GetPreviewFrameRateLimit, SetPreviewFrameRateLimit } from '../../wailsjs/go/main/App'
import { createPreferencePersistence } from './preferencePersistence'

const DEFAULT_PREVIEW_FRAME_RATE_LIMIT = 60
export const PREVIEW_FRAME_RATE_LIMITS = [30, DEFAULT_PREVIEW_FRAME_RATE_LIMIT, 90, 120, 0] as const
type PreviewFrameRateLimit = typeof PREVIEW_FRAME_RATE_LIMITS[number]

const frameRateLimit = ref<PreviewFrameRateLimit>(DEFAULT_PREVIEW_FRAME_RATE_LIMIT)
const persistence = createPreferencePersistence('预览帧率限制', '使用默认选项', '当前选项仅在本次会话有效')

function isFrameRateLimit(value: number | null): value is PreviewFrameRateLimit {
  return PREVIEW_FRAME_RATE_LIMITS.some((option) => option === value)
}

export function usePreviewFrameRateLimit() {
  persistence.loadOnce(GetPreviewFrameRateLimit, value => {
    if (isFrameRateLimit(value)) frameRateLimit.value = value
  })

  function update(value: number) {
    if (!isFrameRateLimit(value)) return
    persistence.commit(() => { frameRateLimit.value = value }, () => SetPreviewFrameRateLimit(value))
  }

  return { frameRateLimit: readonly(frameRateLimit), update }
}
