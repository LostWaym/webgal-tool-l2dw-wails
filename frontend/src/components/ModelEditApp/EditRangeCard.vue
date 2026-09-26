<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ParamCalc } from '../../stores/wmdlTypes'

/**
 * 可复用的"参数/部件卡片"。
 *
 * 卡片内部采用垂直布局：
 *   - 顶部：参数名（name）；左上角可选的 calc 切换按钮（仅 showCalcSwitch=true 显示）
 *   - 中部：进度条
 *       左：最小值   中：当前值（单击可输入）   右：最大值
 *   - 拖动进度条区域：横向拖动改变当前值（实时 emit）
 *   - 单击中心值：进入 <input> 数值输入态
 *       Enter → clamp([min, max]) → emit
 *       Esc   → 退出输入态
 *       blur  → 退出输入态
 *
 * 通过 v-model 暴露当前值；父组件负责把更新写回 Live2D coreModel。
 */

// calc 切换按钮上的单字标签 & 循环顺序：set → add → mult → set ...
const CALC_LABELS: Record<ParamCalc, string> = {
  set: '覆',
  add: '叠',
  mult: '乘',
}
const CALC_ORDER: ParamCalc[] = ['set', 'add', 'mult']

const props = withDefaults(
  defineProps<{
    name: string
    min: number
    max: number
    modelValue: number
    precision?: number
    /** 是否显示持续性高亮（如用户已设置 override）。与拖动时的 is-dragging 高亮独立。 */
    highlight?: boolean
    /** 是否在卡片标题右侧显示"重置"按钮。 */
    showReset?: boolean
    /** 是否显示左上角的 calc 切换按钮（仅演出编辑器需要）。默认 false，避免污染其他场景。 */
    showCalcSwitch?: boolean
    /** 当前 calc 类型。默认 'set'。 */
    calcType?: ParamCalc
  }>(),
  {
    precision: 3,
    highlight: false,
    showReset: false,
    showCalcSwitch: false,
    calcType: 'set',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
  (e: 'reset'): void
  (e: 'update:calcType', value: ParamCalc): void
}>()

const trackEl = ref<HTMLDivElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)

const isDragging = ref(false)
const isEditing = ref(false)
const editingText = ref('')

let dragPointerId = -1
let dragStartX = 0
let dragStartValue = 0

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

function format(v: number): string {
  return Number.isFinite(v) ? v.toFixed(props.precision) : '0'
}

function nextCalc(c: ParamCalc): ParamCalc {
  const idx = CALC_ORDER.indexOf(c)
  return CALC_ORDER[(idx + 1) % CALC_ORDER.length]
}

function onCalcClick() {
  emit('update:calcType', nextCalc(props.calcType))
}

// 进度条占比：[min, max] → [0, 1]
const fillRatio = computed(() => {
  const range = props.max - props.min
  if (range <= 0) return 0
  return clamp((props.modelValue - props.min) / range, 0, 1)
})

function onPointerDown(e: PointerEvent) {
  // 进入输入态时让 input 自身处理点击，避免触发拖拽
  if (isEditing.value) return
  e.preventDefault()
  isDragging.value = true
  dragPointerId = e.pointerId
  dragStartX = e.clientX
  dragStartValue = props.modelValue
  trackEl.value?.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return
  if (!trackEl.value) return
  const rect = trackEl.value.getBoundingClientRect()
  if (rect.width <= 0) return
  // 鼠标当前位置对应"理论值" = 拖动起点值 + 位移比例 × 总范围
  // 这样无论鼠标在进度条什么位置按下的，拖动连续且直观
  const ratio = (e.clientX - dragStartX) / rect.width
  const raw = dragStartValue + ratio * (props.max - props.min)
  emit('update:modelValue', clamp(raw, props.min, props.max))
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return
  isDragging.value = false
  try {
    trackEl.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  dragPointerId = -1
}

async function startEdit() {
  if (isDragging.value) return
  isEditing.value = true
  editingText.value = format(props.modelValue)
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

function commitEdit() {
  const num = Number(editingText.value)
  if (Number.isFinite(num)) {
    emit('update:modelValue', clamp(num, props.min, props.max))
  }
  isEditing.value = false
}

function cancelEdit() {
  isEditing.value = false
}
</script>

<template>
  <div class="range-card" :class="{ 'is-dragging': isDragging, 'is-highlight': props.highlight }">
    <!-- 重置按钮：绝对定位脱离 flex 流，按钮显隐不改变卡片尺寸 -->
    <button
      v-show="showReset"
      type="button"
      class="range-card__reset"
      title="还原到初始值"
      @click.stop="emit('reset')"
    >
      ↺
    </button>

    <!--
      calc 切换按钮：仅当 showCalcSwitch=true 时渲染；默认不污染其他场景。
      循环切换 set → add → mult；不同 calc 渲染不同背景色便于一眼区分。
    -->
    <button
      v-if="showCalcSwitch"
      type="button"
      class="range-card__calc"
      :class="`range-card__calc--${calcType}`"
      :title="`合成方式：${calcType}（点击切换）`"
      @click.stop="onCalcClick"
    >
      {{ CALC_LABELS[calcType] }}
    </button>

    <div class="range-card__header">
      <span class="range-card__name" :title="name">{{ name }}</span>
    </div>

    <div
      ref="trackEl"
      class="range-card__track"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="range-card__fill" :style="{ width: fillRatio * 100 + '%' }" />
      <div
        class="range-card__thumb"
        :style="{ left: fillRatio * 100 + '%' }"
      />
    </div>

    <div class="range-card__values">
      <span class="value-label value-label--min">{{ format(min) }}</span>
      <span v-if="!isEditing" class="value-label value-label--cur" @click="startEdit">
        {{ format(modelValue) }}
      </span>
      <input
        v-else
        ref="inputEl"
        v-model="editingText"
        class="value-input"
        type="number"
        :step="Math.pow(10, -precision)"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="cancelEdit"
        @blur="commitEdit"
      />
      <span class="value-label value-label--max">{{ format(max) }}</span>
    </div>
  </div>
</template>

<style scoped>
.range-card {
  position: relative;
  background: #14171c;
  border: 1px solid #2c313a;
  border-radius: 4px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  user-select: none;
}

.range-card.is-dragging {
  border-color: #2f80ed;
}

.range-card.is-highlight {
  border-color: #2f80ed;
}

/* 未高亮时（即无 override）整体降饱和，让"未改 vs 已改"一眼可辨 */
.range-card:not(.is-highlight) .range-card__track {
  background: #232830;
}

.range-card:not(.is-highlight) .range-card__fill {
  background: #4a5160;
}

.range-card:not(.is-highlight) .range-card__thumb {
  background: #8a93a3;
  border-color: #4a5160;
}

.range-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.range-card__name {
  flex: 1 1 auto;
  min-width: 0;
  /* 持续预留重置按钮宽度，避免名称宽度随按钮显隐而抖动 */
  padding-right: 22px;
  font-size: 12px;
  font-weight: 500;
  color: #e6e6e6;
  font-family: ui-monospace, SFMono-Regular, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
 * calc 切换按钮：左上角绝对定位，尺寸尽量小但字清晰。
 * 默认不渲染（showCalcSwitch=false），padding-left 用于当按钮出现时避免
 * 名称被遮挡；其它场景（按钮不出现）通过额外 class 不撑开 padding。
 */
.range-card__calc {
  position: absolute;
  top: 6px;
  left: 6px;
  min-width: 18px;
  height: 16px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #1d2026;
  border: 1px solid #2c313a;
  border-radius: 3px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  font-family: ui-monospace, SFMono-Regular, monospace;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.range-card__calc:hover {
  border-color: #2f80ed;
}

/* 启用 calc 按钮时给名称预留左侧空间，避免遮挡 */
.range-card:has(.range-card__calc) .range-card__name {
  padding-left: 26px;
}

.range-card__calc--set {
  background: rgba(47, 128, 237, 0.25);
  border-color: rgba(47, 128, 237, 0.6);
  color: #5fa8ff;
}

.range-card__calc--add {
  background: rgba(46, 160, 67, 0.25);
  border-color: rgba(46, 160, 67, 0.6);
  color: #5fcc7f;
}

.range-card__calc--mult {
  background: rgba(224, 144, 41, 0.25);
  border-color: rgba(224, 144, 41, 0.6);
  color: #f0a050;
}

.range-card__reset {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #1d2026;
  border: 1px solid #2c313a;
  border-radius: 3px;
  color: #e6e6e6;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  user-select: none;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.range-card__reset:hover {
  border-color: #2f80ed;
  color: #2f80ed;
  background: #14171c;
}

.range-card__track {
  position: relative;
  height: 8px;
  background: #2c313a;
  border-radius: 4px;
  cursor: ew-resize;
  touch-action: none;
}

.range-card__fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: #2f80ed;
  border-radius: 4px;
  pointer-events: none;
}

.range-card__thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  background: #e6e6e6;
  border: 1px solid #2f80ed;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.range-card__values {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.value-label {
  color: #8a93a3;
}

.value-label--min {
  flex: 0 0 auto;
}

.value-label--max {
  flex: 0 0 auto;
}

.value-label--cur {
  flex: 1 1 auto;
  text-align: center;
  color: #e6e6e6;
  background: #1d2026;
  border: 1px solid #2c313a;
  border-radius: 3px;
  padding: 2px 4px;
  cursor: text;
  font-weight: 500;
}

.value-label--cur:hover {
  border-color: #2f80ed;
}

.value-input {
  flex: 1 1 auto;
  background: #14171c;
  color: #e6e6e6;
  border: 1px solid #2f80ed;
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  text-align: center;
  outline: none;
  width: 100%;
  min-width: 0;
}
</style>