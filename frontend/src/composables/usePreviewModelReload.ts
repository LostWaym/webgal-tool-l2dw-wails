import { reloadAllModelTextures } from '../live2d/textureUtils'
import emitter, { StageEvents } from '../stores/emitter'
import { useModelStore } from '../stores/previewStore'
import { previewRuntime } from '../utils/runtimeRegistry'
import { useMessage } from './useMessage'

export function usePreviewModelReload() {
  const store = useModelStore()
  const msg = useMessage()

  function reloadConfig(id: string) {
    emitter.emit(StageEvents.ReloadModel, id)
  }

  async function reloadTextures(id: string) {
    const entry = store.models.find(model => model.id === id)
    if (!entry || entry.kind !== 'live2d') return

    const subIds = previewRuntime.wmdlSubModels.get(id)?.subModelIds ?? []
    let success = subIds.length > 0
    try {
      for (const subId of subIds) {
        const model = previewRuntime.live2dModels.get(subId)
        const subEntry = entry.wmdlModels.find(item => item.id === subId)
        if (!model || !subEntry?.jsonAbsPath || !(await reloadAllModelTextures(model, subEntry.jsonAbsPath))) {
          success = false
        }
      }
      if (success) msg.success('已从磁盘重新加载纹理')
      else msg.error('重载纹理失败，请检查模型和纹理文件')
    } catch (error) {
      msg.error(`重载纹理失败：${error}`)
    }
  }

  return { reloadConfig, reloadTextures }
}
