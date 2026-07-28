<script setup lang="ts">
import { computed, onBeforeUnmount, useCssVars } from 'vue'
import {
  messageState,
  removeMessage,
  MESSAGE_OPACITY,
  type MessageItem,
  type MessagePlacement,
} from '../../composables/useMessage'

useCssVars(() => ({ '--msg-opacity': String(MESSAGE_OPACITY) }))

/** 固定渲染全部 6 个 placement 的容器，避免列表从 1 → 0 时外层容器被卸载导致 TransitionGroup 来不及播 leave 动画 */
const ALL_PLACEMENTS: readonly MessagePlacement[] = [
  'top',
  'top-left',
  'top-right',
  'bottom',
  'bottom-left',
  'bottom-right',
]
const itemsByPlacement = computed(() => {
  const map = new Map<MessagePlacement, MessageItem[]>()
  for (const p of ALL_PLACEMENTS) map.set(p, [])
  for (const item of messageState.items) {
    const arr = map.get(item.placement)
    if (arr) arr.push(item)
  }
  return map
})

function itemsOf(p: MessagePlacement): MessageItem[] {
  return itemsByPlacement.value.get(p) ?? []
}

const timers = new Map<number, number>()

function ensureTimer(item: MessageItem) {
  if (item.duration <= 0) return
  if (timers.has(item.id)) return
  const handle = window.setTimeout(() => {
    timers.delete(item.id)
    removeMessage(item.id)
  }, item.duration)
  timers.set(item.id, handle)
}

function close(item: MessageItem) {
  const handle = timers.get(item.id)
  if (handle !== undefined) {
    window.clearTimeout(handle)
    timers.delete(item.id)
  }
  removeMessage(item.id)
}

// 立即为已存在 & 新加入的消息安排关闭定时器
// 这里用 watchEffect 的轻量替代：直接在 mount 时给每个 item 安排一次，后续由 addMessage 自身或外部触发
// 由于 messageState.items 是 reactive，外层可订阅；但为避免引入 watch 的额外开销，这里使用 onMounted 时统一扫描：
import { onMounted, watch } from 'vue'
onMounted(() => {
  for (const item of messageState.items) ensureTimer(item)
})

watch(
  () => messageState.items.map((i) => i.id).join(','),
  () => {
    for (const item of messageState.items) ensureTimer(item)
    const ids = new Set(messageState.items.map((i) => i.id))
    for (const id of timers.keys()) {
      if (!ids.has(id)) {
        window.clearTimeout(timers.get(id)!)
        timers.delete(id)
      }
    }
  },
)

onBeforeUnmount(() => {
  for (const h of timers.values()) window.clearTimeout(h)
  timers.clear()
})

function placementClass(p: MessagePlacement) {
  return `msg-host msg-host--${p}`
}
</script>

<template>
  <Teleport to="body">
    <div
      v-for="p in ALL_PLACEMENTS"
      :key="p"
      :class="placementClass(p)"
    >
      <TransitionGroup name="msg-fade" tag="div" class="msg-host__stack">
        <div
          v-for="item in itemsOf(p)"
          :key="item.id"
          class="msg-item"
          :class="[`msg-item--${item.type}`]"
          role="alert"
        >
          <span class="msg-item__icon" aria-hidden="true" />
          <span class="msg-item__text">{{ item.text }}</span>
          <span v-if="item.repeatNum > 1" class="msg-item__badge">{{ item.repeatNum }}</span>
          <button
            v-if="item.showClose"
            type="button"
            class="msg-item__close"
            aria-label="关闭"
            @click="close(item)"
          >
            ×
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.msg-host {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  justify-content: center;
}
.msg-host--top {
  top: 16px;
  left: 0;
  right: 0;
}
.msg-host--top-left {
  top: 16px;
  left: 16px;
  justify-content: flex-start;
}
.msg-host--top-right {
  top: 16px;
  right: 16px;
  justify-content: flex-end;
}
.msg-host--bottom {
  bottom: 16px;
  left: 0;
  right: 0;
}
.msg-host--bottom-left {
  bottom: 16px;
  left: 16px;
  justify-content: flex-start;
}
.msg-host--bottom-right {
  bottom: 16px;
  right: 16px;
  justify-content: flex-end;
}

.msg-host__stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.msg-host--top-left .msg-host__stack,
.msg-host--top-right .msg-host__stack,
.msg-host--bottom-left .msg-host__stack,
.msg-host--bottom-right .msg-host__stack {
  align-items: stretch;
}

.msg-item {
  pointer-events: none;
  opacity: var(--msg-opacity, 0.8);
  min-width: 200px;
  max-width: 480px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  background: #ffffff;
  color: #303133;
  border: 1px solid #ebeef5;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
  font-size: 14px;
  line-height: 1.4;
  word-break: break-all;
}

.msg-item__icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}
.msg-item--success .msg-item__icon {
  background: #67c23a;
}
.msg-item--success .msg-item__icon::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 6px;
  width: 4px;
  height: 7px;
  border-right: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: rotate(45deg);
}
.msg-item--info .msg-item__icon {
  background: #909399;
}
.msg-item--info .msg-item__icon::after {
  content: 'i';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  font-style: italic;
  font-weight: 700;
  font-size: 11px;
  font-family: Georgia, serif;
  line-height: 1;
}
.msg-item--warning .msg-item__icon {
  background: #e6a23c;
}
.msg-item--warning .msg-item__icon::after {
  content: '!';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
}
.msg-item--error .msg-item__icon {
  background: #f56c6c;
}
.msg-item--error .msg-item__icon::after {
  content: '×';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  line-height: 1;
}

.msg-item__text {
  flex: 1;
  min-width: 0;
}

.msg-item__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #f56c6c;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.msg-item__close {
  pointer-events: auto;
  margin-left: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: #c0c4cc;
  font-size: 16px;
  line-height: 1;
  padding: 2px 4px;
}
.msg-item__close:hover {
  color: #606266;
}

.msg-item--success {
  background: #f0f9eb;
  border-color: #e1f3d8;
  color: #67c23a;
}
.msg-item--info {
  background: #f4f4f5;
  border-color: #e9e9eb;
  color: #909399;
}
.msg-item--warning {
  background: #fdf6ec;
  border-color: #faecd8;
  color: #e6a23c;
}
.msg-item--error {
  background: #fef0f0;
  border-color: #fde2e2;
  color: #f56c6c;
}

.msg-fade-enter-active,
.msg-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.msg-fade-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.msg-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
