<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { useWmdlModelEditorStore } from '../../../stores/wmdlModelEditor'
import { toFileUrl, pathCombine, pathDirname } from '../../../path_utils'
import { L2dwContainer } from '../../../live2d/L2dwContainer'
import { writeParameter } from '../../../live2d/coreAdapter'
import { useExpressionEditorModal, type ExportFormat } from '../../../composables/useExpressionEditorModal'
import { useMessage } from '../../../composables/useMessage'
import {
  readExpressionFile,
  exportAsExpJson,
  exportAsExp3Json,
  defaultExportDirForModel,
  type ParamSnapshot,
} from '../../../live2d/expressionUtils'

/**
 * 表情编辑模态。
 *
 * 布局：左侧 Live2D 预览，右侧 [参数 / 表情] 两个页签。
 * 表情 Tab 点击条目 → 把表情文件的参数写入当前模型 + 缓存到内存快照。
 * 顶栏"导出"按钮 → 进入导出覆盖层（不开新窗口），让用户选 .exp.json / .exp3.json。
 *
 * 预览 canvas 与 EditStage 是完全独立的 Pixi 实例，避免与主舞台互相干扰。
 * 模态关闭 / 切换选中模型时，会先 destroy 旧实例再重建。
 */

const store = useWmdlModelEditorStore()
const msg = useMessage()
const modal = useExpressionEditorModal()

type RightTab = 'params' | 'expressions'
const activeTab = ref<RightTab>('expressions')

const leftCanvasRef = ref<HTMLDivElement | null>(null)

let previewApp: PIXI.Application | null = null
let previewRoot: PIXI.Container | null = null
let previewStage: PIXI.Container | null = null
let previewFigure: PIXI.Container | null = null
let previewWrapper: L2dwContainer | null = null
let previewModel: Live2DModel | null = null
let previewModelId: string | null = null

/** 当前快照（用户在表情 Tab 每次点击覆盖后会被替换为最新一组） */
const currentSnapshot = ref<ParamSnapshot[]>([])
/** 上次点击的表情条目 key（高亮） */
const activeExpressionKey = ref<string | null>(null)

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

// ── 生命周期 / 预览 canvas 初始化 ──────────────────────────────────────────

onMounted(() => {
  // 第一次进入直接重建预览
  rebuildPreview()
})

onBeforeUnmount(() => {
  destroyPreview()
})

watch(
  () => stateForWatch(),
  () => rebuildPreview(),
)

function stateForWatch() {
  const m = selectedModel.value
  if (!m) return { id: '', json: '' }
  return { id: m.id, json: m.jsonAbsPath }
}

watch(
  () => modal.state.visible,
  (visible) => {
    if (!visible) {
      // 关闭时清理预览与快照
      currentSnapshot.value = []
      activeExpressionKey.value = null
      destroyPreview()
    } else {
      // 打开时预选导出格式
      modal.setExportFormat(defaultFormat.value)
      // 用 nextTick 让 canvas 容器先挂载
      setTimeout(() => rebuildPreview(), 0)
    }
  },
)

function destroyPreview() {
  if (previewWrapper) {
    previewWrapper.destroy({ children: true })
    previewWrapper = null
  }
  previewModel = null
  previewModelId = null
  if (previewFigure && previewStage) {
    previewStage.removeChild(previewFigure)
  }
  previewFigure = null
  previewStage = null
  previewRoot = null
  if (previewApp) {
    try {
      previewApp.destroy(true, { children: true, texture: true, baseTexture: true })
    } catch (e) {
      console.warn('preview pixi destroy error', e)
    }
    previewApp = null
  }
}

async function rebuildPreview() {
  destroyPreview()

  if (!modal.state.visible) return
  const m = selectedModel.value
  if (!m) return

  const container = leftCanvasRef.value
  if (!container) return

  previewApp = new PIXI.Application({
    width: container.clientWidth || 480,
    height: container.clientHeight || 360,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  })
  previewApp.ticker.maxFPS = 60
  ;(window as any).PIXI = PIXI

  container.appendChild(previewApp.view as HTMLCanvasElement)

  previewRoot = new PIXI.Container()
  previewRoot.x = previewApp.renderer.width / 2
  previewRoot.y = previewApp.renderer.height / 2
  previewRoot.scale.set(0.5)

  previewStage = new PIXI.Container()
  previewStage.width = 1024
  previewStage.height = 1024
  previewStage.pivot.set(512, 512)
  previewFigure = new PIXI.Container()
  previewFigure.width = 1024
  previewFigure.height = 1024
  previewStage.addChild(previewFigure)
  previewRoot.addChild(previewStage)
  previewApp.stage.addChild(previewRoot)

  try {
    const url = toFileUrl(m.jsonAbsPath)
    const model = await Live2DModel.from(url, { idleMotionGroup: '', autoInteract: false })
    const scale = Math.min(1024 / model.width, 1024 / model.height)
    model.scale.x = scale
    model.scale.y = scale
    model.anchor.set(0.5)
    model.position.x = 0
    model.position.y = 512

    const wrapper = new L2dwContainer()
    wrapper.setBasePosition(512, 512)
    wrapper.addChild(model)
    wrapper.pivot.set(0, 512)
    wrapper.x = m.offsetX
    wrapper.y = m.offsetY

    previewFigure.addChild(wrapper)
    previewWrapper = wrapper
    previewModel = model
    previewModelId = m.id
  } catch (e) {
    console.error('ExpressionEditorModal: failed to load model', e)
    msg.error('预览模型加载失败')
  }
}

// ── 表情点击 → 写回参数 + 缓存快照 ────────────────────────────────────────

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

  if (!result.snapshot.length) {
    msg.warning('该表情文件没有参数')
    return
  }

  // 写回模型当前参数
  for (const p of result.snapshot) {
    writeParameter(m.id, p.id, p.val)
  }

  currentSnapshot.value = result.snapshot
  activeExpressionKey.value = `${item.name}\u0000${item.path}`
  msg.success(`已应用表情「${item.name}」（${result.snapshot.length} 个参数）`)
}

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
            <!-- 左侧预览 -->
            <div class="expr-modal__preview">
              <div ref="leftCanvasRef" class="expr-modal__canvas" />
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
                <!-- 参数 Tab：显示当前快照（最近一次应用的表情参数），未应用时显示模型所有参数当前值 -->
                <template v-else>
                  <div v-if="!hasSelection" class="empty-hint">请先选择模型</div>
                  <div v-else class="params-summary">
                    <p class="params-summary__hint">
                      <template v-if="currentSnapshot.length">
                        当前快照：{{ currentSnapshot.length }} 个参数（最近一次应用的表情）
                      </template>
                      <template v-else>
                        当前模型共有 {{ (store.selectedModel?.initParams ?? []).length }} 个参数。点击左侧预览或上方表情 Tab 应用表情后，参数值会同步更新。
                      </template>
                    </p>
                    <ul class="params-summary__list">
                      <li
                        v-for="p in (currentSnapshot.length ? currentSnapshot : (store.selectedModel?.initParams ?? []))"
                        :key="p.id"
                        class="params-summary__item"
                      >
                        <span class="params-summary__id">{{ p.id }}</span>
                        <span class="params-summary__val">{{ Number((p as any).val ?? (p as any).value ?? 0).toFixed(3) }}</span>
                      </li>
                    </ul>
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

.expr-modal__canvas {
  position: absolute;
  inset: 0;
}

.expr-modal__hint {
  margin: auto;
  color: #6b7280;
  font-size: 13px;
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

.params-summary {
  padding: 12px 16px;
}

.params-summary__hint {
  font-size: 12px;
  color: #b0b8c4;
  margin: 0 0 12px 0;
}

.params-summary__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.params-summary__item {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: rgba(35, 40, 48, 0.5);
  padding: 4px 8px;
  border-radius: 4px;
}

.params-summary__id {
  color: #c8ceda;
}

.params-summary__val {
  color: #ffffff;
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
