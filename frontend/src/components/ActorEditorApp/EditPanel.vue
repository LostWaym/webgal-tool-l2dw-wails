<script setup lang="ts">
/**
 * 演出编辑器的右侧面板：表情 Tab + 参数 Tab + 导出覆盖层。
 *
 * 来自原 ExpressionEditorModal.vue 的右侧部分 + 导出 Modal 逻辑，
 * 这里是迁移后的载体，不再是 Modal 而是独立面板。
 *
 * 不直接引用 ActorStage，而是通过 emit 'apply-params' 事件，
 * 由父组件 ActorEditApp 统一路由到舞台的 applyParameters()。
 */
import { computed, ref } from 'vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { pathCombine, pathDirname } from '../../path_utils'
import {
  readExpressionFile,
  exportAsExpJson,
  exportAsExp3Json,
  defaultExportDirForModel,
  buildExpJson,
  buildExp3Json,
  ensureDirAndOpenInExplorer,
  type ParamSnapshot,
} from '../../live2d/expressionUtils'
import { useActorEditorState, type ExportFormat } from '../../composables/useActorEditorState'
import { useMessage } from '../../composables/useMessage'
import EditRangeCard from '../ModelEditApp/EditRangeCard.vue'
import SearchInput from '../common/SearchInput.vue'
import { filterBySearch } from '../../utils/searchUtils'

const emit = defineEmits<{
  (e: 'apply-params', params: Array<{ id: string; val: number }>): void
}>()

const store = useWmdlModelEditorStore()
const msg = useMessage()
const editorState = useActorEditorState()

type RightTab = 'expressions' | 'params'
const activeTab = ref<RightTab>('expressions')

const currentSnapshot = ref<ParamSnapshot[]>([])
const activeExpressionKey = ref<string | null>(null)
const paramSearch = ref('')

const exportName = ref('my_expression')
const fadeIn = ref(500)
const fadeOut = ref(500)
const compress = ref(false)

const selectedModel = computed(() => store.selectedModel)
const expressions = computed(() => store.selectedModel?.expressions ?? [])
const hasSelection = computed(() => !!store.selectedModelId)
const isMoc3 = computed(() => store.selectedModel?.isMoc3 === true)
const defaultFormat = computed(() => (isMoc3.value ? 'exp3' : 'exp') as ExportFormat)

const defaultExportDir = computed(() => {
  const m = selectedModel.value
  if (!m) return ''
  return defaultExportDirForModel(m.jsonAbsPath)
})

const paramsView = computed(() => {
  const item = selectedModel.value
  if (!item) return []
  return item.initParams.map((p) => ({
    id: p.id,
    min: p.min ?? -1,
    max: p.max ?? 1,
    effective: p.override !== undefined ? p.override : p.value,
    hasOverride: p.override !== undefined,
  }))
})

const filteredParams = computed(() =>
  filterBySearch(paramsView.value, paramSearch.value, (p) => p.id),
)

const rightTabs: { id: RightTab; label: string }[] = [
  { id: 'expressions', label: '表情' },
  { id: 'params', label: '参数' },
]

async function onExpressionClick(item: { name: string; path: string }) {
  const m = selectedModel.value
  if (!m) return

  const absPath = pathCombine(pathDirname(m.jsonAbsPath), item.path)
  let result
  try {
    result = await readExpressionFile(absPath)
  } catch (e: any) {
    msg.error(`读取表情失败：${e?.message ?? e}`)
    return
  }

  // 先把所有参数重置为默认值，避免上一个表情或手动调整的 override 残留
  emit('apply-params', m.initParams.map((p) => ({ id: p.id, val: p.value })))
  for (const entry of m.initParams) {
    delete entry.override
  }

  // 同步到 store.initParams.override + 舞台子模型
  for (const p of result.snapshot) {
    const entry = m.initParams.find((it) => it.id === p.id)
    if (entry) entry.override = p.val
  }
  emit('apply-params', result.snapshot.map((s) => ({ id: s.id, val: s.val })))

  currentSnapshot.value = result.snapshot
  activeExpressionKey.value = `${item.name}\u0000${item.path}`
  msg.success(`已应用表情「${item.name}」(${result.snapshot.length} 个参数)`)
}

function onParamChange(id: string, value: number) {
  const m = selectedModel.value
  if (!m) return
  emit('apply-params', [{ id, val: value }])
  const entry = m.initParams.find((p) => p.id === id)
  if (entry) entry.override = value
}

function onParamReset(id: string) {
  const m = selectedModel.value
  if (!m) return
  const entry = m.initParams.find((p) => p.id === id)
  if (!entry) return
  emit('apply-params', [{ id, val: entry.value }])
  delete entry.override
}

function onOpenExport() {
  editorState.startExport()
  if (!editorState.state.selectedExportFormat) {
    editorState.setExportFormat(defaultFormat.value)
  }
}

async function onConfirmExport() {
  const m = selectedModel.value
  if (!m) return
  const fmt = editorState.state.selectedExportFormat
  if (!fmt) {
    msg.warning('请先选择导出格式')
    return
  }
  if (!exportName.value.trim()) {
    msg.warning('请输入表情名称')
    return
  }
  if (!currentSnapshot.value.length) {
    msg.warning('请先在表情 Tab 选中一个表情作为导出快照')
    return
  }

  const fileName =
    fmt === 'exp3'
      ? `${exportName.value.trim()}.exp3.json`
      : `${exportName.value.trim()}.exp.json`
  const targetPath = pathCombine(defaultExportDir.value, fileName)

  try {
    if (fmt === 'exp3') {
      await exportAsExp3Json(targetPath, exportName.value.trim(), currentSnapshot.value, fadeIn.value, fadeOut.value, compress.value)
    } else {
      await exportAsExpJson(targetPath, exportName.value.trim(), currentSnapshot.value, fadeIn.value, fadeOut.value, compress.value)
    }
    msg.success(`已导出到 ${targetPath}`)
    editorState.cancelExport()
  } catch (e: any) {
    msg.error(`导出失败：${e?.message ?? e}`)
  }
}

async function onCopyToClipboard() {
  const fmt = editorState.state.selectedExportFormat
  if (!fmt) {
    msg.warning('请先选择导出格式')
    return
  }
  if (!currentSnapshot.value.length) {
    msg.warning('请先在表情 Tab 选中一个表情作为导出快照')
    return
  }
  const text = fmt === 'exp3'
    ? buildExp3Json(currentSnapshot.value, fadeIn.value, fadeOut.value, compress.value)
    : buildExpJson(currentSnapshot.value, fadeIn.value, fadeOut.value, compress.value)
  try {
    await navigator.clipboard.writeText(text)
    msg.success('已复制到剪贴板')
  } catch {
    msg.error('复制到剪贴板失败')
  }
}

async function onOpenOutputDir() {
  const dir = defaultExportDir.value
  if (!dir) {
    msg.warning('暂无可用的输出目录')
    return
  }
  try {
    await ensureDirAndOpenInExplorer(dir)
    msg.success(`已打开输出目录：${dir}`)
  } catch (e: any) {
    msg.error(`打开输出目录失败：${e?.message ?? e}`)
  }
}
</script>

<template>
  <div class="actor-panel">
    <header class="actor-panel__header">
      <h2 class="actor-panel__title">
        编辑面板
        <span class="actor-panel__subtitle" v-if="selectedModel">（{{ selectedModel.name }}）</span>
      </h2>
      <button
        class="toolbar-btn toolbar-btn--primary"
        :disabled="!hasSelection || !currentSnapshot.length"
        @click="onOpenExport"
      >导出</button>
    </header>

    <div class="actor-panel__tabs">
      <button
        v-for="t in rightTabs"
        :key="t.id"
        class="tab-btn"
        :class="{ 'is-active': activeTab === t.id }"
        @click="activeTab = t.id"
      >{{ t.label }}</button>
    </div>

    <div class="actor-panel__body">
      <template v-if="activeTab === 'expressions'">
        <div v-if="!hasSelection" class="empty-hint">请先选择模型</div>
        <div v-else-if="!expressions.length" class="empty-hint">该模型暂无表情</div>
        <ul v-else class="expr-list">
          <li
            v-for="item in expressions"
            :key="item.name + '\u0000' + item.path"
            class="expr-list__item"
            :class="{ 'is-active': activeExpressionKey === (item.name + '\u0000' + item.path) }"
            :title="item.path"
            @click="onExpressionClick(item)"
          >
            <span class="expr-list__name">{{ item.name }}</span>
            <span class="expr-list__path">{{ item.path }}</span>
          </li>
        </ul>
      </template>

      <template v-else>
        <div v-if="!hasSelection" class="empty-hint">请先选择模型</div>
        <div v-else-if="!paramsView.length" class="empty-hint">该模型暂无参数</div>
        <div v-else class="params-tab">
          <div class="params-tab__toolbar">
            <SearchInput
              v-model="paramSearch"
              variant="edit"
              placeholder="搜索参数(空格分隔多个关键词)"
            />
          </div>
          <div class="params-tab__scroll">
            <div v-if="!filteredParams.length" class="empty-hint">无匹配参数</div>
            <ul v-else class="params-tab__grid">
              <li v-for="p in filteredParams" :key="p.id" class="params-tab__item">
                <EditRangeCard
                  :name="p.id"
                  :min="p.min"
                  :max="p.max"
                  :model-value="p.effective"
                  :highlight="p.hasOverride"
                  :show-reset="p.hasOverride"
                  @update:model-value="onParamChange(p.id, $event)"
                  @reset="onParamReset(p.id)"
                />
              </li>
            </ul>
          </div>
        </div>
      </template>
    </div>

    <!-- 导出覆盖层 -->
    <Transition name="fade-fast">
      <div v-if="editorState.state.exportMode" class="actor-export-mask" @click.self="editorState.cancelExport()">
        <div class="actor-export-modal">
          <header class="actor-export-modal__header">
            <h3 class="actor-export-modal__title">导出表情</h3>
            <button class="icon-btn" aria-label="关闭" @click="editorState.cancelExport()">×</button>
          </header>
          <section class="actor-export-modal__body">
            <label class="export-field">
              <span class="export-field__label">表情名称</span>
              <input
                v-model="exportName"
                class="export-field__input"
                type="text"
                placeholder="例如 my_expression"
              />
            </label>

            <div class="export-field">
              <span class="export-field__label">格式</span>
              <div class="export-format">
                <button
                  type="button"
                  class="export-format__opt"
                  :class="{ 'is-active': editorState.state.selectedExportFormat === 'exp' }"
                  @click="editorState.setExportFormat('exp')"
                >
                  <span class="export-format__title">.exp.json</span>
                  <span class="export-format__desc">Cubism 2 (moc)</span>
                </button>
                <button
                  type="button"
                  class="export-format__opt"
                  :class="{ 'is-active': editorState.state.selectedExportFormat === 'exp3' }"
                  @click="editorState.setExportFormat('exp3')"
                >
                  <span class="export-format__title">.exp3.json</span>
                  <span class="export-format__desc">Cubism 3+ (moc3)</span>
                </button>
              </div>
              <p v-if="isMoc3" class="export-field__hint">当前模型为 moc3，建议使用 .exp3.json</p>
              <p v-else class="export-field__hint">当前模型为 moc，建议使用 .exp.json</p>
            </div>

            <div class="export-field export-field--inline">
              <label class="export-field__sub">
                <span>fade_in</span>
                <input v-model.number="fadeIn" class="export-field__input export-field__input--small" type="number" min="0" />
              </label>
              <label class="export-field__sub">
                <span>fade_out</span>
                <input v-model.number="fadeOut" class="export-field__input export-field__input--small" type="number" min="0" />
              </label>
            </div>

            <label class="export-checkbox">
              <input v-model="compress" type="checkbox" />
              <span>压缩输出（单行）</span>
            </label>

            <p class="export-preview">
              将写入：<code>{{ defaultExportDir }}/{{ exportName }}{{ editorState.state.selectedExportFormat === 'exp3' ? '.exp3.json' : '.exp.json' }}</code>
            </p>
            <p class="export-preview">
              快照参数：{{ currentSnapshot.length }} 个
            </p>
          </section>
          <footer class="actor-export-modal__footer">
            <button class="card-btn" @click="onOpenOutputDir">打开输出目录</button>
            <button class="card-btn" @click="editorState.cancelExport()">取消</button>
            <button class="card-btn" @click="onCopyToClipboard">复制到剪贴板</button>
            <button class="card-btn card-btn--primary" @click="onConfirmExport">确认导出</button>
          </footer>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.actor-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
}

.actor-panel__header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  flex-shrink: 0;
}

.actor-panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  flex: 1;
  color: #ffffff;
}

.actor-panel__subtitle {
  font-size: 12px;
  font-weight: 400;
  color: #b0b8c4;
  margin-left: 4px;
}

.actor-panel__tabs {
  display: flex;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  padding: 0 12px;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 10px 8px;
  background: transparent;
  border: none;
  color: #8a93a3;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s, border-bottom 0.15s;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tab-btn:hover {
  color: #e6e6e6;
}

.tab-btn.is-active {
  color: #e6e6e6;
  border-bottom-color: #2f80ed;
}

.actor-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  min-height: 0;
}

.expr-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.expr-list__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 16px;
  font-size: 13px;
  color: #e6e6e6;
  border-left: 3px solid transparent;
  cursor: pointer;
  user-select: text;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.expr-list__item:hover {
  background: #2a2e37;
}

.expr-list__item.is-active {
  border-left-color: #2f80ed;
  background: #2a2e37;
}

.expr-list__name {
  font-weight: 500;
}

.expr-list__path {
  font-size: 11px;
  color: #8a93a3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.params-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 0;
}

.params-tab__toolbar {
  flex: 0 0 auto;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
}

.params-tab__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 12px 12px;
}

.params-tab__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: stretch;
}

.params-tab__item {
  flex: 1 1 150px;
  max-width: 300px;
  min-width: 0;
  display: block;
}

.empty-hint {
  margin: auto;
  color: #6b7280;
  font-size: 13px;
  text-align: center;
  padding: 16px;
}

.actor-export-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
}

.actor-export-modal {
  background-color: rgba(29, 32, 38, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  width: min(440px, 92%);
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

.actor-export-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
}

.actor-export-modal__title {
  margin: 0;
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}

.actor-export-modal__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.actor-export-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(60, 68, 80, 0.35);
}

.export-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #c8ceda;
}

.export-field--inline {
  flex-direction: row;
  gap: 12px;
}

.export-field__label {
  color: #b0b8c4;
  font-size: 12px;
}

.export-field__sub {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.export-field__input {
  background-color: rgba(20, 23, 28, 0.6);
  border: 1px solid rgba(60, 68, 80, 0.7);
  border-radius: 4px;
  color: #ffffff;
  font-size: 13px;
  padding: 6px 8px;
  outline: none;
}

.export-field__input:focus {
  border-color: rgba(47, 128, 237, 0.85);
}

.export-field__input--small {
  width: 100%;
  box-sizing: border-box;
}

.export-field__hint {
  margin: 0;
  font-size: 11px;
  color: #8a93a3;
}

.export-format {
  display: flex;
  gap: 8px;
}

.export-format__opt {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  background-color: rgba(35, 40, 48, 0.5);
  border: 1px solid rgba(60, 68, 80, 0.7);
  border-radius: 6px;
  color: #c8ceda;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  transition: border-color 0.12s, background-color 0.12s, color 0.12s;
}

.export-format__opt:hover {
  border-color: rgba(47, 128, 237, 0.45);
}

.export-format__opt.is-active {
  border-color: rgba(47, 128, 237, 0.85);
  background-color: rgba(47, 128, 237, 0.18);
  color: #ffffff;
}

.export-format__title {
  font-weight: 600;
  font-size: 13px;
}

.export-format__desc {
  font-size: 11px;
  color: #8a93a3;
}

.export-preview {
  margin: 0;
  font-size: 11px;
  color: #b0b8c4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  word-break: break-all;
}

.export-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #c8ceda;
  cursor: pointer;
}

.export-checkbox input {
  width: 14px;
  height: 14px;
  accent-color: #2f80ed;
  cursor: pointer;
}

.card-btn {
  padding: 6px 14px;
  background-color: rgba(44, 49, 58, 0.7);
  border: 1px solid rgba(60, 68, 80, 0.7);
  border-radius: 4px;
  color: #ffffff;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.12s;
}

.card-btn:hover {
  background-color: rgba(53, 60, 71, 0.9);
}

.card-btn--primary {
  background-color: rgba(47, 128, 237, 0.85);
  border-color: rgba(47, 128, 237, 0.85);
}

.card-btn--primary:hover {
  background-color: rgba(63, 144, 255, 0.95);
}

.toolbar-btn {
  padding: 6px 14px;
  background: #2c313a;
  color: #e6e6e6;
  border: 1px solid #2c313a;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s ease;
}

.toolbar-btn:hover:not(:disabled) {
  background: #353c47;
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn--primary {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #fff;
}

.toolbar-btn--primary:hover:not(:disabled) {
  background: #3f90ff;
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

.fade-fast-enter-active,
.fade-fast-leave-active {
  transition: opacity 0.12s ease;
}

.fade-fast-enter-from,
.fade-fast-leave-to {
  opacity: 0;
}
</style>
