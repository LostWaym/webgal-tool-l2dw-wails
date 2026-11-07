import type { Application, Container } from 'pixi.js'

export function getDevicePixelRatio(): number {
  return window.devicePixelRatio || 1
}

/** 视口位置使用逻辑尺寸，DPR 仅用于画布像素密度。 */
export function observePixiViewport(
  app: Application,
  host: HTMLElement,
  root: Container,
  onResize?: () => void,
): () => void {
  let resolutionQuery: MediaQueryList | null = null
  let watchedResolution = 0
  let disposed = false

  function syncViewport() {
    if (disposed) return
    const resolution = getDevicePixelRatio()
    if (resolution !== watchedResolution) {
      resolutionQuery?.removeEventListener('change', syncViewport)
      watchedResolution = resolution
      resolutionQuery = window.matchMedia(`(resolution: ${resolution}dppx)`)
      resolutionQuery.addEventListener('change', syncViewport)
    }

    const width = host.clientWidth
    const height = host.clientHeight
    if (width <= 0 || height <= 0) return
    if (
      app.renderer.resolution === resolution
      && app.renderer.width === Math.round(width * resolution)
      && app.renderer.height === Math.round(height * resolution)
    ) return

    const relativeX = app.screen.width > 0 ? root.x / app.screen.width : 0.5
    const relativeY = app.screen.height > 0 ? root.y / app.screen.height : 0.5
    app.renderer.resolution = resolution
    app.renderer.resize(width, height)
    // Pixi 6 的交互管理器单独缓存 DPR。
    const interaction = app.renderer.plugins.interaction
    if (interaction) interaction.resolution = resolution
    root.position.set(relativeX * app.screen.width, relativeY * app.screen.height)
    onResize?.()
  }

  const observer = new ResizeObserver(syncViewport)
  observer.observe(host)
  window.addEventListener('resize', syncViewport)
  syncViewport()

  return () => {
    disposed = true
    observer.disconnect()
    window.removeEventListener('resize', syncViewport)
    resolutionQuery?.removeEventListener('change', syncViewport)
  }
}
