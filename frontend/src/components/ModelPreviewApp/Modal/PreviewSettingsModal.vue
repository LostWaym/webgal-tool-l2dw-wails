<script setup lang="ts">
import { ref } from 'vue'
import { config } from 'pixi-live2d-display-webgal'
import { GetLegacyExpressionBlendMode, SetLegacyExpressionBlendMode } from '../../../../wailsjs/go/main/App'
import { useMessage } from '../../../composables/useMessage'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const legacyMode = ref(config.legacyExpressionBlendMode)
let changed = false
let save = Promise.resolve()

GetLegacyExpressionBlendMode().then((value) => {
  if (changed) return
  legacyMode.value = value
  config.legacyExpressionBlendMode = value
}).catch((err) => {
  console.error('读取表情混合模式失败', err)
  useMessage().warning('读取表情混合模式失败，使用当前选项')
})

function onChange(event: Event) {
  const value = (event.target as HTMLInputElement).checked
  changed = true
  legacyMode.value = value
  config.legacyExpressionBlendMode = value
  save = save.then(() => SetLegacyExpressionBlendMode(value)).catch((err) => {
    console.error('保存表情混合模式失败', err)
    useMessage().warning('保存表情混合模式失败，当前选项仅在本次会话有效')
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="settings-mask" @click.self="emit('close')">
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="preview-settings-title">
        <header>
          <h2 id="preview-settings-title">预览设置</h2>
          <button class="close" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="body">
          <label><input type="checkbox" :checked="legacyMode" @change="onChange"> 使用旧版表情混合模式</label>
          <p>仅影响预览窗口中所有 Cubism 2 模型的表情参数混合，修改后立即生效。</p>
        </div>
        <footer><button @click="emit('close')">关闭</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-mask { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; }
.settings-modal { width: min(480px, 94vw); background: #1d2026; border: 1px solid #454d5a; border-radius: 9px; color: #e6e6e6; box-shadow: 0 12px 40px #0008; }
header, footer { display: flex; align-items: center; padding: 14px 18px; }
header { border-bottom: 1px solid #373d48; }
h2 { flex: 1; margin: 0; font-size: 16px; }
.body { padding: 18px; }
label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
p { margin: 10px 0 0; color: #aeb7c5; font-size: 13px; line-height: 1.6; }
button { border: 1px solid #495464; border-radius: 5px; padding: 8px 13px; color: inherit; background: #303743; cursor: pointer; }
.close { border: 0; background: transparent; font-size: 22px; padding: 0 5px; }
footer { justify-content: flex-end; border-top: 1px solid #373d48; }
</style>
