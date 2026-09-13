<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 可复用的"数值输入控件"。
 *
 * 解决原生 <input type="number"> 的两个糟糕体验：
 *  1. 想删除整个值，必须先按到 0，再删除才能清空
 *  2. 想输入 0.05，输入到 0.0 时光标会卡死或被强制解释为 0
 *
 * 设计思路（参考 EditRangeCard）：
 *  - 平时以纯文本方式展示格式化后的数值（只读，无 input 元素参与）
 *  - 单击进入编辑模式，渲染一个临时 <input type="text">，
 *    内部以"字符串"维护输入值，原生 number 的解析副作用不会触发
 *  - Enter / 点击外部 提交：尝试解析，解析失败保留旧值
 *  - Esc 取消编辑：还原原始值
 */

const props = withDefaults(
  defineProps<{
    modelValue: number
    /** 步进值（仅展示 / 透传给 input，不参与逻辑）。 */
    step?: number
    /** 最小值（可省略）。 */
    min?: number
    /** 最大值（可省略）。 */
    max?: number
    /** 小数位数。默认 2。 */
    precision?: number
    /** 编辑失焦 / 回车时若超出范围是否回退到原值（false=clamp 提交）。默认 clamp。 */
    rejectOverflow?: boolean
  }>(),
  {
    step: 1,
    precision: 2,
    rejectOverflow: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()

const isEditing = ref(false)
const editingText = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

function clamp(v: number, lo: number | undefined, hi: number | undefined): number {
  let r = v
  if (typeof lo === 'number' && Number.isFinite(lo) && r < lo) r = lo
  if (typeof hi === 'number' && Number.isFinite(hi) && r > hi) r = hi
  return r
}

function format(v: number): string {
  if (!Number.isFinite(v)) return '0'
  // 用 toFixed 保证稳定显示 precision 位
  return Number(v).toFixed(props.precision)
}

const displayText = computed(() => format(props.modelValue))

async function startEdit() {
  if (isEditing.value) return
  isEditing.value = true
  editingText.value = format(props.modelValue)
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

function commitEdit() {
  const raw = editingText.value.trim()
  // 空字符串 = 取消
  if (raw === '') {
    isEditing.value = false
    return
  }
  const num = Number(raw)
  if (!Number.isFinite(num)) {
    isEditing.value = false
    return
  }
  if (props.rejectOverflow) {
    const overMin = typeof props.min === 'number' && num < props.min
    const overMax = typeof props.max === 'number' && num > props.max
    if (overMin || overMax) {
      isEditing.value = false
      return
    }
  }
  const clamped = clamp(num, props.min, props.max)
  // 浮点比较 + 四舍五入到 precision，避免 0.05 → 0.050000000000000044
  const rounded = Number(clamped.toFixed(props.precision))
  if (rounded !== props.modelValue) emit('update:modelValue', rounded)
  isEditing.value = false
}

function cancelEdit() {
  isEditing.value = false
}

// 仅在"编辑中"时监听 document 的 pointerdown，捕获阶段触发。
// 点击 input 内部（含 mousedown 微调位置）不会触发 → 不会误退出。
function onDocPointerDown(e: PointerEvent) {
  if (!isEditing.value) return
  const target = e.target as Node | null
  if (inputEl.value && target && inputEl.value.contains(target)) return
  commitEdit()
}

watch(isEditing, (editing) => {
  if (editing) {
    document.addEventListener('pointerdown', onDocPointerDown, true)
  } else {
    document.removeEventListener('pointerdown', onDocPointerDown, true)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <input
    v-if="isEditing"
    ref="inputEl"
    v-model="editingText"
    type="text"
    class="number-input number-input--editing"
    :step="step"
    :min="min"
    :max="max"
    @keydown.enter.prevent="commitEdit"
    @keydown.esc.prevent="cancelEdit"
  />
  <span
    v-else
    class="number-input number-input--display"
    role="textbox"
    tabindex="0"
    @click="startEdit"
    @keydown.enter.prevent="startEdit"
  >{{ displayText }}</span>
</template>

<style scoped>
.number-input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 6px;
  color: #e6e6e6;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
  font-family: inherit;
}

.number-input--display {
  display: inline-block;
  cursor: text;
  text-align: left;
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.number-input--display:hover {
  border-color: #2f80ed;
}

.number-input--display:focus {
  border-color: #2f80ed;
}

.number-input--editing {
  width: 100%;
  border-color: #2f80ed;
  background: #1c2028;
  color: #f0f0f0;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
  text-align: left;
  font-variant-numeric: tabular-nums;
}
</style>
