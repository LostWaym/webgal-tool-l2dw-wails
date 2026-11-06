import { computed, reactive, readonly } from 'vue'
import { GetMotionExpressionFolderSettings, SetMotionExpressionFolderSettings } from '../../wailsjs/go/main/App'
import { useMessage } from './useMessage'

const settings = reactive({ enabled: true, separator: '/' })
const active = computed(() => settings.enabled && settings.separator.length > 0)
let initialized = false
let changed = false
let save = Promise.resolve()

export function useMotionExpressionFolders() {
  if (!initialized) {
    initialized = true
    GetMotionExpressionFolderSettings().then((value) => {
      if (!changed && value) Object.assign(settings, value)
    }).catch((err) => {
      console.error('读取动作/表情文件夹设置失败', err)
      useMessage().warning('读取动作/表情文件夹设置失败，使用默认选项')
    })
  }

  function update(enabled: boolean, separator: string) {
    changed = true
    settings.enabled = enabled
    settings.separator = separator
    save = save.then(() => SetMotionExpressionFolderSettings(enabled, separator)).catch((err) => {
      console.error('保存动作/表情文件夹设置失败', err)
      useMessage().warning('保存动作/表情文件夹设置失败，当前选项仅在本次会话有效')
    })
  }

  return { settings: readonly(settings), active, update }
}
