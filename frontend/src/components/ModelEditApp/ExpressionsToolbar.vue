<script setup lang="ts">
import ListToolbar from './ListToolbar.vue'

/**
 * 【表情】页签的置顶操作区。
 *
 * 继承通用动作/表情 ListToolbar 的全部按钮。
 */
defineProps<{ disabled?: boolean }>()
defineEmits<{
  (e: 'batch-add'): void
  (e: 'batch-modify'): void
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
</style>
