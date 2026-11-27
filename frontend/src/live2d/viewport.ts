import type { Application, Container, DisplayObject } from 'pixi.js'

export function getDevicePixelRatio(): number {
  return window.devicePixelRatio || 1
}

function syncFilterResolution(object: DisplayObject, resolution: number): void {
  if (object.filters) {
    for (const filter of object.filters) {
      if (filter.resolution !== resolution) filter.resolution = resolution
    }
  }
  const children = (object as Container).children
  if (children) {
    for (const child of children) syncFilterResolution(child, resolution)
  }
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

  function syncFilters() {
    if (disposed) return
    // Pixi 6 的离屏滤镜不继承画布 DPR；也需覆盖异步加载的 Live2D 自带滤镜。
    syncFilterResolution(app.stage, app.renderer.resolution)
  }

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
  app.renderer.on('prerender', syncFilters)
  syncViewport()
  syncFilters()

  return () => {
    disposed = true
    app.renderer.off('prerender', syncFilters)
    observer.disconnect()
    window.removeEventListener('resize', syncViewport)
    resolutionQuery?.removeEventListener('change', syncViewport)
  }
}
