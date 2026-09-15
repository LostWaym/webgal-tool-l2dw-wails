<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ListFilterPresetFiles,
  ReadFilterPresetFile,
  SaveFilterPresetFile,
} from '../../../../wailsjs/go/main/App'
import { useModelStore } from '../../../stores/previewStore'
import type { FilterState } from '../../../stores/previewStore'
import { useFilterPresetModal } from '../../../composables/useFilterPresetModal'
import { useMessage } from '../../../composables/useMessage'
import { FILTER_GROUPS, type FilterItemSpec, type FilterGroupSpec } from '../../../utils/consts'
import ColorPicker, { type RGBColor } from '../../common/ColorPicker.vue'
import Live2dPreview from '../../common/Live2dPreview.vue'

/**
 * 滤镜预设管理模态。
 *
 * - 左侧：动态从 filter_presets 读取已有的 .json 预设列表
 * - 右侧：当前选中预设的参数编辑区
 * - 编辑不直接写回磁盘；点击【保存滤镜修改】才落盘
 * - 底部固定区域包含三个按钮：
 *   - 保存滤镜修改：把当前 draft 写回磁盘
 *   - 撤销修改内容：从磁盘重新读取，丢弃未保存的修改
 *   - 应用到模型：把 draft 写入当前选中模型的 FilterState
 */

const { state, currentDraft, originalSnapshot, close } = useFilterPresetModal()
const store = useModelStore()
const msg = useMessage()
const live2dPreviewRef = ref<InstanceType<typeof Live2dPreview> | null>(null)

// 取当前选中模型的 wmdlConfig 作为预览。优先选中 live2d 模型，其次取第一个 live2d 模型。
const previewWmdlConfig = computed(() => {
  const sel = store.selectedModel
  if (sel?.kind === 'live2d' && sel.wmdlConfig) return sel.wmdlConfig
  const firstLive2d = store.models.find((m) => m.kind === 'live2d' && m.wmdlConfig)
  if (firstLive2d?.wmdlConfig) return firstLive2d.wmdlConfig
  return null
})

// ───────── 预设列表 ─────────

const presetFiles = ref<string[]>([])

async function loadPresetFiles() {
  try {
    presetFiles.value = await ListFilterPresetFiles()
  } catch {
    presetFiles.value = []
  }
}

async function onPresetSelect(filename: string) {
  try {
    const content = await ReadFilterPresetFile(filename)
    const parsed = JSON.parse(content)
    const filters = parsed?.filters ?? parsed ?? {}
    state.selectedFilename = filename
    // 拷贝一份避免与磁盘共享引用
    currentDraft.value = { ...filters }
    originalSnapshot.value = { ...filters }
  } catch (e) {
    console.error('failed to read preset', filename, e)
    msg.error(`读取预设失败：${filename}`)
  }
}

// FILTER_GROUPS / FilterItemSpec / FilterGroupSpec 现已从 utils/consts 导入

// ───────── 编辑辅助 ─────────

function numVal(key: string | undefined): number {
  if (!key || !currentDraft.value) return 0
  const v = currentDraft.value[key]
  return typeof v === 'number' ? v : 0
}

function setNumVal(key: string | undefined, value: number) {
  if (!key || !currentDraft.value) return
  currentDraft.value[key] = value
}

function colorFor(rKey: string, gKey: string, bKey: string): RGBColor {
  const d = currentDraft.value
  if (!d) return { r: 255, g: 255, b: 255 }
  return {
    r: typeof d[rKey] === 'number' ? (d[rKey] as number) : 255,
    g: typeof d[gKey] === 'number' ? (d[gKey] as number) : 255,
    b: typeof d[bKey] === 'number' ? (d[bKey] as number) : 255,
  }
}

function setColorFor(rKey: string, gKey: string, bKey: string, color: RGBColor) {
  if (!currentDraft.value) return
  currentDraft.value[rKey] = color.r
  currentDraft.value[gKey] = color.g
  currentDraft.value[bKey] = color.b
}

function toggleBool(key: string | undefined, checked: boolean) {
  if (!key || !currentDraft.value) return
  currentDraft.value[key] = checked ? 1 : 0
}

// ───────── 模态生命周期 ─────────

watch(
  () => state.visible,
  (visible) => {
    if (visible) {
      loadPresetFiles()
    } else {
      state.selectedFilename = null
      currentDraft.value = null
      originalSnapshot.value = null
    }
  },
)

// 实时把 draft 同步到预览组件，方便用户调参时直观看到效果
watch(
  currentDraft,
  (draft) => {
    if (!draft) return
    live2dPreviewRef.value?.setFilter(draft as Partial<FilterState>)
  },
  { deep: true },
)

onMounted(() => {
  if (state.visible) loadPresetFiles()
})

function onMaskClick() {
  close()
}

// ───────── 按钮：保存滤镜修改 / 撤销修改内容 / 应用到模型 ─────────

async function onApplyPreset() {
  if (!currentDraft.value || !state.selectedFilename) return
  try {
    const content = JSON.stringify(
      { name: state.selectedFilename.replace(/\.json$/i, ''), filters: currentDraft.value },
      null,
      2,
    )
    await SaveFilterPresetFile(state.selectedFilename, content)
    originalSnapshot.value = { ...currentDraft.value }
    msg.success(`已保存：${state.selectedFilename}`)
    // 刷新列表（新建场景下也无需更新，但删除/重命名场景下保持同步）
    loadPresetFiles()
  } catch (e) {
    console.error('failed to save preset', e)
    msg.error(`保存预设失败：${e}`)
  }
}

function onResetDraft() {
  if (!originalSnapshot.value) {
    msg.warning('当前没有可重置的内容')
    return
  }
  currentDraft.value = { ...originalSnapshot.value }
  msg.info('已重置为磁盘原始值')
}

function onApplyToModel() {
  if (!currentDraft.value) return
  const id = store.selectedId
  if (!id) {
    msg.warning('请先选中模型')
    return
  }
  store.setFilterState(id, currentDraft.value as Partial<FilterState>)
  msg.success('已将滤镜应用到当前模型')
  close()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="state.visible" class="filter-preset-mask" @click.self="onMaskClick">
        <div class="filter-preset-modal" @click.stop>
          <header class="filter-preset-modal__header">
            <h2 class="filter-preset-modal__title">滤镜预设管理</h2>
            <button class="icon-btn" aria-label="关闭" @click="onMaskClick">×</button>
          </header>

          <section class="filter-preset-modal__body">
            <!-- 左侧：预设列表 -->
            <aside class="preset-list">
              <div class="preset-list__header">预设列表</div>
              <ul class="preset-list__items">
                <li
                  v-for="name in presetFiles"
                  :key="name"
                  class="preset-list__item"
                  :class="{ 'is-active': state.selectedFilename === name }"
                  @click="onPresetSelect(name)"
                >
                  {{ name }}
                </li>
                <li v-if="presetFiles.length === 0" class="preset-list__empty">
                  暂无预设
                </li>
              </ul>
            </aside>

            <!-- 右侧：编辑区 -->
            <div class="preset-editor">
              <div v-if="!currentDraft" class="preset-editor__empty">
                请在左侧选择要编辑的预设
              </div>
              <template v-else>
                <div class="preset-editor__name">
                  {{ state.selectedFilename }}
                </div>
                <div class="preset-editor__scroll">
                  <div
                    v-for="group in FILTER_GROUPS"
                    :key="group.title"
                    class="filter-group"
                  >
                    <div class="filter-group__title">{{ group.title }}</div>
                    <div
                      v-for="item in group.items"
                      :key="(item.key as string | undefined) ?? `${item.label}-${group.title}`"
                      class="form-row"
                      :class="{ 'form-row--check': item.boolean }"
                    >
                      <template v-if="item.boolean">
                        <label class="form-row__check-label">
                          <input
                            type="checkbox"
                            class="form-row__check"
                            :checked="numVal(item.key as string) === 1"
                            @change="(e: any) => toggleBool(item.key as string, e.target.checked)"
                          />
                          <span>{{ item.label }}</span>
                        </label>
                      </template>
                      <template v-else-if="item.colorPicker">
                        <label class="form-row__color-label">{{ item.label }}</label>
                        <ColorPicker
                          :color="colorFor(item.colorPicker.rKey, item.colorPicker.gKey, item.colorPicker.bKey)"
                          :picker-style="{ width: '200px' }"
                          @update:color="(c: RGBColor) => setColorFor(item.colorPicker!.rKey, item.colorPicker!.gKey, item.colorPicker!.bKey, c)"
                        />
                      </template>
                      <template v-else>
                        <label>{{ item.label }}</label>
                        <input
                          :value="numVal(item.key as string)"
                          type="number"
                          class="form-input"
                          :step="item.step ?? 'any'"
                          :min="item.min"
                          :max="item.max"
                          @input="(e: any) => setNumVal(item.key as string, Number(e.target.value))"
                        />
                      </template>
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <!-- 置顶预览：与编辑区同级，渲染当前选中/第一个 live2d 模型，实时显示滤镜效果 -->
            <aside class="preset-preview">
              <div class="preset-preview__header">实时预览</div>
              <div class="preset-preview__canvas">
                <Live2dPreview v-if="previewWmdlConfig" ref="live2dPreviewRef" :wmdl-config="previewWmdlConfig" />
                <div v-else class="preset-preview__empty">暂无可预览的模型</div>
              </div>
            </aside>
          </section>

          <!-- 底部固定操作区 -->
          <footer class="filter-preset-modal__footer">
            <button
              class="footer-btn footer-btn--primary"
              :disabled="!currentDraft || !state.selectedFilename"
              @click="onApplyPreset"
            >
              保存滤镜修改
            </button>
            <button
              class="footer-btn"
              :disabled="!currentDraft"
              @click="onResetDraft"
            >
              撤销修改内容
            </button>
            <button
              class="footer-btn"
              :disabled="!currentDraft"
              @click="onApplyToModel"
            >
              应用到模型
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 与 TransformSnapshotModal 保持一致的视觉风格 */
.filter-preset-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.filter-preset-modal {
  background-color: rgba(29, 32, 38, 0.92);
  color: #e6e6e6;
  width: min(900px, 94vw);
  height: min(640px, 86vh);
  border-radius: 8px;
  border: 1px solid rgba(60, 68, 80, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.filter-preset-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  flex-shrink: 0;
}

.filter-preset-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
  color: #ffffff;
}

.icon-btn {
  background-color: transparent;
  border: none;
  color: #e6e6e6;
  font-size: 22px;
  line-height: 1;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.icon-btn:hover {
  background-color: rgba(53, 60, 71, 0.42);
  color: #ffffff;
}

.filter-preset-modal__body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* 左侧预设列表 */
.preset-list {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(60, 68, 80, 0.35);
  background-color: rgba(20, 23, 28, 0.42);
}

.preset-list__header {
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  color: #b0b8c4;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
}

.preset-list__items {
  flex: 1;
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
}

.preset-list__item {
  padding: 6px 12px;
  font-size: 13px;
  color: #e6e6e6;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-left: 3px solid transparent;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.preset-list__item:hover {
  background-color: rgba(53, 60, 71, 0.42);
}

.preset-list__item.is-active {
  background-color: rgba(47, 128, 237, 0.18);
  border-left-color: #2f80ed;
  color: #ffffff;
}

.preset-list__empty {
  padding: 12px;
  font-size: 12px;
  color: #6b7280;
  text-align: center;
}

/* 右侧编辑区 */
.preset-editor {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.preset-editor__empty {
  margin: auto;
  color: #6b7280;
  font-size: 13px;
  padding: 24px;
}

.preset-editor__name {
  padding: 10px 16px;
  font-size: 13px;
  color: #b0b8c4;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  flex-shrink: 0;
}

.preset-editor__scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.filter-group__title {
  color: #8a93a3;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.4px;
  padding: 2px 0;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-row label {
  width: 56px;
  color: #8a93a3;
  font-size: 13px;
  flex-shrink: 0;
  padding: 4px 6px;
}

.form-input {
  flex: 1;
  padding: 6px 10px;
  background-color: rgba(38, 43, 52, 0.6);
  border: 1px solid rgba(60, 68, 80, 0.7);
  border-radius: 6px;
  color: #e6e6e6;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.form-input:focus {
  border-color: #2f80ed;
}

.form-row--check label {
  width: auto;
  cursor: default;
}

.form-row__check-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #e6e6e6;
  font-size: 13px;
  cursor: pointer;
}

.form-row__check {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #2f80ed;
}

.form-row__color-label {
  width: 56px;
  color: #8a93a3;
  font-size: 13px;
  flex-shrink: 0;
  padding: 4px 6px;
  cursor: default;
}

/* 右侧实时预览区（与编辑区同级） */
.preset-preview {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(60, 68, 80, 0.35);
  background-color: rgba(20, 23, 28, 0.42);
}

.preset-preview__header {
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  color: #b0b8c4;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  flex-shrink: 0;
}

.preset-preview__canvas {
  flex: 1;
  min-height: 0;
  padding: 12px;
  display: flex;
}

.preset-preview__canvas > * {
  flex: 1;
  height: 100%;
}

.preset-preview__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  font-size: 13px;
  padding: 24px;
  text-align: center;
}

/* 底部固定按钮区 */
.filter-preset-modal__footer {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(60, 68, 80, 0.35);
  background-color: rgba(35, 40, 48, 0.62);
  flex-shrink: 0;
}

.footer-btn {
  flex: 1;
  padding: 8px 12px;
  background-color: rgba(44, 49, 58, 0.7);
  border: 1px solid rgba(60, 68, 80, 0.7);
  border-radius: 4px;
  color: #ffffff;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.footer-btn:hover:not(:disabled) {
  background-color: rgba(53, 60, 71, 0.9);
}

.footer-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.footer-btn--primary {
  background-color: rgba(47, 128, 237, 0.85);
  border-color: rgba(47, 128, 237, 0.85);
  color: #ffffff;
}

.footer-btn--primary:hover:not(:disabled) {
  background-color: rgba(63, 144, 255, 0.95);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
