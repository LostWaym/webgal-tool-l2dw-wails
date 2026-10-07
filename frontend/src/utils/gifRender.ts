import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { sampleLanim, type LanimFile } from '../stores/motionEditor'
import type { ComposerDef } from './motionComposors'
import type { ParamCalc } from '../stores/wmdlTypes'

/** 抓帧用：调用方（MotionEditApp）注入的预览桥接能力。 */
export interface GifCaptureBridge {
  /** 逐帧写参数并驱动模型 update 求值。 */
  applyParameters(params: Array<{ id: string; val: number; calc: ParamCalc }>): void
  /** 抓取当前视口画面到指定尺寸的离屏 canvas。 */
  captureViewportFrame(bgColor: string, targetW: number, targetH: number): HTMLCanvasElement | null
  /** 视口画布像素尺寸（含 DPR）。 */
  getViewportPixelSize(): { width: number; height: number } | null
}

export interface GifRenderOptions {
  /** 动画起始帧（含）。 */
  startFrame: number
  /** 动画结束帧（含）。 */
  endFrame: number
  /** 动画 fps（lanim.fps）。 */
  animFps: number
  /** 输出 fps（决定采样步长 = animFps / outFps）。 */
  outFps: number
  /** 输出宽度像素；高度按视口宽高比等比算出。 */
  outputWidth: number
  /** 底色（不透明）。 */
  bgColor: string
  /** gif repeat：0=永远循环，-1=不循环，n=次数。 */
  repeat: number
  /** 全局调色板色数上限（32~256）。 */
  colors: number
  /** 帧间差分：未变化像素写透明索引（dispose=1 露出上一帧），大幅减小体积。 */
  interframeDiff: boolean
}

export interface GifRenderProgress {
  /** 阶段：capture=抓帧，encode=索引化+编码。 */
  phase: 'capture' | 'encode'
  /** 0~1。 */
  percent: number
  /** 当前阶段描述文本。 */
  label: string
}

export interface GifRenderResult {
  blob: Blob
  frameCount: number
  width: number
  height: number
}

export function computeSampleFrames(startFrame: number, endFrame: number, animFps: number, outFps: number): number[] {
  const safeFps = Math.max(1, animFps)
  const step = Math.max(1, safeFps / Math.max(0.1, outFps))
  const frames: number[] = []
  for (let f = startFrame; f <= endFrame; f += step) {
    frames.push(Math.min(endFrame, Math.round(f)))
    if (Math.round(f) >= endFrame) break
  }
  return frames
}

/** RGBA 像素是否与上一帧完全一致（逐字节比较，用于帧去重）。 */
function rgbaEquals(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** 从全部帧中均匀采样至多 8 帧，拼接后构建共享调色板（保证后到帧的颜色也被覆盖）。 */
function buildPalette(frameData: Uint8ClampedArray[], maxColors: number): number[][] {
  const usable = maxColors - 1 // 预留 1 个透明索引
  const sampleCount = Math.min(8, frameData.length)
  const stride = Math.max(1, Math.floor(frameData.length / sampleCount))
  const chunks: Uint8ClampedArray[] = []
  for (let i = 0; i < frameData.length; i += stride) {
    chunks.push(frameData[i])
  }
  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0)
  const merged = new Uint8ClampedArray(totalLen)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  return quantize(merged, usable, { format: 'rgb565' })
}

/**
 * 帧间差分：与上一帧索引图比较，未变化像素写透明索引（TRANSPARENT_IDX），
 * 配合 dispose=1 让解码器保留上一帧内容，视觉等效全帧且 LZW 压缩率极高。
 */
const TRANSPARENT_IDX = 255

function diffIndexFrame(
  cur: Uint8Array,
  prev: Uint8Array | null,
): Uint8Array {
  const out = new Uint8Array(cur.length)
  for (let i = 0; i < cur.length; i++) {
    out[i] = prev && prev[i] === cur[i] ? TRANSPARENT_IDX : cur[i]
  }
  return out
}

/**
 * 逐帧采样 → 写参数并 update → 抓帧 → 全局调色板索引化 → 帧去重 → gifenc 编码。
 * 相比 gif.js：全动画共享一个调色板 + 重复帧合并 delay，显著减小体积。
 */
export async function renderLanimToGif(
  bridge: GifCaptureBridge,
  lanim: LanimFile,
  opts: GifRenderOptions,
  onProgress: (p: GifRenderProgress) => void,
  shouldAbort: () => boolean,
  composerDefOf: (id: string) => ComposerDef | null = () => null,
): Promise<GifRenderResult | null> {
  const viewport = bridge.getViewportPixelSize()
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error('预览尚未就绪，无法抓帧')
  }
  const outW = Math.max(1, Math.round(opts.outputWidth))
  const outH = Math.max(1, Math.round(outW * (viewport.height / viewport.width)))

  const frames = computeSampleFrames(opts.startFrame, opts.endFrame, opts.animFps, opts.outFps)
  if (!frames.length) throw new Error('采样帧列表为空，请检查帧范围')

  const delay = Math.max(20, Math.round(1000 / Math.max(1, opts.outFps)))

  // ── 阶段1：抓帧（RGBA 数据） ──────────────────────────────────────────────
  const frameData: Uint8ClampedArray[] = []
  for (let i = 0; i < frames.length; i++) {
    if (shouldAbort()) return null
    const frame = frames[i]
    const sampled = sampleLanim(lanim, frame, composerDefOf)
    const params: Array<{ id: string; val: number; calc: ParamCalc }> = []
    sampled.forEach((val, id) => params.push({ id, val, calc: 'set' }))
    bridge.applyParameters(params)
    const canvas = bridge.captureViewportFrame(opts.bgColor, outW, outH)
    if (!canvas) throw new Error(`第 ${i + 1} 帧抓取失败`)
    const ctx = canvas.getContext('2d')!
    frameData.push(ctx.getImageData(0, 0, outW, outH).data)
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0))
    onProgress({
      phase: 'capture',
      percent: (i + 1) / frames.length,
      label: `抓帧 ${i + 1}/${frames.length}`,
    })
  }

  // ── 阶段2：全局调色板索引化 + 去重/差分 + 编码 ────────────────────────────
  if (shouldAbort()) return null
  return new Promise<GifRenderResult | null>((resolve, reject) => {
    // 让出主线程让进度先刷新
    setTimeout(() => {
      try {
        if (shouldAbort()) {
          resolve(null)
          return
        }
        const maxColors = Math.max(2, Math.min(256, Math.round(opts.colors)))
        const palette = buildPalette(frameData, maxColors)
        const gif = GIFEncoder()
        let written = 0
        let pendingDelay = 0
        let prevIndex: Uint8Array | null = null

        for (let i = 0; i < frameData.length; i++) {
          const isLast = i === frameData.length - 1
          const dup = i > 0 && rgbaEquals(frameData[i], frameData[i - 1])
          if (dup && !isLast) {
            // 重复帧：不写入，delay 累加到下一帧
            pendingDelay += delay
            continue
          }
          const fullIndex = applyPalette(frameData[i], palette, 'rgb565')
          const useDiff = opts.interframeDiff && prevIndex !== null
          const index = useDiff ? diffIndexFrame(fullIndex, prevIndex) : fullIndex
          prevIndex = fullIndex
          gif.writeFrame(index, outW, outH, {
            palette: written === 0 ? [...palette, [0, 0, 0]] : undefined,
            delay: delay + pendingDelay,
            repeat: opts.repeat,
            transparent: useDiff,
            transparentIndex: TRANSPARENT_IDX,
            dispose: useDiff ? 1 : -1,
          })
          pendingDelay = 0
          written++
          onProgress({
            phase: 'encode',
            percent: (i + 1) / frameData.length,
            label: `索引化 ${i + 1}/${frameData.length}`,
          })
        }
        gif.finish()
        const bytes = gif.bytes()
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/gif' })
        resolve({
          blob,
          frameCount: written,
          width: outW,
          height: outH,
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }, 0)
  })
}
