import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import ModelEditApp from './components/ModelEditApp/ModelEditApp.vue'
import { AppMode, EditorWmdlPath, ReadWmdlFile } from '../wailsjs/go/main/App'
import './style.css'

// 根据 Go 暴露的 AppMode 选择根组件：
//   - "main"    → 主窗口（App.vue）
//   - "editor"  → 模型编辑器（ModelEditApp.vue）
// AppMode 是异步绑定（wails runtime 初始化后才可用），所以包一层 async IIFE。
async function bootstrap() {
  let mode = 'main'
  try {
    mode = await AppMode()
  } catch (err) {
    console.warn('AppMode() failed, fallback to main mode:', err)
  }

  const app = createApp(mode === 'editor' ? ModelEditApp : App).use(createPinia())

  // 编辑器模式：若启动时通过 --wmdl 传入了文件路径，自动加载它。
  if (mode === 'editor') {
    void loadStartupWmdl()
  }

  app.mount('#app')
}

async function loadStartupWmdl() {
  let wmdlPath = ''
  try {
    wmdlPath = await EditorWmdlPath()
  } catch (err) {
    console.warn('EditorWmdlPath() failed:', err)
    return
  }
  if (!wmdlPath) return

  let content = ''
  try {
    content = await ReadWmdlFile(wmdlPath)
  } catch (err) {
    console.error('ReadWmdlFile failed:', err)
    return
  }

  // 延后到下一个微任务，确保 store 已挂载到 pinia 上
  const { useWmdlModelEditorStore } = await import('./stores/wmdlModelEditor')
  const store = useWmdlModelEditorStore()
  try {
    await store.fromJson(content, wmdlPath)
  } catch (err) {
    console.error('Failed to load startup wmdl:', err)
  }
}

void bootstrap()
