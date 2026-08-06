import type { Application, Container } from 'pixi.js'
import type { Live2DModel } from 'pixi-live2d-display-webgal'
import type { L2dwContainer } from '../live2d/L2dwContainer'

export interface PreviewRuntime {
  specialContainers: Map<string, Container>
  modelWrappers: Map<string, L2dwContainer>
  live2dModels: Map<string, Live2DModel>
  wmdlSubModels: Map<string, { subModelIds: string[]; mainWrapper: L2dwContainer }>
  app: Application | null
  cleanup: () => void
}

export interface EditRuntime {
  live2dModels: Map<string, Live2DModel>
  app: Application | null
  cleanup: () => void
}

export interface CommonRuntime {
  // 暂留空位，预留给后续跨窗口公共字段
}

export const previewRuntime: PreviewRuntime = {
  specialContainers: new Map(),
  modelWrappers: new Map(),
  live2dModels: new Map(),
  wmdlSubModels: new Map(),
  app: null,
  cleanup: () => {},
}

export const editRuntime: EditRuntime = {
  live2dModels: new Map(),
  app: null,
  cleanup: () => {},
}

export const commonRuntime: CommonRuntime = {}

// 仅供调试在控制台手动查看，禁止源码中读取
if (typeof window !== 'undefined') {
  ;(window as any).__l2dwDebugPreview = previewRuntime
  ;(window as any).__l2dwDebugEdit = editRuntime
  ;(window as any).__l2dwDebugCommon = commonRuntime
}