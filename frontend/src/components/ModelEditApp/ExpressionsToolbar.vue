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
  <ListToolbar
    kind="expression"
    :disabled="disabled"
    @batch-add="$emit('batch-add')"
    @batch-modify="$emit('batch-modify')"
  />
</template>
