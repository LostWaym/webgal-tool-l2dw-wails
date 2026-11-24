<script setup lang="ts">
import { ref, watch } from 'vue'
import { config } from 'pixi-live2d-display-webgal'
import { GetLegacyExpressionBlendMode, SetLegacyExpressionBlendMode } from '../../../../wailsjs/go/main/App'
import { useMessage } from '../../../composables/useMessage'
import { useMotionExpressionFolders } from '../../../composables/useMotionExpressionFolders'
import { PREVIEW_FRAME_RATE_LIMITS, usePreviewFrameRateLimit } from '../../../composables/usePreviewFrameRateLimit'
import { usePreviewFocusBoxOffset } from '../../../composables/usePreviewFocusBoxOffset'
import { PREVIEW_GUIDE_VISIBILITY_KEYS, usePreviewGuideVisibility } from '../../../composables/usePreviewGuideVisibility'
import { usePreviewGuideOverflow } from '../../../composables/usePreviewGuideOverflow'
import { usePreviewViewportSettings } from '../../../composables/usePreviewViewportSettings'
import { usePreviewRotationSnap } from '../../../composables/usePreviewRotationSnap'
import type { PreviewViewportVersion, PreviewViewportTransform } from '../../../composables/usePreviewViewportSettings'
import NumberInput from '../../common/NumberInput.vue'
import ThemeSelect from '../../common/ThemeSelect.vue'
import { currentTheme, selectTheme, themes } from '../../../themes/appearance'
import { vTabIndicator } from '../../../utils/tabIndicator'

const props = defineProps<{ visible: boolean; initialTab?: 'motionExpression' }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const activeTab = ref<'misc' | 'motionExpression' | 'viewport' | 'appearance'>('misc')
watch(() => props.visible, (visible) => {
  if (visible && props.initialTab) activeTab.value = props.initialTab
})
const folders = useMotionExpressionFolders()
const { frameRateLimit, update: updateFrameRateLimit } = usePreviewFrameRateLimit()
const frameRateOptions = PREVIEW_FRAME_RATE_LIMITS.map(value => ({ value, label: value === 0 ? '无限制' : `${value} 帧` }))
const { offsetY: focusBoxOffsetY, update: updateFocusBoxOffsetY } = usePreviewFocusBoxOffset()
const { alwaysShowGuides, update: updateGuideVisibility } = usePreviewGuideVisibility()
const { length: guideOverflow, update: updateGuideOverflow } = usePreviewGuideOverflow()
const viewport = usePreviewViewportSettings()
const { interval: rotationSnap, update: updateRotationSnap } = usePreviewRotationSnap()
const viewportVersions: Array<{ key: PreviewViewportVersion; label: string }> = [
  { key: 'cubism2', label: 'Cubism 2' },
  { key: 'cubism3', label: 'Cubism 3+' },
]
function updateViewport(version: PreviewViewportVersion, field: keyof PreviewViewportTransform, value: number) {
  viewport.update(version, { ...viewport.settings.value[version], [field]: value })
}
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

function onGuideVisibilityChange(event: Event) {
  updateGuideVisibility((event.target as HTMLInputElement).checked)
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
      <section class="ui-dialog settings-modal" role="dialog" aria-modal="true" aria-labelledby="preview-settings-title">
        <header>
          <h2 id="preview-settings-title">预览设置</h2>
          <button class="close" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="body">
          <nav v-tab-indicator class="settings-tabs" aria-label="设置分类">
            <span class="tab-indicator tab-indicator--vertical" aria-hidden="true" />
            <button type="button" :class="{ active: activeTab === 'misc' }" :aria-current="activeTab === 'misc' ? 'page' : undefined" @click="activeTab = 'misc'">杂项</button>
            <button type="button" :class="{ active: activeTab === 'appearance' }" :aria-current="activeTab === 'appearance' ? 'page' : undefined" @click="activeTab = 'appearance'">外观</button>
            <button type="button" :class="{ active: activeTab === 'motionExpression' }" :aria-current="activeTab === 'motionExpression' ? 'page' : undefined" @click="activeTab = 'motionExpression'">动作/表情</button>
            <button type="button" :class="{ active: activeTab === 'viewport' }" :aria-current="activeTab === 'viewport' ? 'page' : undefined" @click="activeTab = 'viewport'">预览视口</button>
          </nav>
          <div class="settings-content">
            <template v-if="activeTab === 'misc'">
              <label><input class="ui-switch" type="checkbox" role="switch" :checked="legacyMode" @change="onChange"> 使用旧版表情混合模式</label>
              <p>仅影响预览窗口中所有 Cubism 2 模型的表情参数混合，修改后立即生效。</p>
              <label class="frame-rate-label" for="preview-frame-rate-limit">帧率限制</label>
              <ThemeSelect id="preview-frame-rate-limit" class="frame-rate-select" :model-value="frameRateLimit" :options="frameRateOptions" @update:model-value="updateFrameRateLimit(Number($event))" />
              <p>仅影响预览主舞台，修改后立即生效并自动保存。</p>
              <label>旋转吸附间隔（度）</label>
              <NumberInput :model-value="rotationSnap" :min="0.01" :step="0.01" @update:model-value="updateRotationSnap" />
              <p>预览舞台按 R 旋转时，按住 Alt 吸附到最近的间隔倍数。修改后自动保存。</p>
              <label class="focus-offset-label">注视框 Y 轴偏移</label>
              <NumberInput :model-value="focusBoxOffsetY" :step="1" @update:model-value="updateFocusBoxOffsetY" />
              <p>按 L 调整注视时使用，单位为模型变换空间坐标；正值向下，负值向上。修改后自动保存。</p>
              <label class="guide-visibility-label"><input class="ui-switch" type="checkbox" role="switch" :checked="alwaysShowGuides" @change="onGuideVisibilityChange"> 常驻显示游标</label>
              <p>{{ PREVIEW_GUIDE_VISIBILITY_KEYS }} 可切换此设置。关闭时，游标只在编辑游标或 G 移动时按住 Alt 的情况下显示。</p>
              <label class="guide-visibility-label">游标溢出长度（像素）</label>
              <NumberInput :model-value="guideOverflow" :min="0" :step="1" @update:model-value="updateGuideOverflow" />
              <p>游标在画框两端各延伸的舞台坐标长度，随舞台缩放；设为 0 时不延伸。修改后自动保存。</p>
            </template>
            <template v-else-if="activeTab === 'motionExpression'">
              <label><input class="ui-switch" type="checkbox" role="switch" :checked="folders.settings.enabled" @change="onFoldersEnabledChange"> 启用文件夹划分</label>
              <p>按动作和表情名称模拟文件夹，不修改模型数据。</p>
              <label class="separator-label" for="folder-separator">文件夹分隔符</label>
              <input id="folder-separator" class="separator-input" type="text" :value="folders.settings.separator" @input="onSeparatorInput">
              <p>留空时不划分文件夹；分隔符按完整文本匹配。</p>
            </template>
            <fieldset v-else-if="activeTab === 'appearance'" class="theme-picker">
              <legend>编辑器主题</legend>
              <p>选择后自动保存，所有已打开的编辑器同步切换。</p>
              <div class="theme-grid">
                <label v-for="theme in themes" :key="theme.id" class="theme-card" :class="{ chosen: currentTheme.id === theme.id }">
                  <input type="radio" name="app-theme" :value="theme.id" :checked="theme.id === currentTheme.id" @change="selectTheme(theme)">
                  <span><strong>{{ theme.name }}</strong><small>{{ theme.description }}</small></span>
                  <span class="swatch" aria-hidden="true" :style="{ background: theme.colors.panel, color: theme.colors.text, borderColor: theme.colors.edge }">
                    Aa<i :style="{ background: theme.colors.accent }" />
                  </span>
                </label>
              </div>
            </fieldset>
            <template v-else>
              <p>在自适应视口基础上调整，修改后自动保存。偏移单位为画布逻辑像素，正值向右或向下；缩放 1 为原始适配大小。已手动调整的视口可通过重置按钮应用新设置。</p>
              <section v-for="version in viewportVersions" :key="version.key" class="viewport-section">
                <h3>{{ version.label }}</h3>
                <div class="viewport-fields">
                  <label>X 偏移 <NumberInput :model-value="viewport.settings.value[version.key].x" @update:model-value="updateViewport(version.key, 'x', $event)" /></label>
                  <label>Y 偏移 <NumberInput :model-value="viewport.settings.value[version.key].y" @update:model-value="updateViewport(version.key, 'y', $event)" /></label>
                  <label>缩放倍率 <NumberInput :model-value="viewport.settings.value[version.key].scale" :min="0.01" :step="0.01" @update:model-value="updateViewport(version.key, 'scale', $event)" /></label>
                </div>
                <button type="button" @click="viewport.reset(version.key)">恢复默认</button>
              </section>
              <p>适用于所有使用 Live2dPreview 的界面；混合版本模型组按第一个子模型的版本选择设置。</p>
            </template>
          </div>
        </div>
        <footer><button @click="emit('close')">关闭</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-mask { position: fixed; inset: 0; z-index: 9999; box-sizing: border-box; padding: 10vh 10vw; background: var(--ui-scrim); display: flex; align-items: center; justify-content: center; }
.settings-modal { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
header, footer { display: flex; flex-shrink: 0; align-items: center; padding: 14px 18px; }
header { border-bottom: 1px solid var(--ui-line); }
h2 { flex: 1; margin: 0; font-size: 16px; }
.body { display: flex; flex: 1; min-height: 0; }
.settings-tabs { position: relative; width: 140px; flex-shrink: 0; overflow-y: auto; padding: 12px 8px; border-right: 1px solid var(--ui-line); }
.settings-tabs button { position: relative; display: block; width: 100%; text-align: left; border-color: transparent; background: transparent; }
.settings-tabs button.active { background: transparent; color: var(--ui-link); }
.settings-content { flex: 1; min-width: 0; overflow-y: auto; padding: 18px; }
.separator-label, .frame-rate-label, .focus-offset-label, .guide-visibility-label { margin-top: 20px; }
.viewport-section { margin-top: 24px; }
.viewport-section h3 { margin: 0 0 12px; font-size: 15px; }
.viewport-fields { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.viewport-fields label { flex: 1; min-width: 160px; }
.frame-rate-select { margin-top: 8px; }
.separator-input { width: 100%; margin-top: 8px; padding: 9px 12px; border: 1px solid var(--ui-edge); border-radius: var(--ui-radius-control); color: inherit; background: var(--ui-field-fill); box-shadow: var(--ui-control-shadow); }
.separator-input:hover, .separator-input:focus { border-color: var(--ui-link); }
.settings-content :deep(.number-input) { display: inline-block; flex: 0 1 160px; width: 160px; max-width: 100%; line-height: 1.4; vertical-align: middle; border-radius: var(--ui-radius-control); }
.settings-content > :deep(.number-input) { display: block; margin-top: 8px; }
.settings-content :deep(.number-input:focus-visible) { outline: 1px solid var(--ui-link); outline-offset: -2px; }
.settings-content :deep(.number-input--editing) { border-color: var(--ui-link); background: var(--ui-well); }
label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
p { margin: 10px 0 0; color: var(--ui-muted); font-size: 13px; line-height: 1.6; }
button { border: 1px solid var(--ui-control-line); border-radius: var(--ui-radius-control); padding: 8px 13px; color: inherit; background: var(--ui-control-fill); cursor: pointer; }
button:hover { background: var(--ui-hover); }
.close { border: 0; background: transparent; font-size: 22px; padding: 0 5px; }
footer { justify-content: flex-end; border-top: 1px solid var(--ui-line); }
.theme-picker { border: 0; margin: 0; padding: 0; min-width: 0; }
.theme-picker legend { font-size: 16px; font-weight: 600; padding: 0; }
.theme-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 225px), 1fr)); gap: 10px; margin-top: 16px; }
.theme-card { padding: 12px; border: 1px solid var(--ui-control-line); border-radius: var(--ui-radius-control); background: var(--ui-control); }
.theme-card:hover { background: var(--ui-hover); }
.theme-card.chosen { outline: 2px solid var(--ui-link); outline-offset: -2px; background: var(--ui-selected); }
.theme-card:focus-within { outline: 2px solid var(--ui-link); outline-offset: 2px; }
.theme-card small { display: block; margin-top: 4px; color: var(--ui-muted); }
.swatch { margin-left: auto; min-width: 42px; overflow: hidden; text-align: center; font-weight: bold; border: 1px solid; border-radius: 4px; }
.swatch i { display: block; height: 5px; }
</style>
