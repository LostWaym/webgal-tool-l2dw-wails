<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { useEditorConfirm } from '../../../composables/useEditorConfirm'
const { state, close } = useEditorConfirm()
const cancelButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
watch(() => state.visible, async visible => {
  if (visible) {
    previousFocus = document.activeElement as HTMLElement
    await nextTick()
    cancelButton.value?.focus()
  } else previousFocus?.focus()
})
function onKey(event: KeyboardEvent) {
  if (!state.visible) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
  if (event.key === 'Tab') {
    event.preventDefault()
    const buttons = cancelButton.value?.parentElement?.querySelectorAll('button')
    if (buttons) (document.activeElement === buttons[0] ? buttons[1] : buttons[0]).focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => { close(); window.removeEventListener('keydown', onKey, true) })
</script>

<template>
  <Teleport to="body">
    <div v-if="state.visible" class="edit-confirm-mask" @click.self="close()">
      <section class="ui-dialog edit-confirm" role="dialog" aria-modal="true" aria-label="操作确认">
        <p>{{ state.text }}</p>
        <footer>
          <button ref="cancelButton" class="ui-button" @click="close()">取消</button>
          <button class="ui-button" @click="close(true)">确认</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.edit-confirm-mask { position: fixed; inset: 0; z-index: 11000; display: grid; place-items: center; background: var(--ui-scrim); }
.edit-confirm { width: min(380px, 85vw); padding: 20px; color: var(--ui-text); background: var(--ui-dialog-fill); border: 1px solid var(--ui-edge); border-radius: var(--ui-radius-panel); box-shadow: var(--ui-panel-shadow); }
p { margin: 0 0 20px; white-space: pre-line; overflow-wrap: anywhere; }
footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
