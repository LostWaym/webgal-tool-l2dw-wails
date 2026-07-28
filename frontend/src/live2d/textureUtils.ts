import * as PIXI from 'pixi.js'
import type { Live2DModel } from 'pixi-live2d-display-webgal'
import { GetFileModifyTime } from '../../wailsjs/go/main/App'
import { pathCombine, pathDirname, toFileUrl } from '../path_utils'

/** 轮询周期（ms）。AGENTS.md 要求的常量化常量。 */
export const TEXTURE_POLL_INTERVAL_MS = 500

interface TextureRecord {
  absPath: string
  lastMtime: number
}

/** key 形如 `<modelId>|<absPath>` —— 同纹理被多模型共享时各自独立记录 */
const records = new Map<string, TextureRecord>()
let pollTimer: ReturnType<typeof setInterval> | null = null

function recordKey(modelId: string, absPath: string): string {
  return `${modelId}|${absPath}`
}

async function loadFreshTexture(absPath: string): Promise<PIXI.Texture> {
  // 时间戳 query 破坏浏览器/HTTP 缓存
  const cacheBustUrl = `${toFileUrl(absPath)}?t=${Date.now()}`
  return PIXI.Texture.fromURL(cacheBustUrl)
}

/** 从 internalModel.settings.textures 推导出每张纹理的绝对路径。 */
export function resolveTextureAbsPaths(model: Live2DModel, jsonAbsPath: string): string[] {
  const settings = (model as any).internalModel?.settings
  const relPaths: string[] | undefined = settings?.textures
  if (!Array.isArray(relPaths)) return []
  const baseDir = pathDirname(jsonAbsPath)
  return relPaths.map((p) => pathCombine(baseDir, p))
}

/** 单张纹理重载：销毁旧 PIXI.Texture → 加载新 PIXI.Texture → 写入 textures[]。 */
export async function reloadTextureAt(
  model: Live2DModel,
  textureIndex: number,
  absPath: string,
): Promise<void> {
  const textures = (model as any).textures as PIXI.Texture[] | undefined
  if (!textures || textureIndex >= textures.length) return

  try {
    const tex = await loadFreshTexture(absPath)

    const oldTexture = textures[textureIndex]
    if (oldTexture && oldTexture !== PIXI.Texture.WHITE) {
      try {
        oldTexture.destroy(true)
      } catch (e) {
        console.warn('texture destroy failed', e)
      }
    }

    textures[textureIndex] = tex
  } catch (e) {
    console.warn('reloadTextureAt failed', absPath, e)
  }
}

/** 重载一个模型的所有纹理（"重载纹理"按钮使用）。 */
export async function reloadAllModelTextures(
  model: Live2DModel,
  jsonAbsPath: string,
): Promise<void> {
  const absPaths = resolveTextureAbsPaths(model, jsonAbsPath)
  const textures = (model as any).textures as PIXI.Texture[] | undefined
  if (!textures) return
  for (let i = 0; i < absPaths.length && i < textures.length; i++) {
    await reloadTextureAt(model, i, absPaths[i])
  }
}

export interface TextureWatcher {
  enable(): void
  disable(): void
}

/**
 * 创建一个纹理轮询控制器。
 *
 * 每次轮询动态遍历当前已加载的模型，读取每张纹理的 mtime。
 * records 仅用于记忆"上次见到时的 mtime"，首次遇到的纹理直接记录但不触发重载，
 * 之后才比对变更。无需提前建立快照 —— 新模型加入后下一次轮询自动覆盖。
 */
export function createTextureWatcher(
  getLive2dById: () => Map<string, Live2DModel>,
  getJsonPathByModelId: () => Map<string, string>,
): TextureWatcher {
  async function pollOnce(): Promise<void> {
    const byId = getLive2dById()
    const pathById = getJsonPathByModelId()
    for (const [modelId, model] of byId) {
      const jsonAbs = pathById.get(modelId)
      if (!jsonAbs) continue
      const textures = (model as any).textures as PIXI.Texture[] | undefined
      if (!textures) continue
      const absPaths = resolveTextureAbsPaths(model, jsonAbs)
      for (let i = 0; i < absPaths.length && i < textures.length; i++) {
        const abs = absPaths[i]
        const key = recordKey(modelId, abs)
        let mtime: number
        try {
          mtime = await GetFileModifyTime(abs)
        } catch {
          continue
        }
        const rec = records.get(key)
        if (!rec) {
          records.set(key, { absPath: abs, lastMtime: mtime })
          continue
        }
        if (mtime > rec.lastMtime) {
          rec.lastMtime = mtime
          await reloadTextureAt(model, i, abs)
        }
      }
    }
  }

  return {
    enable() {
      if (pollTimer) return
      pollTimer = setInterval(() => {
        void pollOnce()
      }, TEXTURE_POLL_INTERVAL_MS)
    },
    disable() {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    },
  }
}