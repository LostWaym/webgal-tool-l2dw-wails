<script setup lang="ts">
import { ref, watch } from 'vue'
import EditConfirmModal from './Modal/EditConfirmModal.vue'
import EditModelList from './EditModelList.vue'
import EditStage from './EditStage.vue'
import EditActionPanel from './EditActionPanel.vue'
import ResizeHandle from './ResizeHandle.vue'
import EditBatchAddModal from './Modal/EditBatchAddModal.vue'
import EditBatchModifyModal from './Modal/EditBatchModifyModal.vue'
import MessageHost from '../common/MessageHost.vue'

/**
 * 模型编辑器窗口的根布局。
 *
 * 水平三栏：左 EditModelList | 中 EditStage | 右 EditActionPanel
 *
 * 两个 ResizeHandle 分别夹在三个面板之间：
 *   - left  handle：拖动 dx → left  panel 宽度 +dx（min 200, max 600）
 *   - right handle：拖动 dx → right panel 宽度 -dx（min 200, max 600）
 *
 * 中间 stage 用 flex:1 自动占满剩余空间，宽度由两侧面板大小决定。
 *
 * EditBatchAddModal 通过 Teleport 渲染到 body，但组件本身挂在这里，
 * 以保证 modal 的 useBatchAddModal 单例状态被该编辑器窗口独占。
 */

const LEFT_MIN = 200
const LEFT_MAX = 600
const RIGHT_MIN = 200
const RIGHT_MAX = 600
const DEFAULT_LEFT = 280
const DEFAULT_RIGHT = 340

function readWidth(side: string, fallback: number, min: number, max: number) {
  try {
    const value = Number(localStorage.getItem(`modelEditor.${side}Width`))
    return Number.isFinite(value) && value >= min ? Math.min(max, value) : fallback
  } catch { return fallback }
}
const leftWidth = ref(readWidth('left', DEFAULT_LEFT, LEFT_MIN, LEFT_MAX))
const rightWidth = ref(readWidth('right', DEFAULT_RIGHT, RIGHT_MIN, RIGHT_MAX))
watch([leftWidth, rightWidth], ([left, right]) => {
  try {
    localStorage.setItem('modelEditor.leftWidth', String(left))
    localStorage.setItem('modelEditor.rightWidth', String(right))
  } catch { /* 本地偏好不可用不阻塞编辑 */ }
})

function onLeftDrag(dx: number) {
  const next = leftWidth.value + dx
  leftWidth.value = Math.max(LEFT_MIN, Math.min(LEFT_MAX, next))
}

function onRightDrag(dx: number) {
  const next = rightWidth.value - dx
  rightWidth.value = Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, next))
}
</script>

<template>
  <div class="edit-app">
    <EditModelList class="edit-app__left" :style="{ width: leftWidth + 'px' }" />
    <ResizeHandle side="left" @drag="onLeftDrag" />
    <EditStage class="edit-app__center" />
    <ResizeHandle side="right" @drag="onRightDrag" />
    <EditActionPanel class="edit-app__right" :style="{ width: rightWidth + 'px' }" />

    <!-- 批量添加动作/表情 全屏模态 -->
    <EditBatchAddModal />

    <!-- 批量修改动作/表情 全屏模态 -->
    <EditBatchModifyModal />
    <EditConfirmModal />

    <!-- 全局气泡提示 -->
    <MessageHost />
  </div>
</template>

<style>
.edit-app {
  display: flex;
  flex-direction: row;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--ui-window);
}

.edit-app__left {
  flex-shrink: 0;
  border-right: 1px solid var(--ui-line);
  min-width: 0;
}

.edit-app__center {
  flex: 1;
  min-width: 0;
  height: 100%;
}

.edit-app__right {
  flex-shrink: 0;
  border-left: 1px solid var(--ui-line);
  min-width: 0;
}
</style>
