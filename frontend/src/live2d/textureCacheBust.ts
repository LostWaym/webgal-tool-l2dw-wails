import * as PIXI from 'pixi.js'

// 本地资源 URL 前缀（toFileUrl 产物），仅对该前缀做缓存破坏
const LOCAL_URL_PREFIX = '/abs_files/'

// 原始 URL → 上次带 query 的缓存 key
const lastKeys = new Map<string, string>()

/**
 * 为本地资源 URL 附加时间戳 query；已有 query 的原样返回。
 */
export function bustLocalUrl(url: string, timestamp: number): string {
  if (!url.startsWith(LOCAL_URL_PREFIX)) return url
  if (url.includes('?')) return url
  return `${url}?t=${timestamp}`
}

/**
 * 从缓存表中移除指定 key（不销毁 GPU 资源，由仍引用它的模型持有到销毁为止）。
 */
function evictCacheKey(key: string): void {
  delete (PIXI.utils.TextureCache as Record<string, unknown>)[key]
  delete (PIXI.utils.BaseTextureCache as Record<string, unknown>)[key]
}

let installed = false

/**
 * 覆写 PIXI.Texture.fromURL：本地贴图每次加载都生成新的缓存 key，
 * 并在加载前移除同 URL 上一次产生的旧 key，保证：
 *  - 重新加载模型时不会命中旧缓存纹理；
 *  - 同一模型多实例并存时各持独立纹理，删除其一不影响其他。
 *
 * 须在任何 Live2D 模型加载之前调用一次（loader.ts 顶层）。
 */
export function installTextureCacheBust(): void {
  if (installed) return
  installed = true

  const orig = PIXI.Texture.fromURL.bind(PIXI.Texture)
  PIXI.Texture.fromURL = ((url: string, options?: any) => {
    if (!url.startsWith(LOCAL_URL_PREFIX) || url.includes('?')) {
      return orig(url, options)
    }
    const prevKey = lastKeys.get(url)
    if (prevKey) evictCacheKey(prevKey)

    const newKey = `${url}?t=${Date.now()}`
    lastKeys.set(url, newKey)
    return orig(newKey, options)
  }) as typeof PIXI.Texture.fromURL
}
