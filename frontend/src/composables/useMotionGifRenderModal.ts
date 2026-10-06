import { reactive } from 'vue'
import type { GifCaptureBridge } from '../utils/gifRender'

export type GifSizeMode = 'scale' | 'fixedWidth'

export interface MotionGifRenderModalState {
  visible: boolean
  /** 输出 fps（采样步长 = animFps / outFps）。 */
  outFps: number
  /** 动画帧范围（含两端）。 */
  startFrame: number
  endFrame: number
  /** 尺寸模式：scale=视口倍率 / fixedWidth=固定输出宽度。 */
  sizeMode: GifSizeMode
  scale: number
  fixedWidth: number
  /** 底色（不透明）。 */
  bgColor: string
  /** gif repeat：0=永远循环，-1=不循环，n=次数。 */
  repeat: number
  /** 全局调色板色数上限（32~256）。 */
  colors: number
  /** 帧间差分：未变化像素写透明索引，配合 dispose=1 减小体积。 */
  interframeDiff: boolean
  /** 渲染进行中。 */
  rendering: boolean
  progressPhase: 'idle' | 'capture' | 'encode'
  progressPercent: number
  progressLabel: string
}

const state = reactive<MotionGifRenderModalState>({
  visible: false,
  outFps: 12,
  startFrame: 0,
  endFrame: 0,
  sizeMode: 'scale',
  scale: 1,
  fixedWidth: 480,
  bgColor: '#ffffff',
  repeat: 0,
  colors: 128,
  interframeDiff: true,
  rendering: false,
  progressPhase: 'idle',
  progressPercent: 0,
  progressLabel: '',
})

/** 抓帧桥接，由 MotionEditApp 在挂载后注册。 */
let bridge: GifCaptureBridge | null = null

export function useMotionGifRenderModal() {
  return {
    state,
    setBridge(b: GifCaptureBridge | null) {
      bridge = b
    },
    getBridge(): GifCaptureBridge | null {
      return bridge
    },
    open(defaultEndFrame: number) {
      state.endFrame = defaultEndFrame
      state.startFrame = 0
      state.rendering = false
      state.progressPhase = 'idle'
      state.progressPercent = 0
      state.progressLabel = ''
      state.visible = true
    },
    close() {
      if (state.rendering) return
      state.visible = false
    },
    setProgress(phase: 'capture' | 'encode', percent: number, label: string) {
      state.progressPhase = phase
      state.progressPercent = percent
      state.progressLabel = label
    },
    resetProgress() {
      state.progressPhase = 'idle'
      state.progressPercent = 0
      state.progressLabel = ''
    },
  }
}
