<script setup lang="ts">
import ListToolbar from './ListToolbar.vue'

/**
 * 【动作】页签的置顶操作区。语义固定 kind='motion'。
 */
defineProps<{ disabled?: boolean }>()
defineEmits<{ (e: 'batch-add'): void }>()
</script>

<template>
  <ListToolbar kind="motion" :disabled="disabled" @batch-add="$emit('batch-add')" />
</template>