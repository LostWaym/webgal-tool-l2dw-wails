import { readonly, ref } from 'vue'
import { GetPreviewViewportSettings, SetPreviewViewportSettings } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'

export type PreviewViewportVersion = 'cubism2' | 'cubism3'
export interface PreviewViewportTransform { x: number; y: number; scale: number }
type Settings = Record<PreviewViewportVersion, PreviewViewportTransform>

function defaults(version: PreviewViewportVersion): PreviewViewportTransform {
  return version === 'cubism3' ? { x: 0, y: 256, scale: 2.5 } : { x: 0, y: 0, scale: 1 }
}

const settings = ref<Settings>({ cubism2: defaults('cubism2'), cubism3: defaults('cubism3') })
let initialized = false
const changed = new Set<PreviewViewportVersion>()
let load = Promise.resolve()
let save = Promise.resolve()

function valid(value: PreviewViewportTransform | null | undefined): value is PreviewViewportTransform {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.scale) && value.scale > 0
}

export function usePreviewViewportSettings() {
  if (!initialized) {
    initialized = true
    load = GetPreviewViewportSettings().then((value) => {
      if (!value) return
      settings.value = {
        cubism2: changed.has('cubism2') ? settings.value.cubism2 : valid(value.cubism2) ? { ...value.cubism2 } : defaults('cubism2'),
        cubism3: changed.has('cubism3') ? settings.value.cubism3 : valid(value.cubism3) ? { ...value.cubism3 } : defaults('cubism3'),
      }
    }).catch((err) => {
      console.error('读取预览视口设置失败', err)
      useMessage().warning('读取预览视口设置失败，使用默认值')
    })
  }

  function update(version: PreviewViewportVersion, value: PreviewViewportTransform) {
    if (!valid(value)) return
    changed.add(version)
    const next = { ...settings.value, [version]: { ...value } }
    settings.value = next
    save = save.then(() => load).then(() => SetPreviewViewportSettings(settings.value as unknown as Parameters<typeof SetPreviewViewportSettings>[0])).catch((err) => {
      console.error('保存预览视口设置失败', err)
      useMessage().warning('保存预览视口设置失败，当前设置仅在本次会话有效')
    })
  }

  return { settings: readonly(settings), update, reset: (version: PreviewViewportVersion) => update(version, defaults(version)) }
}
