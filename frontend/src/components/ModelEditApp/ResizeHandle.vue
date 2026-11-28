<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
/**
 * 通用垂直分隔条。
 *
 * 拖动时：
 *   - side='left'  → 拖动距离 dx 加到目标宽度（向右拖让 left panel 变宽）
 *   - side='right' → 拖动距离 dx 减到目标宽度（向左拖让 right panel 变宽）
 *
 * 复用 ModelActionPanel.vue:250-268 的 document-level 监听模式，
 * 避免拖出元素边界后丢失 mousemove。
 */
const props = defineProps<{
  side: 'left' | 'right'
}>()

const emit = defineEmits<{
  (e: 'drag', deltaX: number): void
  (e: 'end'): void
}>()

let lastX = 0
let active = false
let previousCursor = ''
let previousUserSelect = ''

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  onMouseUp()
  active = true
  previousCursor = document.body.style.cursor
  previousUserSelect = document.body.style.userSelect
  e.preventDefault()
  lastX = e.clientX
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  window.addEventListener('blur', onMouseUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onMouseMove(e: MouseEvent) {
  const dx = e.clientX - lastX
  lastX = e.clientX
  emit('drag', dx)
}

function onMouseUp() {
  if (!active) return
  active = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('blur', onMouseUp)
  document.body.style.cursor = previousCursor
  document.body.style.userSelect = previousUserSelect
  emit('end')
}
onBeforeUnmount(onMouseUp)
</script>

<template>
  <div
    class="resize-handle"
    :class="['resize-handle--' + props.side]"
    @mousedown="onMouseDown"
  />
</template>

<style scoped>
.resize-handle {
  position: relative;
  flex-shrink: 0;
  width: 4px;
  background: transparent;
  transition: background 0.15s;
  z-index: 1;
}

.resize-handle:hover {
  background: var(--ui-accent); color: var(--ui-on-accent);
}

.resize-handle--left {
  cursor: col-resize;
}

.resize-handle--right {
  cursor: col-resize;
}
</style>
