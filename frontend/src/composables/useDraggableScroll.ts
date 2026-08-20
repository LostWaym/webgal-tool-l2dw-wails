import { onUnmounted, reactive, readonly, ref } from 'vue'

/**
 * 拖拽滚动，支持惯性滚动。
 *
 * 用法：
 * ```vue
 * <ul v-bind="scrollHandlers" class="is-dragging-scroll">
 *   <li v-for="item in items" @click="onClick(item)">{{ item }}</li>
 * </ul>
 * ```
 *
 * ```ts
 * const { scrollHandlers } = useDraggableScroll({
 *   direction: 'vertical',  // 'vertical' | 'horizontal' | 'both'
 *   sensitivity: 1,         // 滚动灵敏度
 * })
 * ```
 *
 * 注意：需要给可滚动容器添加 `is-dragging-scroll` class。
 * 拖拽超过 5px 后松开会触发惯性滚动，惯性参数见文件顶部常量。
 */

const THRESHOLD = 5
const FRICTION = 0.98
const MIN_VELOCITY = 0.1
const SPEED_THRESHOLD = 2
const INERTIA_MULTIPLIER = 0.25

interface DraggableScrollOptions {
  direction?: 'vertical' | 'horizontal' | 'both'
  sensitivity?: number
}

export function useDraggableScroll(options: DraggableScrollOptions = {}) {
  const isDragging = ref(false)
  const startPos = reactive({ x: 0, y: 0 })
  const scrollStart = reactive({ left: 0, top: 0 })
  const velocity = reactive({ x: 0, y: 0 })
  let hasDragged = false
  let animFrameId: number | null = null
  let lastMoveTime = 0
  let lastMoveX = 0
  let lastMoveY = 0

  function inertiaLoop() {
    const el = document.querySelector('.is-dragging-scroll') as HTMLElement
    if (!el) return

    el.scrollTop += velocity.y
    el.scrollLeft += velocity.x

    velocity.x *= FRICTION
    velocity.y *= FRICTION

    if (Math.abs(velocity.x) < MIN_VELOCITY && Math.abs(velocity.y) < MIN_VELOCITY) {
      velocity.x = 0
      velocity.y = 0
      animFrameId = null
      return
    }

    animFrameId = requestAnimationFrame(inertiaLoop)
  }

  function stopInertia() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
    velocity.x = 0
    velocity.y = 0
  }

  function onMouseMove(e: MouseEvent) {
    const now = performance.now()
    const dt = now - lastMoveTime

    if (dt > 0) {
      velocity.x = (lastMoveX - e.clientX) / dt * 16
      velocity.y = (lastMoveY - e.clientY) / dt * 16
    }
    lastMoveTime = now
    lastMoveX = e.clientX
    lastMoveY = e.clientY

    const dx = Math.abs(e.clientX - startPos.x)
    const dy = Math.abs(e.clientY - startPos.y)

    if (!isDragging.value && Math.max(dx, dy) > THRESHOLD) {
      isDragging.value = true
      hasDragged = true
    }

    if (!isDragging.value) return
    const el = document.querySelector('.is-dragging-scroll') as HTMLElement
    if (!el) return

    const sensitivity = options.sensitivity ?? 1
    const scrollDy = (e.clientY - startPos.y) * sensitivity
    const scrollDx = (e.clientX - startPos.x) * sensitivity

    if (options.direction !== 'horizontal') el.scrollTop = scrollStart.top - scrollDy
    if (options.direction !== 'vertical') el.scrollLeft = scrollStart.left - scrollDx
  }

  function onClickCapture(e: MouseEvent) {
    if (hasDragged) {
      e.stopPropagation()
      e.preventDefault()
    }
    hasDragged = false
  }

  function onMouseUp() {
    isDragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)

    velocity.x *= INERTIA_MULTIPLIER
    velocity.y *= INERTIA_MULTIPLIER
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2)
    if (speed > SPEED_THRESHOLD) {
      animFrameId = requestAnimationFrame(inertiaLoop)
    }
  }

  onUnmounted(() => {
    stopInertia()
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  })

  return {
    isDragging: readonly(isDragging),
    scrollHandlers: {
      onMousedown(e: MouseEvent) {
        if (e.button !== 0) return
        hasDragged = false
        stopInertia()
        document.addEventListener('click', onClickCapture, { capture: true, once: true })
        startPos.x = e.clientX
        startPos.y = e.clientY
        const el = e.currentTarget as HTMLElement
        scrollStart.left = el.scrollLeft
        scrollStart.top = el.scrollTop
        lastMoveTime = performance.now()
        lastMoveX = e.clientX
        lastMoveY = e.clientY
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      },
    },
  }
}
