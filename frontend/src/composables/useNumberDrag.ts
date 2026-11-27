import { onBeforeUnmount, watch } from 'vue'
import { adjustNumber, type NumberAdjustment } from '../utils/numberAdjustment'

interface NumberDragOptions extends NumberAdjustment {
  value: number
  update: (value: number) => void
  pixelsPerStep?: number
}

export function useNumberDrag(target: () => string | null) {
  let drag: { options: NumberDragOptions; x: number; pointerId: number } | null = null
  let previousCursor = ''
  let previousUserSelect = ''

  function stop() {
    if (!drag) return
    drag = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('blur', stop)
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
  }

  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return
    const { options, x } = drag
    const steps = Math.round((event.clientX - x) / (options.pixelsPerStep ?? 3))
    options.update(adjustNumber(options.value, steps, options))
  }

  function end(event: PointerEvent) {
    if (event.pointerId === drag?.pointerId) stop()
  }

  function start(event: PointerEvent, options: NumberDragOptions) {
    if (event.button !== 0 || !target() || !Number.isFinite(options.value)) return
    event.preventDefault()
    event.stopPropagation()
    stop()
    previousCursor = document.body.style.cursor
    previousUserSelect = document.body.style.userSelect
    drag = { options, x: event.clientX, pointerId: event.pointerId }
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', stop)
  }

  watch(target, stop, { flush: 'sync' })
  onBeforeUnmount(stop)
  return { start }
}
