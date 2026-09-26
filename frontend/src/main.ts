import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import ModelEditApp from './components/ModelEditApp/ModelEditApp.vue'
import ActorEditApp from './components/ActorEditorApp/ActorEditApp.vue'
import { AppMode, EditorWmdlPath, ActorWmdlPath, ReadWmdlFile } from '../wailsjs/go/main/App'
import { useWmdlModelEditorStore } from './stores/wmdlModelEditor'
import './style.css'

// 根据 Go 暴露的 AppMode 选择根组件：
//   - "main"    → 主窗口（App.vue）
//   - "editor"  → 模型编辑器（ModelEditApp.vue）
//   - "actor"   → 演出编辑器（ActorEditApp.vue）
// AppMode 是异步绑定（wails runtime 初始化后才可用），所以包一层 async IIFE。
async function bootstrap() {
  let mode = 'main'
  try {
    mode = await AppMode()
  } catch (err) {
    console.warn('AppMode() failed, fallback to main mode:', err)
  }

  let rootComponent: any = App
  if (mode === 'editor') rootComponent = ModelEditApp
  else if (mode === 'actor') rootComponent = ActorEditApp

  const app = createApp(rootComponent).use(createPinia())

  // 编辑器 / 演出编辑器模式：若启动时通过 --wmdl / --actor-wmdl 传入了文件路径，自动加载它。
  if (mode === 'editor') {
    void loadStartupWmdl(EditorWmdlPath)
  } else if (mode === 'actor') {
    void loadStartupWmdl(ActorWmdlPath)
  }

  app.mount('#app')
}

async function loadStartupWmdl(pathFn: () => Promise<string>) {
  let wmdlPath = ''
  try {
    wmdlPath = await pathFn()
  } catch (err) {
    console.warn('Startup wmdl path fetch failed:', err)
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

  const store = useWmdlModelEditorStore()
  try {
    await store.fromJson(content, wmdlPath)
  } catch (err) {
    console.error('Failed to load startup wmdl:', err)
  }
}

void bootstrap()
