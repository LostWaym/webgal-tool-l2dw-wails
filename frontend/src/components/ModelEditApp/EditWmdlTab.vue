<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { choosePath } from '../../utils/fileDialog'
import { useWmdlModelEditorStore, type WmdlModelItem } from '../../stores/wmdlModelEditor'
import { PickWmdlFile, ReadWmdlFile, SaveWmdlFile, SaveWmdlFileDialog } from '../../../wailsjs/go/main/App'
import { useMessage } from '../../composables/useMessage'

/**
 * EditWmdlTab — EditActionPanel 的子组件，负责 wmdl 页签内容。
 *
 * 功能分区：
 *  1. 顶部：加载 / 保存 按钮 + 当前文件名
 *  2. wmdl 配置编辑：name / figureTemplate / transformTemplate / live2dBounds
 *  3. 模型列表：独立渲染，带 offsetX/offsetY/modelRelativePath 编辑
 *
 * 选中状态通过 wmdlModels.selectedModelId 统一管理，与 EditModelList 自然同步。
 */
const store = useWmdlModelEditorStore()
const message = useMessage()

// 拖拽 offsetX/offsetY 标签时，每像素变化对应的数值增量
const OFFSET_DRAG_SENSITIVITY = 0.1

// ─── 加载 / 保存 ───────────────────────────────────────────────────────────

const busy = ref(false)

async function onLoad() {
  if (busy.value) return
  busy.value = true
  try {
    const path = await choosePath(() => PickWmdlFile())
    if (!path) return
    // json 路径：内存构造只含主模型的 wmdl（不写盘）
    if (path.toLowerCase().endsWith('.json')) {
      await store.loadInMemory(path)
      return
    }
    const content = await ReadWmdlFile(path)
    await store.fromJson(content, path)
  } catch (e) {
    console.error('Load wmdl failed', e)
    message.error(`加载 wmdl 失败: ${e}`)
  } finally {
    busy.value = false
  }
}

async function onSave() {
  if (busy.value) return
  busy.value = true
  try {
    const path = await choosePath(() => SaveWmdlFileDialog())
    if (!path) return
    // Update the wmdlFilePath anchor BEFORE toJson so the relative paths
    // it computes are anchored at the new file location (handles "Save As"
    // and the first save of an unsaved wmdl).
    store.currentWmdl.wmdlFilePath = path
    const content = store.toJson()
    await SaveWmdlFile(path, content)
    message.success('保存成功')
  } catch (e) {
    console.error('Save wmdl failed', e)
    message.error(`保存 wmdl 失败: ${e}`)
  } finally {
    busy.value = false
  }
}

// ─── 模型 json 保存 ────────────────────────────────────────────────────────

async function onSaveSelectedModelJson() {
  if (busy.value) return
  const id = store.selectedModelId
  if (!id) {
    message.warning('请先在模型列表中选中一个模型')
    return
  }
  busy.value = true
  try {
    const res = await store.saveModelJson(id)
    if (res) message.success(`已保存：${res.path}`)
  } catch (e) {
    console.error('Save model json failed', e)
    message.error(`保存模型 json 失败: ${e}`)
  } finally {
    busy.value = false
  }
}

async function onSaveAllModelJsons() {
  if (busy.value) return
  if (store.currentWmdl.models.length === 0) {
    message.warning('当前没有任何模型')
    return
  }
  busy.value = true
  try {
    const saved = await store.saveAllModelJsons()
    if (saved.length === 0) {
      message.warning('没有可保存的模型')
    } else {
      message.success(`已保存 ${saved.length} 个模型 json:\n${saved.join('\n')}`, { duration: 5000 })
    }
  } catch (e) {
    console.error('Save all model jsons failed', e)
    message.error(`批量保存失败: ${e}`)
  } finally {
    busy.value = false
  }
}

async function onSaveSelectedModelJsonAs() {
  if (busy.value) return
  const id = store.selectedModelId
  if (!id) {
    message.warning('请先在模型列表中选中一个模型')
    return
  }
  busy.value = true
  try {
    const res = await store.saveModelJsonAs(id)
    if (res) message.success(`已另存为：${res.path}`)
  } catch (e) {
    console.error('Save model json as failed', e)
    message.error(`另存模型 json 失败: ${e}`)
  } finally {
    busy.value = false
  }
}

// ─── 字段更新 ───────────────────────────────────────────────────────────────

function updateName(v: string) {
  store.updateConfig({ name: v })
}

function updateFigureTemplate(v: string) {
  store.updateConfig({ figureTemplate: v })
}

function updateTransformTemplate(v: string) {
  store.updateConfig({ transformTemplate: v })
}

function generateFigureTemplate() {
  store.updateConfig({ figureTemplate: 'changeFigure:%conf_path% -id=%name% %me%;' })
}

function generateTransformTemplate() {
  store.updateConfig({ transformTemplate: 'setTransform:%me% -target=%name% -duration=750 -writeDefault;' })
}

function updateBound(index: 0 | 1 | 2 | 3, v: string) {
  const num = Number(v)
  if (Number.isNaN(num)) return
  const next: [number, number, number, number] = [...store.currentWmdl.live2dBounds]
  next[index] = num
  store.updateConfig({ live2dBounds: next })
}

// ─── 模型项操作 ─────────────────────────────────────────────────────────────

async function onRemoveModel(id: string) {
  await store.removeModel(id)
}

async function onChangeModelPath(id: string) {
  await store.changeModelPath(id)
}

function updateOffsetX(model: WmdlModelItem, v: string) {
  const num = Number(v)
  if (Number.isNaN(num)) return
  store.updateModelOffset(model.id, num, model.offsetY)
}

function updateOffsetY(model: WmdlModelItem, v: string) {
  const num = Number(v)
  if (Number.isNaN(num)) return
  store.updateModelOffset(model.id, model.offsetX, num)
}

// ─── offsetX/offsetY 拖拽增减值 ────────────────────────────────────────────
type OffsetField = 'offsetX' | 'offsetY'
const dragging = ref<{ model: WmdlModelItem; field: OffsetField; startX: number; startVal: number } | null>(null)

function onOffsetLabelMouseDown(field: OffsetField, e: MouseEvent, model: WmdlModelItem) {
  // 仅响应主键，避免与右键 / 中键冲突
  if (e.button !== 0) return
  dragging.value = {
    model,
    field,
    startX: e.clientX,
    startVal: field === 'offsetX' ? model.offsetX : model.offsetY,
  }
  window.addEventListener('mousemove', onOffsetDragMouseMove)
  window.addEventListener('mouseup', onOffsetDragMouseUp)
  e.preventDefault()
}

function onOffsetDragMouseMove(e: MouseEvent) {
  const d = dragging.value
  if (!d) return
  const delta = (e.clientX - d.startX) * OFFSET_DRAG_SENSITIVITY
  const next = d.startVal + delta
  if (d.field === 'offsetX') {
    store.updateModelOffset(d.model.id, next, d.model.offsetY)
  } else {
    store.updateModelOffset(d.model.id, d.model.offsetX, next)
  }
}

function onOffsetDragMouseUp() {
  dragging.value = null
  window.removeEventListener('mousemove', onOffsetDragMouseMove)
  window.removeEventListener('mouseup', onOffsetDragMouseUp)
}

function onSelectModel(id: string) {
  store.selectModel(store.selectedModelId === id ? null : id)
}

// 主模型 = models[0]，下标变化时把新首项的 offsetX/Y 强制归零
const mainId = computed(() => store.currentWmdl.models[0]?.id ?? null)

watch(mainId, (id) => {
  if (!id) return
  const m = store.currentWmdl.models[0]
  if (!m) return
  if (m.offsetX !== 0 || m.offsetY !== 0) {
    store.updateModelOffset(id, 0, 0)
  }
})

function isMain(m: WmdlModelItem): boolean {
  return m.id === mainId.value
}

// ─── 文件名展示 ─────────────────────────────────────────────────────────────

const fileName = computed(() => {
  const p = store.currentWmdl.wmdlFilePath
  if (!p) return '（未保存）'
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(idx + 1) : p
})
</script>

<template>
  <div class="wmdl-tab">
    <!-- 顶部操作区 -->
    <div class="file-name" :title="store.currentWmdl.wmdlFilePath">{{ fileName }}</div>
    <header class="wmdl-tab__header">
      <button class="ui-button ui-button--primary op-btn" :disabled="busy" @click="onLoad">加载 wmdl</button>
      <button class="ui-button op-btn" :disabled="busy" @click="onSave">保存 wmdl</button>
    </header>

    <!-- 模型 json 保存 -->
    <section class="model-json-save">
      <h3 class="section-title model-json-save__title">模型json保存</h3>
      <div class="model-json-save__row">
        <button class="ui-button op-btn" :disabled="busy || !store.selectedModelId" @click="onSaveSelectedModelJson">
          保存当前选中
        </button>
        <button class="ui-button op-btn" :disabled="busy || store.currentWmdl.models.length === 0" @click="onSaveAllModelJsons">
          保存所有
        </button>
        <!-- 暂时不支持另存为 -->
        <!-- <button class="op-btn" :disabled="busy || !store.selectedModelId" @click="onSaveSelectedModelJsonAs">
          当前另存为
        </button> -->
      </div>
    </section>

    <!-- 配置编辑区 -->
    <section class="config-section">
      <label class="field">
        <span class="field__label">名称</span>
        <input
          class="field__input"
          type="text"
          :value="store.currentWmdl.name"
          @input="updateName(($event.target as HTMLInputElement).value)"
        />
      </label>

      <label class="field">
        <div class="field__label-row">
          <span class="field__label">figureTemplate</span>
          <button class="gen-btn" @click="generateFigureTemplate">生成wmdl模板</button>
        </div>
        <textarea
          class="field__textarea"
          rows="4"
          :value="store.currentWmdl.figureTemplate"
          @input="updateFigureTemplate(($event.target as HTMLTextAreaElement).value)"
        />
      </label>

      <label class="field">
        <div class="field__label-row">
          <span class="field__label">transformTemplate</span>
          <button class="gen-btn" @click="generateTransformTemplate">生成wmdl模板</button>
        </div>
        <textarea
          class="field__textarea"
          rows="4"
          :value="store.currentWmdl.transformTemplate"
          @input="updateTransformTemplate(($event.target as HTMLTextAreaElement).value)"
        />
      </label>

      <div class="field">
        <span class="field__label">live2dBounds [x, y, w, h]</span>
        <div class="bounds-row">
          <input
            v-for="i in 4"
            :key="i"
            class="field__input field__input--num"
            type="number"
            :value="store.currentWmdl.live2dBounds[i - 1]"
            @input="updateBound((i - 1) as 0 | 1 | 2 | 3, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </section>

    <!-- 模型列表区 -->
    <section class="models-section">
      <h3 class="section-title">模型列表</h3>
      <ul v-if="store.currentWmdl.models.length" class="models-list">
        <li
          v-for="m in store.currentWmdl.models"
          :key="m.id"
          class="model-item"
          :class="{ 'is-selected': m.id === store.selectedModelId }"
          @click="onSelectModel(m.id)"
        >
          <div class="model-item__name" :title="m.modelRelativePath">{{ m.name }}</div>
          <div class="model-item__path-row">
            <span class="path-text">{{ m.modelRelativePath }}</span>
            <button class="mini-btn" @click.stop="onChangeModelPath(m.id)">更改</button>
            <button class="mini-btn mini-btn--danger" @click.stop="onRemoveModel(m.id)">删除</button>
          </div>
          <div v-show="!isMain(m)" class="model-item__offset-row">
            <label class="offset-field">
              <span
                class="offset-field__handle"
                :class="{ 'offset-field__handle--dragging': dragging?.model.id === m.id && dragging?.field === 'offsetX' }"
                @mousedown="onOffsetLabelMouseDown('offsetX', $event, m)"
              >offsetX</span>
              <input
                class="field__input field__input--num"
                type="number"
                :value="m.offsetX"
                @input="updateOffsetX(m, ($event.target as HTMLInputElement).value)"
                @click.stop
              />
            </label>
            <label class="offset-field">
              <span
                class="offset-field__handle"
                :class="{ 'offset-field__handle--dragging': dragging?.model.id === m.id && dragging?.field === 'offsetY' }"
                @mousedown="onOffsetLabelMouseDown('offsetY', $event, m)"
              >offsetY</span>
              <input
                class="field__input field__input--num"
                type="number"
                :value="m.offsetY"
                @input="updateOffsetY(m, ($event.target as HTMLInputElement).value)"
                @click.stop
              />
            </label>
          </div>
        </li>
      </ul>
      <p v-else class="models-empty">尚未添加模型</p>
    </section>
  </div>
</template>

<style scoped>
.wmdl-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  gap: 14px;
  overflow-y: auto;
}

.wmdl-tab__header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.op-btn {
  padding: 8px 14px;
  font-size: 13px;
}

.file-name {
  font-size: 12px;
  color: var(--ui-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.config-section,
.models-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.model-json-save {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.model-json-save__row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text);
  border-bottom: 1px solid var(--ui-line);
  padding-bottom: 6px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--ui-muted);
}

.field__label {
  font-size: 12px;
  color: var(--ui-muted);
}

.field__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.gen-btn {
  padding: 3px 8px;
  background: var(--ui-control);
  color: var(--ui-muted);
  border: 1px solid var(--ui-edge);
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.12s ease;
}

.gen-btn:hover {
  background: var(--ui-hover);
  color: var(--ui-text);
}

.field__input,
.field__textarea {
  padding: 6px 8px;
  background: var(--ui-well);
  border: 1px solid var(--ui-edge);
  border-radius: var(--ui-radius-compact);
  color: var(--ui-text);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}

.field__input:focus,
.field__textarea:focus {
  border-color: var(--ui-link);
}

.field__input--num {
  width: 80px;
}

.bounds-row {
  display: flex;
  gap: 6px;
}

.bounds-row .field__input--num {
  flex: 1 1 0;
  min-width: 0;
  max-width: 80px;
}

.models-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-item {
  background: var(--ui-well);
  border: 1px solid var(--ui-line);
  border-left: 3px solid transparent;
  border-radius: 4px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.model-item:hover {
  background: var(--ui-panel);
}

.model-item.is-selected {
  background: var(--ui-selected);
  border-left-color: var(--ui-link);
}

.model-item__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--ui-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-item__path-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--ui-muted);
}

.path-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.model-item__offset-row {
  display: flex;
  gap: 12px;
}

.offset-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--ui-muted);
  min-width: 0;
  flex: 1;
}

.offset-field__handle {
  cursor: col-resize;
  user-select: none;
}

.offset-field__handle--dragging {
  user-select: none;
}

.offset-field .field__input--num {
  flex: 1 1 0;
  min-width: 0;
  max-width: 80px;
}

.mini-btn {
  padding: 4px 10px;
  background: var(--ui-control);
  color: var(--ui-text);
  border: 1px solid var(--ui-edge);
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  transition: background 0.12s ease;
}

.mini-btn:hover {
  background: var(--ui-hover);
}

.mini-btn--danger:hover {
  background: var(--ui-danger);
  border-color: var(--ui-danger); color: var(--ui-on-status);
}

.models-empty {
  margin: 0;
  padding: 16px;
  color: var(--ui-muted);
  font-size: 13px;
  text-align: center;
}
</style>
