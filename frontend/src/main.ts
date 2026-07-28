import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import ModelEditApp from './components/ModelEditApp/ModelEditApp.vue'
import { AppMode } from '../wailsjs/go/main/App'
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

  const Root = mode === 'editor' ? ModelEditApp : App
  createApp(Root).use(createPinia()).mount('#app')
}

void bootstrap()
