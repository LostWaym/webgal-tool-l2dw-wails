<script setup lang="ts">
import ListToolbar from './ListToolbar.vue'

/**
 * 【表情】页签的置顶操作区。
 *
 * 继承通用动作/表情 ListToolbar 的全部按钮，并在其右侧追加一个
 * "表情编辑"按钮，打开表情编辑模态（ExpressionEditorModal）。
 */
defineProps<{ disabled?: boolean }>()
defineEmits<{
  (e: 'batch-add'): void
  (e: 'batch-modify'): void
  (e: 'open-editor'): void
}>()
</script>

<template>
  <div class="expressions-toolbar">
    <ListToolbar
      kind="expression"
      :disabled="disabled"
      style="flex: 1"
      @batch-add="$emit('batch-add')"
      @batch-modify="$emit('batch-modify')"
    />
    <button
      class="toolbar-btn toolbar-btn--editor"
      :disabled="disabled"
      @click="$emit('open-editor')"
    >
      表情编辑
    </button>
  </div>
</template>

<style scoped>
.expressions-toolbar {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #2c313a;
  flex-shrink: 0;
  background: #1d2026;
}
.toolbar-btn {
  padding: 6px 12px;
  background: #6b3aa8;
  color: #fff;
  border: 1px solid #6b3aa8;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
  transition: background 0.12s ease;
}
.toolbar-btn:hover:not(:disabled) {
  background: #7e4cc1;
  border-color: #7e4cc1;
}
.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>