<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

/**
 * 注视（focus）2D 位置选择器。
 * 正方形区域 + 圆球，点击 / 拖动定位；中心为 (0,0)，左上角 (-1,-1)，右下角 (1,1)。
 * 圆球移动范围内缩小球半径，保证不超出组件边界。
 */

const DOT_SIZE = 14
const DOT_RADIUS = DOT_SIZE / 2

const props = withDefaults(
  defineProps<{
    x?: number
    y?: number
    disabled?: boolean
  }>(),
  {
    x: 0,
    y: 0,
    disabled: false,
  },
)

const emit = defineEmits<{
  (e: 'update:x', value: number): void
  (e: 'update:y', value: number): void
}>()

const boxEl = ref<HTMLElement | null>(null)
const boxSize = ref(0)
const dragging = ref(false)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!boxEl.value) return
  observer = new ResizeObserver((entries) => {
    boxSize.value = entries[0]?.contentRect.width ?? 0
  })
  observer.observe(boxEl.value)
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})

function clamp(v: number, min: number, max: number): number {
  return Math.max(Math.min(v, max), min)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** 圆球中心像素位置（值域 [-1,1] 映射到内缩半径后的范围，y 向上为正） */
const dotStyle = computed(() => {
  const inner = Math.max(boxSize.value - DOT_SIZE, 0)
  const cx = ((props.x + 1) / 2) * inner + DOT_RADIUS
  const cy = ((1 - props.y) / 2) * inner + DOT_RADIUS
  return { transform: `translate(${cx - DOT_RADIUS}px, ${cy - DOT_RADIUS}px)` }
})

const coordText = computed(
  () => `(${props.x.toFixed(2)}, ${props.y.toFixed(2)})`,
)

function applyPosition(e: PointerEvent) {
  const rect = boxEl.value?.getBoundingClientRect()
  if (!rect) return
  const innerW = Math.max(rect.width - DOT_SIZE, 1)
  const innerH = Math.max(rect.height - DOT_SIZE, 1)
  const nx = clamp(((e.clientX - rect.left - DOT_RADIUS) / innerW) * 2 - 1, -1, 1)
  const ny = clamp(-(((e.clientY - rect.top - DOT_RADIUS) / innerH) * 2 - 1), -1, 1)
  emit('update:x', round2(nx))
  emit('update:y', round2(ny))
}

function onPointerDown(e: PointerEvent) {
  if (props.disabled) return
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  applyPosition(e)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value || props.disabled) return
  applyPosition(e)
}

function onPointerUp() {
  dragging.value = false
}
</script>

<template>
  <div class="focus-picker" :class="{ 'is-disabled': disabled }">
    <div
      ref="boxEl"
      class="focus-picker__box"
      @mousedown.stop
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <span class="focus-picker__coord" aria-hidden="true">{{ coordText }}</span>
      <span class="focus-picker__dot" :style="dotStyle" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.focus-picker {
  padding: 16px;
}

.focus-picker.is-disabled {
  opacity: 0.5;
}

.focus-picker.is-disabled .focus-picker__box {
  cursor: default;
  pointer-events: none;
}

.focus-picker__box {
  position: relative;
  width: 100%;
  max-width: 180px;
  max-height: 180px;
  margin: 0 auto;
  aspect-ratio: 1 / 1;
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 8px;
  cursor: crosshair;
  touch-action: none;
  overflow: hidden;
}

.focus-picker__box::before,
.focus-picker__box::after {
  content: '';
  position: absolute;
  background: rgba(255, 255, 255, 0.07);
  pointer-events: none;
}

.focus-picker__box::before {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
}

.focus-picker__box::after {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
}

.focus-picker__dot {
  position: absolute;
  left: 0;
  top: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #2f80ed;
  box-shadow: 0 0 0 2px #fff, 0 2px 6px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

.focus-picker__coord {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 1;
  padding: 2px 5px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 4px;
  color: #8a93a3;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  pointer-events: none;
}
</style>
