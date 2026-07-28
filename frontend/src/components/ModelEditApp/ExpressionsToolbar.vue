<script setup lang="ts">
import ListToolbar from './ListToolbar.vue'

/**
 * 【表情】页签的置顶操作区。语义固定 kind='expression'。
 */
defineProps<{ disabled?: boolean }>()
defineEmits<{ (e: 'batch-add'): void }>()
</script>

<template>
  <ListToolbar kind="expression" :disabled="disabled" @batch-add="$emit('batch-add')" />
</template>