import type { ObjectDirective } from 'vue'

type IndicatorElement = HTMLElement & { cleanupTabIndicator?: () => void }

export const vTabIndicator: ObjectDirective<IndicatorElement> = {
  mounted(container) {
    const element = container.querySelector<HTMLElement>('.tab-indicator')
    if (!element) return
    const indicator: HTMLElement = element

    let initialized = false
    let frame = 0
    const resizeObserver = new ResizeObserver(update)

    function update() {
      const active = container.querySelector<HTMLElement>(':scope > button.is-active, :scope > button.active')
      if (!active) {
        indicator.style.visibility = 'hidden'
        initialized = false
        indicator.classList.remove('tab-indicator--ready')
        cancelAnimationFrame(frame)
        return
      }

      const parentRect = container.getBoundingClientRect()
      const rect = active.getBoundingClientRect()
      const x = rect.left - parentRect.left - container.clientLeft + container.scrollLeft
      const y = rect.top - parentRect.top - container.clientTop + container.scrollTop
      indicator.style.setProperty('--tab-x', `${x}px`)
      indicator.style.setProperty('--tab-y', `${y}px`)
      indicator.style.setProperty('--tab-width', `${rect.width}px`)
      indicator.style.setProperty('--tab-height', `${rect.height}px`)
      indicator.style.visibility = 'visible'
      if (!initialized) {
        initialized = true
        frame = requestAnimationFrame(() => indicator.classList.add('tab-indicator--ready'))
      }
    }

    function observeButtons() {
      resizeObserver.disconnect()
      resizeObserver.observe(container)
      container.querySelectorAll(':scope > button').forEach(button => resizeObserver.observe(button))
      update()
    }

    const mutationObserver = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === 'childList' && mutation.target === container)) {
        observeButtons()
      } else {
        update()
      }
    })
    mutationObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    observeButtons()
    container.cleanupTabIndicator = () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  },
  unmounted(container) {
    container.cleanupTabIndicator?.()
  },
}
