<script setup lang="ts">
import { ref, watch } from 'vue'
import { config } from 'pixi-live2d-display-webgal'
import { GetLegacyExpressionBlendMode, SetLegacyExpressionBlendMode } from '../../../../wailsjs/go/main/App'
import { useMessage } from '../../../composables/useMessage'
import { useMotionExpressionFolders } from '../../../composables/useMotionExpressionFolders'
import { PREVIEW_FRAME_RATE_LIMITS, usePreviewFrameRateLimit } from '../../../composables/usePreviewFrameRateLimit'

const props = defineProps<{ visible: boolean; initialTab?: 'motionExpression' }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const activeTab = ref<'misc' | 'motionExpression'>('misc')
watch(() => props.visible, (visible) => {
  if (visible && props.initialTab) activeTab.value = props.initialTab
})
const folders = useMotionExpressionFolders()
const { frameRateLimit, update: updateFrameRateLimit } = usePreviewFrameRateLimit()
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

function onFrameRateLimitChange(event: Event) {
  updateFrameRateLimit(Number((event.target as HTMLSelectElement).value))
}

function onFoldersEnabledChange(event: Event) {
  folders.update((event.target as HTMLInputElement).checked, folders.settings.separator)
}

function onSeparatorInput(event: Event) {
  folders.update(folders.settings.enabled, (event.target as HTMLInputElement).value)
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
          <nav class="settings-tabs" aria-label="设置分类">
            <button type="button" :class="{ active: activeTab === 'misc' }" :aria-current="activeTab === 'misc' ? 'page' : undefined" @click="activeTab = 'misc'">杂项</button>
            <button type="button" :class="{ active: activeTab === 'motionExpression' }" :aria-current="activeTab === 'motionExpression' ? 'page' : undefined" @click="activeTab = 'motionExpression'">动作/表情</button>
          </nav>
          <div class="settings-content">
            <template v-if="activeTab === 'misc'">
              <label><input type="checkbox" :checked="legacyMode" @change="onChange"> 使用旧版表情混合模式</label>
              <p>仅影响预览窗口中所有 Cubism 2 模型的表情参数混合，修改后立即生效。</p>
              <label class="frame-rate-label" for="preview-frame-rate-limit">帧率限制</label>
              <select id="preview-frame-rate-limit" class="frame-rate-select" :value="frameRateLimit" @change="onFrameRateLimitChange">
                <option v-for="limit in PREVIEW_FRAME_RATE_LIMITS" :key="limit" :value="limit">{{ limit === 0 ? '无限制' : `${limit} 帧` }}</option>
              </select>
              <p>仅影响预览主舞台，修改后立即生效并自动保存。</p>
            </template>
            <template v-else>
              <label><input type="checkbox" :checked="folders.settings.enabled" @change="onFoldersEnabledChange"> 启用文件夹划分</label>
              <p>按动作和表情名称模拟文件夹，不修改模型数据。</p>
              <label class="separator-label" for="folder-separator">文件夹分隔符</label>
              <input id="folder-separator" class="separator-input" type="text" :value="folders.settings.separator" @input="onSeparatorInput">
              <p>留空时不划分文件夹；分隔符按完整文本匹配。</p>
            </template>
          </div>
        </div>
        <footer><button @click="emit('close')">关闭</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-mask { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; }
.settings-modal { width: min(620px, 94vw); background: #1d2026; border: 1px solid #454d5a; border-radius: 9px; color: #e6e6e6; box-shadow: 0 12px 40px #0008; }
header, footer { display: flex; align-items: center; padding: 14px 18px; }
header { border-bottom: 1px solid #373d48; }
h2 { flex: 1; margin: 0; font-size: 16px; }
.body { display: flex; min-height: 220px; }
.settings-tabs { width: 140px; flex-shrink: 0; padding: 12px 8px; border-right: 1px solid #373d48; }
.settings-tabs button { display: block; width: 100%; text-align: left; border-color: transparent; background: transparent; }
.settings-tabs button.active { background: #303b4d; color: #a9c8ed; }
.settings-content { flex: 1; min-width: 0; padding: 18px; }
.separator-label, .frame-rate-label { margin-top: 20px; }
.separator-input, .frame-rate-select { box-sizing: border-box; width: 100%; margin-top: 8px; padding: 8px; border: 1px solid #495464; border-radius: 5px; color: inherit; background: #171a20; }
label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
p { margin: 10px 0 0; color: #aeb7c5; font-size: 13px; line-height: 1.6; }
button { border: 1px solid #495464; border-radius: 5px; padding: 8px 13px; color: inherit; background: #303743; cursor: pointer; }
.close { border: 0; background: transparent; font-size: 22px; padding: 0 5px; }
footer { justify-content: flex-end; border-top: 1px solid #373d48; }
</style>
