<script setup lang="ts">
import { PickMotionFile, PickExpressionFile } from '../../../wailsjs/go/main/App'
import { choosePath } from '../../utils/fileDialog'
import { useWmdlModelEditorStore, deriveNameFromFile } from '../../stores/wmdlModelEditor'
import { useEditorConfirm } from '../../composables/useEditorConfirm'
import { useMessage } from '../../composables/useMessage'

const props = defineProps<{ kind: 'motion' | 'expression'; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'batch-add'): void; (e: 'batch-modify'): void }>()
const store = useWmdlModelEditorStore()
const { confirm } = useEditorConfirm()
const message = useMessage()

async function onClearAll() {
  const model = store.selectedModel
  if (!model || !await confirm(`确定删除当前模型的全部${props.kind === 'motion' ? '动作' : '表情'}条目？此操作暂不写盘。`)) return
  if (store.selectedModel !== model) return
  if (props.kind === 'motion') store.clearMotions()
  else store.clearExpressions()
}
async function onAddSingle() {
  const model = store.selectedModel
  if (!model) return
  try {
    const path = await choosePath(() => props.kind === 'motion' ? PickMotionFile() : PickExpressionFile())
    if (!path || store.selectedModel !== model) return
    const name = deriveNameFromFile(path, props.kind)
    if (props.kind === 'motion') store.addMotion(name, path)
    else store.addExpression(name, path)
  } catch (error) { message.error(`添加失败：${error}`) }
}
async function onSyncAll() {
  const model = store.selectedModel
  if (!model || store.currentWmdl.models.length < 2 ||
    !await confirm('将覆盖其他模型的对应条目列表，确定同步？')) return
  if (store.selectedModel !== model) return
  const count = (props.kind === 'motion' ? model.motions : model.expressions).length
  if (props.kind === 'motion') store.syncMotionsToOthers()
  else store.syncExpressionsToOthers()
  message.success(`已同步 ${count} 条${props.kind === 'motion' ? '动作' : '表情'}至 ${store.currentWmdl.models.length - 1} 个模型`)
}
</script>

<template>
  <div class="list-toolbar">
    <button class="ui-button" :disabled="disabled" @click="onAddSingle">添加单个</button>
    <button class="ui-button" :disabled="disabled" @click="emit('batch-add')">批量添加</button>
    <button class="ui-button" :disabled="disabled" @click="emit('batch-modify')">批量修改</button>
    <button class="ui-button" :disabled="disabled || store.currentWmdl.models.length < 2" @click="onSyncAll">同步所有模型</button>
    <button class="ui-button clear-button" :disabled="disabled" @click="onClearAll">删除全部</button>
  </div>
</template>

<style scoped>
.list-toolbar { display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--ui-line); flex-shrink: 0; background: var(--ui-panel); }
.ui-button { padding: 6px 4px; font-size: 12px; white-space: nowrap; min-width: 0; }
.clear-button { color: var(--ui-danger); }
</style>
