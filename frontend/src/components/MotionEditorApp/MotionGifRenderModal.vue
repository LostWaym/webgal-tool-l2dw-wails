<script setup lang="ts">
/**
 * GIF 渲染模态：配置输出 fps（决定采样步长）/帧范围/尺寸/底色等参数，
 * 点击渲染后逐帧抓取预览视口 → gif.js 编码 → 保存对话框选路径落盘。
 */
import { computed, ref, watch } from 'vue'
import { useMotionGifRenderModal, type GifSizeMode } from '../../composables/useMotionGifRenderModal'
import { useMotionEditorStore } from '../../stores/motionEditor'
import { useMessage } from '../../composables/useMessage'
import {
  computeSampleFrames,
  renderLanimToGif,
} from '../../utils/gifRender'
import { SaveGifFileDialog, WriteBase64File } from '../../../wailsjs/go/main/App'

const { state, close, setProgress, resetProgress, getBridge } = useMotionGifRenderModal()
const store = useMotionEditorStore()
const msg = useMessage()

watch(
  () => state.visible,
  (v) => {
    if (v) {
      state.startFrame = 0
      state.endFrame = Math.max(0, store.lanim.durationFrames - 1)
      state.rendering = false
      resetProgress()
    }
  },
)

const animFps = computed(() => store.lanim.fps || 60)
const durationFrames = computed(() => store.lanim.durationFrames)

const sampleFrames = computed(() =>
  computeSampleFrames(state.startFrame, state.endFrame, animFps.value, state.outFps),
)
const sampleCount = computed(() => sampleFrames.value.length)
const durationSec = computed(() =>
  durationFrames.value > 0 ? (durationFrames.value / animFps.value).toFixed(2) : '0',
)

const sizeModeOptions: Array<{ key: GifSizeMode; label: string }> = [
  { key: 'scale', label: '视口倍率' },
  { key: 'fixedWidth', label: '固定宽度' },
]

const repeatOptions = [
  { value: 0, label: '无限循环' },
  { value: -1, label: '不循环' },
  { value: 3, label: '循环 3 次' },
]

function clampFrame(text: string, fallback: number): number {
  const n = Math.round(Number(text))
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(durationFrames.value - 1, n))
}

const rendering = ref(false)
let abortFlag = false

async function onRender() {
  if (rendering.value) return
  const bridge = getBridge()
  if (!bridge) {
    msg.error('预览桥接未就绪')
    return
  }
  if (!sampleCount.value) {
    msg.warning('采样帧数为 0，请检查帧范围与输出 fps')
    return
  }
  rendering.value = true
  state.rendering = true
  abortFlag = false
  const startedPlayhead = store.playhead
  try {
    const vp = bridge.getViewportPixelSize()
    if (!vp) throw new Error('预览尚未加载模型')
    const outputWidth =
      state.sizeMode === 'scale'
        ? Math.max(16, Math.round(vp.width * state.scale))
        : Math.max(16, Math.round(state.fixedWidth))

    const result = await renderLanimToGif(
      bridge,
      store.lanim,
      {
        startFrame: state.startFrame,
        endFrame: state.endFrame,
        animFps: animFps.value,
        outFps: state.outFps,
        outputWidth,
        bgColor: state.bgColor,
        repeat: state.repeat,
        colors: state.colors,
        interframeDiff: state.interframeDiff,
      },
      (p) => setProgress(p.phase, p.percent, p.label),
      () => abortFlag,
      store.composerDefOf,
    )
    if (!result) {
      msg.info('渲染已中止')
      return
    }

    const defaultName = `${store.lanim.name || 'animation'}.gif`
    const picked = await SaveGifFileDialog(defaultName)
    if (!picked) {
      msg.info('已取消保存（渲染结果已丢弃）')
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = () => reject(fr.error)
      fr.readAsDataURL(result.blob)
    })
    const base64 = dataUrl.split(',')[1] ?? ''
    await WriteBase64File(picked, base64)
    msg.success(`GIF 已导出：${picked}（${result.frameCount} 帧 / ${result.width}×${result.height}）`)
    close()
  } catch (err) {
    msg.error(`渲染失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    rendering.value = false
    state.rendering = false
    resetProgress()
    // 恢复渲染前的播放头画面
    store.playhead = startedPlayhead
  }
}

function onAbort() {
  abortFlag = true
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="state.visible" class="mgr-mask" @click.self="close">
        <div class="mgr-modal" @click.stop>
          <header class="mgr-modal__header">
            <h2 class="mgr-modal__title">渲染 GIF</h2>
            <button
              class="mgr-icon-btn"
              aria-label="关闭"
              :disabled="state.rendering"
              @click="close"
            >
              ×
            </button>
          </header>

          <section class="mgr-modal__body">
            <div class="mgr-field">
              <span class="mgr-field__label">输出 fps</span>
              <input
                v-model.number="state.outFps"
                type="number"
                class="mgr-field__input"
                min="1"
                max="60"
                :disabled="state.rendering"
              />
              <span class="mgr-field__hint">动画 {{ animFps }}fps → 步长 {{ (animFps / Math.max(1, state.outFps)).toFixed(2) }} 帧</span>
            </div>

            <div class="mgr-field">
              <span class="mgr-field__label">帧范围</span>
              <input
                v-model.number="state.startFrame"
                type="number"
                class="mgr-field__input mgr-field__input--narrow"
                min="0"
                :max="durationFrames - 1"
                :disabled="state.rendering"
              />
              <span class="mgr-field__dash">~</span>
              <input
                v-model.number="state.endFrame"
                type="number"
                class="mgr-field__input mgr-field__input--narrow"
                min="0"
                :max="durationFrames - 1"
                :disabled="state.rendering"
              />
              <span class="mgr-field__hint">动画共 {{ durationFrames }} 帧 / {{ durationSec }}s</span>
            </div>

            <div class="mgr-field">
              <span class="mgr-field__label">输出尺寸</span>
              <div class="mgr-seg-list">
                <button
                  v-for="opt in sizeModeOptions"
                  :key="opt.key"
                  type="button"
                  class="mgr-seg-btn"
                  :class="{ 'mgr-seg-btn--active': state.sizeMode === opt.key }"
                  :disabled="state.rendering"
                  @click="state.sizeMode = opt.key"
                >
                  {{ opt.label }}
                </button>
              </div>
              <input
                v-if="state.sizeMode === 'scale'"
                v-model.number="state.scale"
                type="number"
                class="mgr-field__input mgr-field__input--narrow"
                min="0.1"
                max="4"
                step="0.1"
                :disabled="state.rendering"
              />
              <input
                v-else
                v-model.number="state.fixedWidth"
                type="number"
                class="mgr-field__input mgr-field__input--narrow"
                min="16"
                :disabled="state.rendering"
              />
              <span class="mgr-field__hint">{{ state.sizeMode === 'scale' ? '倍' : 'px' }}</span>
            </div>

            <div class="mgr-field">
              <span class="mgr-field__label">底色</span>
              <input v-model="state.bgColor" type="color" class="mgr-color" :disabled="state.rendering" />
              <span class="mgr-field__hint">GIF 不支持半透明，取不透明底色</span>
            </div>

            <div class="mgr-field">
              <span class="mgr-field__label">循环</span>
              <select v-model.number="state.repeat" class="mgr-field__input" :disabled="state.rendering">
                <option v-for="opt in repeatOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>

            <div class="mgr-field">
              <span class="mgr-field__label">色数</span>
              <select v-model.number="state.colors" class="mgr-field__input" :disabled="state.rendering">
                <option :value="256">256</option>
                <option :value="128">128</option>
                <option :value="64">64</option>
                <option :value="32">32</option>
              </select>
              <span class="mgr-field__hint">全动画共享调色板，越少体积越小</span>
            </div>

            <label class="mgr-check">
              <input v-model="state.interframeDiff" type="checkbox" :disabled="state.rendering" />
              <span>帧间差分（只编码变化像素，体积更小）</span>
            </label>

            <div class="mgr-preview">
              将采样 <b>{{ sampleCount }}</b> 帧（{{ state.outFps }}fps，每帧 {{ Math.round(1000 / Math.max(1, state.outFps)) }}ms）
            </div>

            <div v-if="state.rendering" class="mgr-progress">
              <div class="mgr-progress__bar">
                <div
                  class="mgr-progress__fill"
                  :class="{ 'mgr-progress__fill--encode': state.progressPhase === 'encode' }"
                  :style="{ width: Math.round(state.progressPercent * 100) + '%' }"
                />
              </div>
              <span class="mgr-progress__label">{{ state.progressLabel }}</span>
            </div>
          </section>

          <footer class="mgr-modal__footer">
            <button v-if="!state.rendering" type="button" class="mgr-btn" @click="close">取消</button>
            <button v-else type="button" class="mgr-btn" @click="onAbort">中止</button>
            <button
              type="button"
              class="mgr-btn mgr-btn--primary"
              :disabled="state.rendering || !sampleCount"
              @click="onRender"
            >
              {{ state.rendering ? '渲染中…' : '开始渲染' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.mgr-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.mgr-modal {
  background-color: rgba(29, 32, 38, 0.96);
  color: #e6e6e6;
  width: min(480px, 92vw);
  border-radius: 8px;
  border: 1px solid rgba(60, 68, 80, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.mgr-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  flex-shrink: 0;
}

.mgr-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
  color: #ffffff;
}

.mgr-icon-btn {
  background-color: transparent;
  border: none;
  color: #e6e6e6;
  font-size: 22px;
  line-height: 1;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
}

.mgr-icon-btn:hover {
  background-color: rgba(53, 60, 71, 0.42);
  color: #ffffff;
}

.mgr-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mgr-modal__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mgr-field {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mgr-field__label {
  width: 72px;
  font-size: 13px;
  color: #8a93a3;
  flex-shrink: 0;
}

.mgr-field__input {
  padding: 6px 10px;
  background: #1e222a;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 13px;
  outline: none;
  width: 90px;
}

.mgr-field__input:focus {
  border-color: #2f80ed;
}

.mgr-field__input:disabled {
  opacity: 0.5;
}

.mgr-field__input--narrow {
  width: 70px;
}

.mgr-field__dash {
  color: #8a93a3;
}

.mgr-field__hint {
  font-size: 12px;
  color: #8a93a3;
}

.mgr-seg-list {
  display: flex;
  gap: 0;
}

.mgr-seg-btn {
  padding: 5px 12px;
  background: #2c313a;
  border: 1px solid #3a4150;
  color: #8a93a3;
  font-size: 12px;
  cursor: pointer;
}

.mgr-seg-btn:first-child {
  border-radius: 4px 0 0 4px;
}

.mgr-seg-btn:last-child {
  border-radius: 0 4px 4px 0;
  border-left: none;
}

.mgr-seg-btn--active {
  background: #1f3a5f;
  border-color: #2f80ed;
  color: #ffffff;
}

.mgr-seg-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mgr-color {
  width: 40px;
  height: 28px;
  padding: 0;
  border: 1px solid #3a4150;
  border-radius: 4px;
  background: #1e222a;
  cursor: pointer;
}

.mgr-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #cfd4dc;
  cursor: pointer;
}

.mgr-check input:disabled {
  opacity: 0.5;
}

.mgr-preview {
  font-size: 13px;
  color: #cfd4dc;
}

.mgr-preview b {
  color: #5fa8ff;
}

.mgr-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mgr-progress__bar {
  flex: 1;
  height: 8px;
  background: #1e222a;
  border-radius: 4px;
  overflow: hidden;
}

.mgr-progress__fill {
  height: 100%;
  background: #2f80ed;
  transition: width 0.1s linear;
}

.mgr-progress__fill--encode {
  background: #27ae60;
}

.mgr-progress__label {
  font-size: 12px;
  color: #8a93a3;
  min-width: 90px;
  text-align: right;
}

.mgr-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(60, 68, 80, 0.35);
}

.mgr-btn {
  padding: 6px 16px;
  background: #2c313a;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 13px;
  cursor: pointer;
}

.mgr-btn:hover {
  background: #343b49;
}

.mgr-btn--primary {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #ffffff;
}

.mgr-btn--primary:hover {
  background: #1a5bb8;
}

.mgr-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
