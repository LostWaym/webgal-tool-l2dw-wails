<script setup lang="ts">
import { ref, watch } from 'vue'
import { useColorPickerModal } from '../../composables/useColorPickerModal'
import { useMessage } from '../../composables/useMessage'
import type { RGBColor } from './ColorPicker.vue'

/**
 * 颜色代码输入模态。
 *
 * 输入格式（任选其一）：
 * - 逗号整数分隔 RGB：`255,128,0` / `0xFF,0x80,0x00` / `255, 128, 0`
 * - 十六进制：`#FF8800` / `FF8800`（前缀 `#` 可选）
 *
 * 解析失败 → useMessage().error 弹气泡提示，不关闭模态。
 * 解析成功 → 通过 useColorPickerModal.triggerConfirm 回调订阅方（ModelActionPanel 写回 store）。
 */

const { state, close, triggerConfirm } = useColorPickerModal()
const msg = useMessage()

const input = ref('')
const errorText = ref('')

// 打开时用当前颜色预填一个合理示例
watch(
  () => state.visible,
  (v) => {
    if (v) {
      const { r, g, b } = state.current
      input.value = hexFromRgb(r, g, b)
      errorText.value = ''
    }
  },
)

function hexFromRgb(r: number, g: number, b: number): string {
  const toH = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${toH(r)}${toH(g)}${toH(b)}`.toUpperCase()
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/**
 * 解析颜色代码字符串 → {r, g, b}（整数 0-255）
 * 支持 hex (#FF8800 / FF8800) 和逗号分隔 (255,128,0 / 0xFF,0x80,0x00)
 */
function parseColor(raw: string): RGBColor | null {
  const s = raw.trim()
  if (!s) return null

  // 路径 1：十六进制
  const hex = s.startsWith('#') ? s.slice(1) : s
  if (/^[0-9a-fA-F]+$/.test(hex)) {
    const len = hex.length
    let r = 0
    let g = 0
    let b = 0
    if (len === 3) {
      r = parseInt(hex[0] + hex[0], 16)
      g = parseInt(hex[1] + hex[1], 16)
      b = parseInt(hex[2] + hex[2], 16)
    } else if (len === 6) {
      r = parseInt(hex.slice(0, 2), 16)
      g = parseInt(hex.slice(2, 4), 16)
      b = parseInt(hex.slice(4, 6), 16)
    } else if (len === 8) {
      // 标准 #RRGGBBAA 格式：前 6 位是 RGB，末 2 位为 alpha 忽略
      r = parseInt(hex.slice(0, 2), 16)
      g = parseInt(hex.slice(2, 4), 16)
      b = parseInt(hex.slice(4, 6), 16)
    } else {
      return null
    }
    if ([r, g, b].some((n) => Number.isNaN(n))) return null
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b) }
  }

  // 路径 2：逗号分隔（支持 0x 前缀和十进制）
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim())
    if (parts.length !== 3) return null
    const nums = parts.map((p) => {
      const low = p.toLowerCase()
      if (low.startsWith('0x')) return parseInt(low.slice(2), 16)
      return parseInt(low, 10)
    })
    if (nums.some((n) => Number.isNaN(n))) return null
    return { r: clamp255(nums[0]), g: clamp255(nums[1]), b: clamp255(nums[2]) }
  }

  return null
}

function onConfirm() {
  const parsed = parseColor(input.value)
  if (!parsed) {
    errorText.value = '颜色代码格式无效'
    msg.error('颜色代码格式无效')
    return
  }
  errorText.value = ''
  triggerConfirm(parsed)
  close()
}

function onClose() {
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    onConfirm()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
  }
}

function onMaskClick(e: MouseEvent) {
  if (e.target === e.currentTarget) onClose()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="state.visible" class="cp-modal-mask" @click="onMaskClick">
        <div class="cp-modal" @click.stop>
          <header class="cp-modal__header">
            <h2 class="cp-modal__title">输入颜色代码</h2>
            <button class="icon-btn" aria-label="关闭" @click="onClose">×</button>
          </header>

          <section class="cp-modal__body">
            <label class="cp-modal__label">
              <span>颜色代码</span>
              <input
                ref="inputEl"
                v-model="input"
                type="text"
                class="cp-modal__input"
                placeholder="例如 #FF8800 / FF8800 / 255,128,0 / 0xFF,0x80,0x00"
                spellcheck="false"
                autocomplete="off"
                @keydown="onKeydown"
              />
            </label>
            <div v-if="errorText" class="cp-modal__error">{{ errorText }}</div>
            <div class="cp-modal__hint">
              支持十六进制（<code>#FF8800</code>，前缀 <code>#</code> 可选）与逗号分隔
              （<code>255,128,0</code>，支持 <code>0xFF</code> 前缀）。
            </div>
          </section>

          <footer class="cp-modal__footer">
            <button class="card-btn" @click="onClose">取消</button>
            <button class="card-btn card-btn--primary" @click="onConfirm">确认</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cp-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}

.cp-modal {
  width: min(420px, 92vw);
  padding: 16px;
  background-color: rgba(29, 32, 38, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  color: #e6e6e6;
}

.cp-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.cp-modal__title {
  margin: 0;
  font-size: 15px;
  color: #ffffff;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #8a93a3;
  font-size: 16px;
  cursor: pointer;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e6e6e6;
}

.cp-modal__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.cp-modal__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #8a93a3;
}

.cp-modal__input {
  width: 100%;
  padding: 8px 10px;
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.cp-modal__input:focus {
  border-color: #2f80ed;
}

.cp-modal__error {
  font-size: 12px;
  color: #ff6b6b;
}

.cp-modal__hint {
  font-size: 11px;
  color: #6b7280;
  line-height: 1.5;
}

.cp-modal__hint code {
  background: #262b34;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
  color: #e6e6e6;
}

.cp-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.card-btn {
  padding: 6px 14px;
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.card-btn:hover {
  background: #2c313a;
}

.card-btn--primary {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #fff;
}

.card-btn--primary:hover {
  background: #3f90ff;
  border-color: #3f90ff;
}

/* 渐入渐出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
