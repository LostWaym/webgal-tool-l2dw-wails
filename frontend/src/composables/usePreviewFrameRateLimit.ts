import { readonly, ref } from 'vue'
import { GetPreviewFrameRateLimit, SetPreviewFrameRateLimit } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'

const DEFAULT_PREVIEW_FRAME_RATE_LIMIT = 60
export const PREVIEW_FRAME_RATE_LIMITS = [30, DEFAULT_PREVIEW_FRAME_RATE_LIMIT, 90, 120, 0] as const
type PreviewFrameRateLimit = typeof PREVIEW_FRAME_RATE_LIMITS[number]

const frameRateLimit = ref<PreviewFrameRateLimit>(DEFAULT_PREVIEW_FRAME_RATE_LIMIT)
let initialized = false
let changed = false
let save = Promise.resolve()

function isFrameRateLimit(value: number | null): value is PreviewFrameRateLimit {
  return PREVIEW_FRAME_RATE_LIMITS.some((option) => option === value)
}

export function usePreviewFrameRateLimit() {
  if (!initialized) {
    initialized = true
    GetPreviewFrameRateLimit().then((value) => {
      if (!changed && isFrameRateLimit(value)) frameRateLimit.value = value
    }).catch((err) => {
      console.error('读取预览帧率限制失败', err)
      useMessage().warning('读取预览帧率限制失败，使用默认选项')
    })
  }

  function update(value: number) {
    if (!isFrameRateLimit(value)) return
    changed = true
    frameRateLimit.value = value
    save = save.then(() => SetPreviewFrameRateLimit(value)).catch((err) => {
      console.error('保存预览帧率限制失败', err)
      useMessage().warning('保存预览帧率限制失败，当前选项仅在本次会话有效')
    })
  }

  return { frameRateLimit: readonly(frameRateLimit), update }
}
