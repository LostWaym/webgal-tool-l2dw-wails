<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWmdlModelEditorStore } from '../../../stores/wmdlModelEditor'
import { pathCombine, pathDirname } from '../../../path_utils'
import { useExpressionEditorModal, type ExportFormat } from '../../../composables/useExpressionEditorModal'
import { useMessage } from '../../../composables/useMessage'
import {
  readExpressionFile,
  exportAsExpJson,
  exportAsExp3Json,
  defaultExportDirForModel,
  type ParamSnapshot,
} from '../../../live2d/expressionUtils'
import type { WmdlConfig } from '../../../stores/wmdlTypes'
import Live2dPreview from '../../common/Live2dPreview.vue'
import EditRangeCard from '../EditRangeCard.vue'
import SearchInput from '../../common/SearchInput.vue'
import { filterBySearch } from '../../../utils/searchUtils'

/**
 * 表情编辑模态。
 *
 * 布局：左侧 Live2dPreview 预览（独立 PIXI 实例），右侧 [表情 / 参数] 页签。
 * 表情 Tab 点击条目 → 读取表情 JSON，把参数写到 store.initParams.override + Live2dPreview。
 * 参数 Tab 使用 EditRangeCard 网格 + 顶部搜索栏（与 EditParamsTab 一致），可拖动实时调参。
 * 顶栏"导出"按钮 → 进入导出覆盖层，让用户选 .exp.json / .exp3.json。
 *
 * 预览复用 Live2dPreview：表情点击 / 参数拖动 / 重置 三个动作都会通过 previewRef.applyParameters
 * 同步到独立的 PIXI 子模型，确保模态内预览实时刷新（与主舞台互不干扰）。
 */

const store = useWmdlModelEditorStore()
const msg = useMessage()
const modal = useExpressionEditorModal()

type RightTab = 'params' | 'expressions'
const activeTab = ref<RightTab>('expressions')

/** Live2dPreview 组件引用，用于在表情点击 / 参数拖动时同步写入子模型 */
const previewRef = ref<InstanceType<typeof Live2dPreview> | null>(null)

/** 当前快照（用户在表情 Tab 每次点击覆盖后会被替换为最新一组）。 */
const currentSnapshot = ref<ParamSnapshot[]>([])
/** 上次点击的表情条目 key（高亮） */
const activeExpressionKey = ref<string | null>(null)

/** 参数 Tab 搜索词 */
const paramSearch = ref('')

// 导出覆盖层状态
const exportName = ref('my_expression')
const fadeIn = ref(500)
const fadeOut = ref(500)

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

/**
 * Live2dPreview 接受 wmdlConfig 作为模型数据源。
 * 我们只展示"当前选中模型"，因此构造一个仅含一个 models 的伪 wmdlConfig。
 * 用 ref + watch 而非 computed：保证 previewConfig 引用稳定，避免参数修改触发
 * Live2dPreview 的 deep watch 重新加载模型。
 */
const previewConfig = ref<WmdlConfig | null>(null)
let lastModelId: string | null = null

function buildPreviewConfig(): WmdlConfig | null {
  const m = selectedModel.value
  if (!m) return null
  return {
    name: m.name,
    figureTemplate: '',
    transformTemplate: '',
    live2dBounds: [0, 0, 0, 0],
    models: [m],
    wmdlFilePath: '',
  }
}

previewConfig.value = buildPreviewConfig()

watch(
  () => store.selectedModelId,
  (newId) => {
    if (newId !== lastModelId) {
      lastModelId = newId
      previewConfig.value = buildPreviewConfig()
    }
  },
)

// ── 参数 Tab 视图（与 EditParamsTab 几乎一致）────────────────────────────

/** 把 store.initParams 投影为卡片可用的视图模型。 */
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

/**
 * 搜索过滤：复用项目内 filterBySearch。
 * 规则：trim 空串不过滤；多关键字空格分隔，全部命中才显示；不区分大小写。
 */
const filteredParams = computed(() =>
  filterBySearch(paramsView.value, paramSearch.value, (p) => p.id),
)

// ── 表情点击 → 写回参数 + 缓存快照 ──────────────────────────────────────

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
  previewRef.value?.applyParameters(
    m.initParams.map((p) => ({ id: p.id, val: p.value })),
  )
  for (const entry of m.initParams) {
    delete entry.override
  }

  // 同步到 store.initParams.override + Live2dPreview 子模型
  for (const p of result.snapshot) {
    const entry = m.initParams.find((it) => it.id === p.id)
    if (entry) entry.override = p.val
  }
  previewRef.value?.applyParameters(
    result.snapshot.map((s) => ({ id: s.id, val: s.val })),
  )

  // 保留 currentSnapshot：导出 .exp.json / .exp3.json 需要 calc 字段信息
  // （store.initParams.override 只存值，不带 calc），所以这里仍是必要的缓存。
  currentSnapshot.value = result.snapshot
  activeExpressionKey.value = `${item.name}\u0000${item.path}`
  msg.success(`已应用表情「${item.name}」（${result.snapshot.length} 个参数）`)
}

// ── 参数拖动 / 重置 ─────────────────────────────────────────────────────

function onParamChange(id: string, value: number) {
  const m = selectedModel.value
  if (!m) return
  // 同步到 Live2dPreview 子模型 + store.override（与 EditParamsTab 一致）
  previewRef.value?.applyParameters([{ id, val: value }])
  const entry = m.initParams.find((p) => p.id === id)
  if (entry) entry.override = value
}

function onParamReset(id: string) {
  const m = selectedModel.value
  if (!m) return
  const entry = m.initParams.find((p) => p.id === id)
  if (!entry) return
  previewRef.value?.applyParameters([{ id, val: entry.value }])
  delete entry.override
}

// ── 模态关闭时清空快照与高亮 ─────────────────────────────────────────

watch(
  () => modal.state.visible,
  (visible) => {
    if (visible) {
      // 打开时：重置所有临时状态，避免脏数据残留
      activeTab.value = 'expressions'
      paramSearch.value = ''
      exportName.value = 'my_expression'
      fadeIn.value = 500
      fadeOut.value = 500
      currentSnapshot.value = []
      activeExpressionKey.value = null
      // 重建 previewConfig：强制让 Live2dPreview 重新加载并清空残留参数
      lastModelId = null
      previewConfig.value = buildPreviewConfig()
      modal.setExportFormat(defaultFormat.value)
    } else {
      currentSnapshot.value = []
      activeExpressionKey.value = null
    }
  },
)

// ── 导出覆盖层 ────────────────────────────────────────────────────────────

function onOpenExport() {
  modal.startExport()
  if (!modal.state.selectedExportFormat) {
    modal.setExportFormat(defaultFormat.value)
  }
}

async function onConfirmExport() {
  const m = selectedModel.value
  if (!m) return
  const fmt = modal.state.selectedExportFormat
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
      await exportAsExp3Json(targetPath, exportName.value.trim(), currentSnapshot.value, fadeIn.value, fadeOut.value)
    } else {
      await exportAsExpJson(targetPath, exportName.value.trim(), currentSnapshot.value, fadeIn.value, fadeOut.value)
    }
    msg.success(`已导出到 ${targetPath}`)
    modal.cancelExport()
  } catch (e: any) {
    msg.error(`导出失败：${e?.message ?? e}`)
  }
}

// ── 关闭逻辑 ─────────────────────────────────────────────────────────────

function onClose() {
  modal.close()
}

function onMaskClick() {
  if (modal.state.exportMode) return
  onClose()
}

// ── 右侧 Tab UI ────────────────────────────────────────────────────────────

const rightTabs: { id: RightTab; label: string }[] = [
  { id: 'expressions', label: '表情' },
  { id: 'params', label: '参数' },
]

// 卡片流式布局常量（与 EditParamsTab 一致）
const LAYOUT = {
  CARD_MIN_WIDTH: 150,
  CARD_MAX_WIDTH: 300,
  GAP: 8,
} as const
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modal.state.visible" class="expr-mask" @click.self="onMaskClick">
        <div class="expr-modal" @click.stop>
          <header class="expr-modal__header">
            <h2 class="expr-modal__title">
              表情编辑
              <span class="expr-modal__subtitle" v-if="selectedModel">（{{ selectedModel.name }}）</span>
            </h2>
            <div class="expr-modal__header-actions">
              <button
                class="toolbar-btn toolbar-btn--primary"
                :disabled="!hasSelection || !currentSnapshot.length"
                @click="onOpenExport"
              >导出</button>
              <button class="icon-btn" aria-label="关闭" @click="onClose">×</button>
            </div>
          </header>

          <section class="expr-modal__body">
            <!-- 左侧预览：复用 Live2dPreview -->
            <div class="expr-modal__preview">
              <Live2dPreview
                v-if="previewConfig"
                ref="previewRef"
                :wmdl-config="previewConfig"
                class="expr-modal__preview-canvas"
              />
              <p v-if="!hasSelection" class="expr-modal__hint">请先选择模型</p>
            </div>

            <!-- 右侧 Tab 容器 -->
            <aside class="expr-modal__panel">
              <div class="expr-modal__tabs">
                <button
                  v-for="t in rightTabs"
                  :key="t.id"
                  class="tab-btn"
                  :class="{ 'is-active': activeTab === t.id }"
                  @click="activeTab = t.id"
                >{{ t.label }}</button>
              </div>
              <div class="expr-modal__panel-body">
                <!-- 表情 Tab -->
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
                <!-- 参数 Tab：搜索栏 + EditRangeCard 网格 -->
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
                      <div v-if="!filteredParams.length" class="empty-hint">
                        无匹配参数
                      </div>
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
            </aside>
          </section>

          <!-- 导出覆盖层 -->
          <Transition name="fade-fast">
            <div v-if="modal.state.exportMode" class="expr-export-mask" @click.self="modal.cancelExport()">
              <div class="expr-export-modal">
                <header class="expr-export-modal__header">
                  <h3 class="expr-export-modal__title">导出表情</h3>
                  <button class="icon-btn" aria-label="关闭" @click="modal.cancelExport()">×</button>
                </header>
                <section class="expr-export-modal__body">
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
                        :class="{ 'is-active': modal.state.selectedExportFormat === 'exp' }"
                        @click="modal.setExportFormat('exp')"
                      >
                        <span class="export-format__title">.exp.json</span>
                        <span class="export-format__desc">Cubism 2 (moc)</span>
                      </button>
                      <button
                        type="button"
                        class="export-format__opt"
                        :class="{ 'is-active': modal.state.selectedExportFormat === 'exp3' }"
                        @click="modal.setExportFormat('exp3')"
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

                  <p class="export-preview">
                    将写入：<code>{{ defaultExportDir }}/{{ exportName }}{{ modal.state.selectedExportFormat === 'exp3' ? '.exp3.json' : '.exp.json' }}</code>
                  </p>
                  <p class="export-preview">
                    快照参数：{{ currentSnapshot.length }} 个
                  </p>
                </section>
                <footer class="expr-export-modal__footer">
                  <button class="card-btn" @click="modal.cancelExport()">取消</button>
                  <button class="card-btn card-btn--primary" @click="onConfirmExport">确认导出</button>
                </footer>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.expr-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}

.expr-modal {
  background-color: rgba(29, 32, 38, 0.85);
  color: #e6e6e6;
  width: min(960px, 96vw);
  height: min(640px, 86vh);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  position: relative;
}

.expr-modal__header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  flex-shrink: 0;
}

.expr-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
  color: #ffffff;
}

.expr-modal__subtitle {
  font-size: 13px;
  font-weight: 400;
  color: #b0b8c4;
  margin-left: 4px;
}

.expr-modal__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.expr-modal__body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
}

.expr-modal__preview {
  flex: 1;
  min-width: 0;
  position: relative;
  background: #11141a;
  display: flex;
}

.expr-modal__preview-canvas {
  width: 100%;
  height: 100%;
}

.expr-modal__hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: #6b7280;
  font-size: 13px;
  pointer-events: none;
}

.expr-modal__panel {
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(60, 68, 80, 0.35);
  min-width: 0;
}

.expr-modal__tabs {
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

.expr-modal__panel-body {
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

/* ── 参数 Tab 布局 ───────────────────────────────────────────── */

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

/* ── 导出覆盖层 ───────────────────────────────────────────────── */

.expr-export-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
}

.expr-export-modal {
  background-color: rgba(29, 32, 38, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  width: min(440px, 92%);
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

.expr-export-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
}

.expr-export-modal__title {
  margin: 0;
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}

.expr-export-modal__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.expr-export-modal__footer {
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
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
