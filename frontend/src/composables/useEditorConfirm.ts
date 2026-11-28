import { reactive } from 'vue'

const state = reactive({ visible: false, text: '' })
let resolvePending: ((confirmed: boolean) => void) | null = null

function close(confirmed = false) {
  state.visible = false
  resolvePending?.(confirmed)
  resolvePending = null
}

export function useEditorConfirm() {
  function confirm(text: string): Promise<boolean> {
    close()
    state.text = text
    state.visible = true
    return new Promise(resolve => { resolvePending = resolve })
  }
  return { state, confirm, close }
}
