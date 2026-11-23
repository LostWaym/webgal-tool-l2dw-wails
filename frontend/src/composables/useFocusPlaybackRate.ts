import { ref } from 'vue'

const STORAGE_KEY = 'l2dw.focusPlaybackRate'
export const MIN_FOCUS_PLAYBACK_RATE = 0.1
export const MAX_FOCUS_PLAYBACK_RATE = 4
const DEFAULT_RATE = 1

function readRate(): number {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === null || !value.trim()) return DEFAULT_RATE
    const rate = Number(value)
    if (Number.isFinite(rate) && rate >= MIN_FOCUS_PLAYBACK_RATE && rate <= MAX_FOCUS_PLAYBACK_RATE) return rate
  } catch (error) {
    console.warn('读取专注预览倍速失败', error)
  }
  return DEFAULT_RATE
}

const savedRate = ref(readRate())

export function useFocusPlaybackRate() {
  function setRate(rate: number) {
    if (!Number.isFinite(rate) || rate < MIN_FOCUS_PLAYBACK_RATE || rate > MAX_FOCUS_PLAYBACK_RATE) return
    savedRate.value = rate
    try {
      localStorage.setItem(STORAGE_KEY, String(rate))
    } catch (error) {
      console.warn('保存专注预览倍速失败', error)
    }
  }

  return { savedRate, setRate }
}
