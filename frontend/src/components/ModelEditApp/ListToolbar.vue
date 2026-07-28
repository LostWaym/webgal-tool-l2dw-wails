<script setup lang="ts">
import { PickMotionFile, PickExpressionFile } from '../../../wailsjs/go/main/App'
import { useWmdlModelEditorStore, deriveNameFromFile } from '../../stores/wmdlModelEditor'
import { pathDirname } from '../../path_utils'

/**
 * 动作 / 表情列表上方的置顶操作区。
 *
 * props.kind 决定按钮文案 & 调用的文件 picker / 模态触发语义：
 *   - 'motion'    → PickMotionFile、模态打开"动作"批量添加
 *   - 'expression' → PickExpressionFile、模态打开"表情"批量添加
 *
 * 行为：
 *   - "删除全部"  → window.confirm 二次确认后清空当前选中模型的对应数组
 *   - "添加单个"  → 调对应的文件 picker，把所选文件 push 进 store
 *   - "批量添加"  → 触发 batch-add 事件，由父级打开 EditBatchAddModal
 */
type Kind = 'motion' | 'expression'

const props = defineProps<{
  kind: Kind
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'batch-add'): void
}>()

const store = useWmdlModelEditorStore()

const labels: Record<Kind, { single: string; clearAll: string; clearConfirm: string; syncAll: string; syncConfirm: string }> = {
  motion: {
    single: '添加动作',
    clearAll: '删除全部动作',
    clearConfirm: '确定要删除全部动作吗？',
    syncAll: '同步所有模型',
    syncConfirm: '是否要将本模型的动作同步到其他所有模型？',
  },
  expression: {
    single: '添加表情',
    clearAll: '删除全部表情',
    clearConfirm: '确定要删除全部表情吗？',
    syncAll: '同步所有模型',
    syncConfirm: '是否要将本模型的表情同步到其他所有模型？',
  },
}

async function onClearAll() {
  const m = store.selectedModel
  if (!m) return
  const label = labels[props.kind]
  if (!window.confirm(label.clearConfirm)) return
  if (props.kind === 'motion') {
    store.clearMotions()
  } else {
    store.clearExpressions()
  }
}

async function onAddSingle() {
  const m = store.selectedModel
  if (!m) return
  const abs = props.kind === 'motion'
    ? await PickMotionFile()
    : await PickExpressionFile()
  if (!abs) return

  // store.addMotion / addExpression 使用绝对路径；运行时通过 /abs_files/ 路由加载。
  const name = deriveNameFromFile(abs, props.kind)
  if (props.kind === 'motion') {
    store.addMotion(name, abs)
  } else {
    store.addExpression(name, abs)
  }
}

function onBatchAdd() {
  emit('batch-add')
}

function onSyncAll() {
  const m = store.selectedModel
  if (!m) return
  const label = labels[props.kind]
  if (!window.confirm(label.syncConfirm)) return
  if (props.kind === 'motion') {
    store.syncMotionsToOthers()
  } else {
    store.syncExpressionsToOthers()
  }
}

// 暴露 pathDirname 给模板侧使用（保留引用避免 noUnused 警告）
void pathDirname
</script>

<template>
  <div class="list-toolbar">
    <button
      class="toolbar-btn toolbar-btn--danger"
      :disabled="props.disabled"
      @click="onClearAll"
    >
      {{ labels[props.kind].clearAll }}
    </button>
    <button
      class="toolbar-btn"
      :disabled="props.disabled"
      @click="onAddSingle"
    >
      {{ labels[props.kind].single }}
    </button>
    <button
      class="toolbar-btn toolbar-btn--primary"
      :disabled="props.disabled"
      @click="onBatchAdd"
    >
      批量添加
    </button>
    <button
      class="toolbar-btn toolbar-btn--sync"
      :disabled="props.disabled"
      @click="onSyncAll"
    >
      {{ labels[props.kind].syncAll }}
    </button>
  </div>
</template>

<style scoped>
.list-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #2c313a;
  flex-shrink: 0;
  background: #1d2026;
}

.toolbar-btn {
  flex: 1;
  padding: 6px 8px;
  background: #2c313a;
  color: #e6e6e6;
  border: 1px solid #2c313a;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s ease;
}

.toolbar-btn:hover:not(:disabled) {
  background: #353c47;
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn--primary {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #fff;
}

.toolbar-btn--primary:hover:not(:disabled) {
  background: #3f90ff;
}

.toolbar-btn--sync {
  background: #1f6f43;
  border-color: #1f6f43;
  color: #fff;
}

.toolbar-btn--sync:hover:not(:disabled) {
  background: #258a52;
  border-color: #258a52;
}

.toolbar-btn--danger:hover:not(:disabled) {
  background: #b03a3a;
  border-color: #b03a3a;
}
</style>