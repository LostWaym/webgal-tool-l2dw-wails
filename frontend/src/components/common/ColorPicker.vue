<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import dropletIcon from '../../assets/icons/droplet.png'

export interface RGBColor {
  r: number
  g: number
  b: number
}

type DisplayMode = 'rgb' | 'hsv'

const props = withDefaults(
  defineProps<{
    color: RGBColor
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  (e: 'update:color', value: RGBColor): void
  (e: 'open-modal'): void
}>()

const mode = ref<DisplayMode>('rgb')

// ───────── 颜色转换 ─────────

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/** RGB(0-255) → HSV (H:0-360, S/V:0-100) */
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : (d / max) * 100
  const v = max * 100
  return {
    h: Math.round(h),
    s: Math.round(s),
    v: Math.round(v),
  }
}

/** HSV → RGB(0-255)。H:0-360, S/V:0-100 */
function hsvToRgb(h: number, s: number, v: number): RGBColor {
  const sN = s / 100
  const vN = v / 100
  const c = vN * sN
  const hh = (h % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hh >= 0 && hh < 1) {
    r = c
    g = x
  } else if (hh < 2) {
    r = x
    g = c
  } else if (hh < 3) {
    g = c
    b = x
  } else if (hh < 4) {
    g = x
    b = c
  } else if (hh < 5) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const m = vN - c
  return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255) }
}

const hsv = computed(() => rgbToHsv(props.color.r, props.color.g, props.color.b))

const hueHsl = computed(() => `hsl(${hsv.value.h}, 100%, 50%)`)

const rgbText = computed(() => `rgb(${props.color.r}, ${props.color.g}, ${props.color.b})`)

// ───────── SV 区域 ─────────

const svBox = ref<HTMLElement | null>(null)
const svSize = ref(0)
let svResizeObserver: ResizeObserver | null = null

function setSvSize() {
  if (!svBox.value) return
  svSize.value = svBox.value.clientWidth
}

onMounted(() => {
  if (!svBox.value) return
  setSvSize()
  svResizeObserver = new ResizeObserver(() => setSvSize())
  svResizeObserver.observe(svBox.value)
})

onBeforeUnmount(() => {
  svResizeObserver?.disconnect()
  svResizeObserver = null
})

function applySvFromEvent(e: PointerEvent) {
  if (props.disabled) return
  const rect = svBox.value?.getBoundingClientRect()
  if (!rect) return
  const w = rect.width || 1
  const h = rect.height || 1
  const x = Math.max(0, Math.min(w, e.clientX - rect.left))
  const y = Math.max(0, Math.min(h, e.clientY - rect.top))
  const s = (x / w) * 100
  const vN = 100 - (y / h) * 100
  const next = hsvToRgb(hsv.value.h, s, vN)
  emit('update:color', next)
}

const svDragging = ref(false)
function onSvPointerDown(e: PointerEvent) {
  if (props.disabled) return
  svDragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  applySvFromEvent(e)
}
function onSvPointerMove(e: PointerEvent) {
  if (!svDragging.value || props.disabled) return
  applySvFromEvent(e)
}
function onSvPointerUp() {
  svDragging.value = false
}

const svIndicatorStyle = computed(() => {
  const s = hsv.value.s
  const vN = hsv.value.v
  const x = (s / 100) * (svSize.value || 0)
  const y = (1 - vN / 100) * (svSize.value || 0)
  return {
    left: `${Math.max(0, Math.min(svSize.value, x) - 7)}px`,
    top: `${Math.max(0, Math.min(svSize.value, y) - 7)}px`,
  }
})

// ───────── 色相条 ─────────

const hueBar = ref<HTMLElement | null>(null)

function applyHueFromEvent(e: PointerEvent) {
  if (props.disabled) return
  const rect = hueBar.value?.getBoundingClientRect()
  if (!rect) return
  const h = rect.height || 1
  const y = Math.max(0, Math.min(h, e.clientY - rect.top))
  const degree = Math.round((y / h) * 360)
  // clamp 0-359，保留 360 用作轮回边界
  const hh = degree >= 360 ? 0 : degree
  const next = hsvToRgb(hh, hsv.value.s, hsv.value.v)
  emit('update:color', next)
}

const hueDragging = ref(false)
function onHuePointerDown(e: PointerEvent) {
  if (props.disabled) return
  hueDragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  applyHueFromEvent(e)
}
function onHuePointerMove(e: PointerEvent) {
  if (!hueDragging.value || props.disabled) return
  applyHueFromEvent(e)
}
function onHuePointerUp() {
  hueDragging.value = false
}

const hueIndicatorStyle = computed(() => {
  const hh = (hsv.value.h / 360) * (hueBar.value?.clientHeight || 180)
  return { top: `${Math.max(0, Math.min(hueBar.value?.clientHeight || 180, hh) - 7)}px` }
})

// ───────── 输入框 ─────────

function rgbChange(part: 'r' | 'g' | 'b', raw: string) {
  const n = clamp255(Number(raw))
  if (Number.isNaN(n)) return
  emit('update:color', { ...props.color, [part]: n })
}

function hsvChange(part: 'h' | 's' | 'v', raw: string) {
  const n = Number(raw)
  if (Number.isNaN(n)) return
  let hh = hsv.value.h
  let ss = hsv.value.s
  let vv = hsv.value.v
  if (part === 'h') {
    hh = Math.max(0, Math.min(360, Math.round(n)))
  } else if (part === 's') {
    ss = Math.max(0, Math.min(100, Math.round(n)))
  } else {
    vv = Math.max(0, Math.min(100, Math.round(n)))
  }
  emit('update:color', hsvToRgb(hh, ss, vv))
}

function onOpenModal() {
  if (props.disabled) return
  emit('open-modal')
}
</script>

<template>
  <div class="color-picker" :class="{ 'is-disabled': disabled }" @mousedown.stop>
    <!-- SV 选择区 + 色相条 -->
    <div class="cp-sv-row">
      <div
        ref="svBox"
        class="cp-sv"
        @pointerdown="onSvPointerDown"
        @pointermove="onSvPointerMove"
        @pointerup="onSvPointerUp"
        @pointercancel="onSvPointerUp"
      >
        <div class="cp-sv__bg" :style="{ '--cp-hue': hueHsl }" aria-hidden="true" />
        <span class="cp-sv__indicator" :style="svIndicatorStyle" aria-hidden="true" />
      </div>

      <div class="cp-hue-wrap">
        <div
          ref="hueBar"
          class="cp-hue"
          @pointerdown="onHuePointerDown"
          @pointermove="onHuePointerMove"
          @pointerup="onHuePointerUp"
          @pointercancel="onHuePointerUp"
        >
          <span class="cp-hue__indicator" :style="hueIndicatorStyle" aria-hidden="true" />
        </div>
        <button
          type="button"
          class="cp-eyedropper"
          :disabled="disabled"
          title="取色器（v1 占位）"
          aria-label="取色器（占位）"
          tabindex="-1"
        >
          <img :src="dropletIcon" alt="" />
        </button>
      </div>
    </div>

    <!-- 模式切换 + 输入 -->
    <div class="cp-row cp-mode-row">
      <div class="cp-mode">
        <button
          type="button"
          class="cp-mode__btn"
          :class="{ 'is-active': mode === 'rgb' }"
          @click="mode = 'rgb'"
        >
          RGB
        </button>
        <button
          type="button"
          class="cp-mode__btn"
          :class="{ 'is-active': mode === 'hsv' }"
          @click="mode = 'hsv'"
        >
          HSV
        </button>
      </div>

      <div class="cp-swatch" :style="{ background: rgbText }" :title="rgbText" />

      <button
        type="button"
        class="cp-modal-btn"
        :disabled="disabled"
        title="输入颜色代码"
        aria-label="输入颜色代码"
        @click="onOpenModal"
      >
        #
      </button>
    </div>

    <!-- 三个分量输入 -->
    <div v-if="mode === 'rgb'" class="cp-row cp-inputs">
      <label class="cp-input">
        <span class="cp-input__label">R</span>
        <input
          type="number"
          min="0"
          max="255"
          step="1"
          :value="color.r"
          :disabled="disabled"
          @input="(e: any) => rgbChange('r', e.target.value)"
        />
      </label>
      <label class="cp-input">
        <span class="cp-input__label">G</span>
        <input
          type="number"
          min="0"
          max="255"
          step="1"
          :value="color.g"
          :disabled="disabled"
          @input="(e: any) => rgbChange('g', e.target.value)"
        />
      </label>
      <label class="cp-input">
        <span class="cp-input__label">B</span>
        <input
          type="number"
          min="0"
          max="255"
          step="1"
          :value="color.b"
          :disabled="disabled"
          @input="(e: any) => rgbChange('b', e.target.value)"
        />
      </label>
    </div>

    <div v-else class="cp-row cp-inputs">
      <label class="cp-input">
        <span class="cp-input__label">H</span>
        <input
          type="number"
          min="0"
          max="360"
          step="1"
          :value="hsv.h"
          :disabled="disabled"
          @input="(e: any) => hsvChange('h', e.target.value)"
        />
      </label>
      <label class="cp-input">
        <span class="cp-input__label">S</span>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          :value="hsv.s"
          :disabled="disabled"
          @input="(e: any) => hsvChange('s', e.target.value)"
        />
      </label>
      <label class="cp-input">
        <span class="cp-input__label">V</span>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          :value="hsv.v"
          :disabled="disabled"
          @input="(e: any) => hsvChange('v', e.target.value)"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.color-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
  user-select: none;
}

.color-picker.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

/* ── SV + 色相条 ── */
.cp-sv-row {
  display: flex;
  gap: 6px;
}

.cp-sv {
  position: relative;
  flex: 1;
  aspect-ratio: 1 / 1;
  min-width: 0;
  border-radius: 4px;
  border: 1px solid #3a4150;
  cursor: crosshair;
  touch-action: none;
}

.cp-sv__bg {
  position: absolute;
  inset: 0;
  border-radius: 4px;
  background:
    linear-gradient(to bottom, transparent 0%, #000 100%),
    linear-gradient(to right, #ffffff 0%, var(--cp-hue, #ff0000) 100%);
}

.cp-sv__indicator {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: transparent;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

.cp-hue-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 18px;
}

.cp-hue {
  position: relative;
  flex: 1;
  width: 14px;
  min-height: 0;
  border-radius: 4px;
  border: 1px solid #3a4150;
  cursor: ns-resize;
  touch-action: none;
  background: linear-gradient(
    to bottom,
    #ff0000 0%,
    #ffff00 17%,
    #00ff00 33%,
    #00ffff 50%,
    #0000ff 67%,
    #ff00ff 83%,
    #ff0000 100%
  );
}

.cp-hue__indicator {
  position: absolute;
  left: -3px;
  width: 20px;
  height: 4px;
  border-radius: 2px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.cp-eyedropper {
  width: 18px;
  height: 18px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.6;
}

.cp-eyedropper img {
  width: 10px;
  height: 10px;
  display: block;
}

/* ── 模式 / 色块 / 模态触发 ── */
.cp-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cp-mode-row {
  justify-content: space-between;
}

.cp-mode {
  display: inline-flex;
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 4px;
  overflow: hidden;
}

.cp-mode__btn {
  padding: 3px 8px;
  background: transparent;
  border: none;
  color: #8a93a3;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.cp-mode__btn.is-active {
  background: #2f80ed;
  color: #fff;
}

.cp-swatch {
  flex: 1;
  height: 18px;
  border-radius: 3px;
  border: 1px solid #3a4150;
}

.cp-modal-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 3px;
  color: #e6e6e6;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.cp-modal-btn:hover {
  border-color: #2f80ed;
}

/* ── 输入框 ── */
.cp-inputs {
  display: flex;
  gap: 4px;
}

.cp-input {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 4px;
  padding: 0 6px;
  min-width: 0;
  transition: border-color 0.15s;
}

.cp-input:focus-within {
  border-color: #2f80ed;
}

.cp-input__label {
  color: #8a93a3;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  flex-shrink: 0;
}

.cp-input input {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 4px 0;
  background: transparent;
  border: none;
  color: #e6e6e6;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  outline: none;
}

.cp-input input::-webkit-outer-spin-button,
.cp-input input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.cp-input input[type='number'] {
  -moz-appearance: textfield;
}
</style>
