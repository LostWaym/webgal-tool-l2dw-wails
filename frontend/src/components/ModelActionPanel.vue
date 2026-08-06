<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import * as PIXI from 'pixi.js'
import { useModelStore, DEFAULT_TRANSFORM_STATE } from '../stores/models'
import type { TransformState } from '../stores/models'
import {
  DEFAULT_BG_TEMPLATE,
  DEFAULT_BG_TRANSFORM_TEMPLATE,
  DEFAULT_STAGE_TRANSFORM_TEMPLATE,
  DEFAULT_FIGURE_TEMPLATE,
  DEFAULT_TRANSFORM_TEMPLATE,
} from '../utils/consts'
import { L2dwContainer } from '../live2d/L2dwContainer'
import { isSpecialId, getSpecialName, SpecialId } from '../live2d/specialIds'
import { PickImageFile } from '../../wailsjs/go/main/App'
import { filterBySearch } from '../utils/searchUtils'
import emitter, { StageEvents } from '../stores/emitter'
import { reloadAllModelTextures } from '../live2d/textureUtils'
import { useMessage } from '../composables/useMessage'
import SearchInput from './common/SearchInput.vue'
import settingsIcon from '../assets/icons/settings.png'
import { previewRuntime } from '../utils/runtimeRegistry'

const store = useModelStore()

type TabKey = 'motionExpression' | 'transform' | 'bgInfo' | 'stageInfo' | 'figureInfo'
const activeTab = ref<TabKey>('motionExpression') // 页签

interface TabConfig {
  key: TabKey
  label: string
}

const TAB_CONFIGS: Record<TabKey, TabConfig> = {
  motionExpression: { key: 'motionExpression', label: '动作/表情' },
  transform:  { key: 'transform',  label: '变换' },
  bgInfo:     { key: 'bgInfo',     label: '场景信息' },
  stageInfo:  { key: 'stageInfo',  label: '主场景信息' },
  figureInfo: { key: 'figureInfo', label: '立绘信息' },
}
const motionSearch = ref('')
const expressionSearch = ref('')
const motionCollapsed = ref(false)
const expressionCollapsed = ref(false)
const panelWidth = ref(280)
const hoveredTab = ref<TabKey | null>(null) // 当前悬停的页签
const msg = useMessage()

// 根据选中物体动态生成可显示的页签
const visibleTabs = ref<TabConfig[]>([])

watch(() => store.selectedId, (newId) => {
  if (!newId) {
    visibleTabs.value = []
    return
  }
  if (newId === SpecialId.BgContainer) {
    visibleTabs.value = [TAB_CONFIGS.bgInfo, TAB_CONFIGS.transform]
  } else if (newId === SpecialId.StageMain) {
    visibleTabs.value = [TAB_CONFIGS.stageInfo, TAB_CONFIGS.transform]
  } else {
    // 普通模型（立绘）
    visibleTabs.value = [
      TAB_CONFIGS.motionExpression,
      TAB_CONFIGS.transform,
      TAB_CONFIGS.figureInfo,
    ]
  }
}, { immediate: true })

interface MotionInfo {
  group: string
  index: number
  name: string
}

interface ExpressionInfo {
  index: number
  name: string
}

const motions = ref<MotionInfo[]>([])
const expressions = ref<ExpressionInfo[]>([])

// 变换状态（统一通过 store.getTransformState 获取，内部已处理特殊容器 / 普通模型）
const transformState = computed<TransformState>(
  () => {
    const id = store.selectedId
    if (!id) return { ...DEFAULT_TRANSFORM_STATE }
    return store.getTransformState(id)
  },
)
let _updatingTransform = false

// 拖拽调参步幅
const DRAG_STEP_X = 1        // X 轴每 px 增减量
const DRAG_STEP_Y = -1       // Y 轴每 px 增减量（向上拖增大）
const DRAG_STEP_SCALE = 0.001 // 缩放每 px 增减量
const DRAG_STEP_ROTATION = 0.2 // 旋转每 px 增减角度
const DRAG_STEP_ALPHA = 0.005  // 透明度每 px 增减量

function clamp(value: number, min: number, max: number): number {
  return Math.max(Math.min(value, max), min)
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

// 从模型同步变换数据到 store
function syncTransformFromModel() {
  if (!store.selectedId) return
  const container = getL2dwContainer()
  if (!container) return

  const state: TransformState = {
    x: Math.round(container.x * 100) / 100,
    y: Math.round(container.y * 100) / 100,
    scale: Math.round(container.scale.x * 100) / 100,
    rotation: Math.round(container.rotation * 180 / Math.PI),
    alpha: Math.round(container.alpha * 100) / 100,
  }
  store.setTransformState(store.selectedId, state)
}

// 变换外部回调（由 Stage 调用）
function onTransformChange(modelId: string) {
  if (_updatingTransform) return
  if (modelId !== store.selectedId) return
  syncTransformFromModel()
}

// 注册/注销变换回调
onMounted(() => {
  emitter.on(StageEvents.TransformChange, onTransformChange)
})

onUnmounted(() => {
  emitter.off(StageEvents.TransformChange, onTransformChange)
})

// 获取变换目标容器：普通模型 -> L2dwContainer，占位项（StageMain / BGContainer）-> PIXI.Container
function getL2dwContainer(): PIXI.Container | undefined {
  const id = store.selectedId
  if (!id) return undefined
  if (isSpecialId(id)) {
    return previewRuntime.specialContainers.get(id) as PIXI.Container | undefined
  }
  return previewRuntime.modelWrappers.get(id)
}

// 获取 Live2DModel（用于读取 motion / expression / internalModel）
// wmdl 场景取第一个子模型
function getLive2DModel(): Live2DModel | undefined {
  if (!store.selectedId) return undefined

  const wmdlInfo = previewRuntime.wmdlSubModels.get(store.selectedId)
  const firstSubId = wmdlInfo?.subModelIds?.[0]
  return firstSubId ? previewRuntime.live2dModels.get(firstSubId) : undefined
}

// 提取动作列表并按名称字母排序
function extractMotions(model: Live2DModel): MotionInfo[] {
  if (!model.internalModel?.motionManager?.definitions) return []

  const defs = model.internalModel.motionManager.definitions as Record<string, any[]>
  const result: MotionInfo[] = []

  for (const [group, list] of Object.entries(defs)) {
    for (let i = 0; i < list.length; i++) {
      const def = list[i]
      result.push({
        group,
        index: i,
        name: def.name || `${group}`,
      })
    }
  }

  // 按动作名称进行字母排序
  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}

// 提取表情列表并按名称字母排序
function extractExpressions(model: Live2DModel): ExpressionInfo[] {
  const mm = model.internalModel?.motionManager as any
  const em = mm?.expressionManager
  if (!em?.definitions) return []

  const defs = em.definitions as any[]
  const result = defs.map((def, i) => ({
    index: i,
    name: def.name || def.Name || def.file || def.File || `expression_${i}`,
  }))
  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}

// 立绘模板（来自当前选中模型的 wmdlConfig）
const figureTemplateInput = ref('')
const figureTransformTemplateInput = ref('')

function syncFigureTemplatesFromEntry() {
  const entry = store.selectedModel
  figureTemplateInput.value = entry?.wmdlConfig?.figureTemplate ?? ''
  figureTransformTemplateInput.value = entry?.wmdlConfig?.transformTemplate ?? ''
}

// 监听模型选择变化
watch(() => store.selectedId, async (newId, oldId) => {
  console.log('selectedId changed:', newId, oldId)
  syncFigureTemplatesFromEntry()

  // 占位项：通用页签（transform）保留，否则切到默认页签
  if (isSpecialId(newId)) {
    const targetTab =
      newId === SpecialId.BgContainer ? 'bgInfo' :
      newId === SpecialId.StageMain ? 'stageInfo' :
      'transform'
    const stays = activeTab.value === 'transform' || activeTab.value === targetTab
    if (!stays) {
      activeTab.value = targetTab
    }
    motions.value = []
    expressions.value = []
    await nextTick()
    syncTransformFromModel()
    return
  }

  if (!newId) {
    motions.value = []
    expressions.value = []
    syncTransformFromModel()
    return
  }

  await nextTick()

  // 仅当上一次选中的是占位项（或停留在不可用的页签）时才重置为 motionExpression
  // 立绘之间切换时保留当前页签
  const cameFromSpecial = isSpecialId(oldId)
  if (activeTab.value !== 'transform' && (cameFromSpecial || activeTab.value === 'bgInfo' || activeTab.value === 'stageInfo')) {
    activeTab.value = 'motionExpression'
  }

  const model = getLive2DModel()
  if (!model) {
    console.error('Model not found')
    return;
  }

  motions.value = extractMotions(model)
  expressions.value = extractExpressions(model)
  syncTransformFromModel()
}, { immediate: true })

// 表单输入更新模型
function onTransformInput() {
  if (!store.selectedId) return
  const container = getL2dwContainer()
  if (!container) return
  _updatingTransform = true

  transformState.value.alpha = clamp01(transformState.value.alpha)

  container.x = transformState.value.x
  container.y = transformState.value.y
  container.scale.set(transformState.value.scale)
  container.rotation = transformState.value.rotation * Math.PI / 180
  container.alpha = transformState.value.alpha
  setTimeout(() => { _updatingTransform = false }, 50)
}

// 重置变换到默认值
function resetTransform() {
  if (!store.selectedId) return
  const container = getL2dwContainer()
  if (!container) return
  _updatingTransform = true
  container.x = 0
  container.y = 0
  container.scale.set(1)
  container.rotation = 0
  container.alpha = 1
  syncTransformFromModel()
  setTimeout(() => { _updatingTransform = false }, 50)
}

// ────────────────────────────────────────────────────────────────────────────
// 信息页签（背景 / 主场景 / 立绘）
// ────────────────────────────────────────────────────────────────────────────

// 背景模板输入（直接双向绑定 store）
const bgTemplateInput = computed({
  get: () => store.bgTemplate,
  set: (v: string) => store.setBgTemplate(v),
})
const bgTransformTemplateInput = computed({
  get: () => store.bgTransformTemplate,
  set: (v: string) => store.setBgTransformTemplate(v),
})
const stageTransformTemplateInput = computed({
  get: () => store.stageTransformTemplate,
  set: (v: string) => store.setStageTransformTemplate(v),
})

function commitFigureTemplates() {
  const entry = store.selectedModel
  if (!entry?.wmdlConfig) return
  store.setModelWmdlConfig(entry.id, {
    figureTemplate: figureTemplateInput.value,
    transformTemplate: figureTransformTemplateInput.value,
  })
}

function onReloadModel() {
  const id = store.selectedId
  if (!id) return
  emitter.emit(StageEvents.ReloadModel, id)
}

async function onReloadTextures() {
  const id = store.selectedId
  const entry = store.selectedModel
  if (!id || !entry?.wmdlModels) return

  const wmdlInfo = previewRuntime.wmdlSubModels.get(id)

  for (const subId of wmdlInfo?.subModelIds ?? []) {
    const model = previewRuntime.live2dModels.get(subId)
    const subEntry = entry.wmdlModels.find(m => m.id === subId)
    if (model && subEntry?.jsonAbsPath) {
      await reloadAllModelTextures(model, subEntry.jsonAbsPath)
    }
  }
}

function generateFigureTemplate() {
  figureTemplateInput.value = DEFAULT_FIGURE_TEMPLATE
  commitFigureTemplates()
}

function generateFigureTransformTemplate() {
  figureTransformTemplateInput.value = DEFAULT_TRANSFORM_TEMPLATE
  commitFigureTemplates()
}

function generateBgTemplate() {
  store.setBgTemplate(DEFAULT_BG_TEMPLATE)
}

function generateBgTransformTemplate() {
  store.setBgTransformTemplate(DEFAULT_BG_TRANSFORM_TEMPLATE)
}

function generateStageTransformTemplate() {
  store.setStageTransformTemplate(DEFAULT_STAGE_TRANSFORM_TEMPLATE)
}

// 背景历史：图片资源 URL 转 Wails 可访问的绝对路径
function bgImageSrc(path: string): string {
  // 已是 http(s) 或 data 开头则直接返回
  if (/^(https?:|data:)/i.test(path)) return path
  // 否则视为绝对文件路径，转换为 Wails AssetServer 可访问 URL
  const encoded = encodeURI(path)
  return `/abs_files/${encoded}`
}

async function onLoadBackground() {
  const imagePath = await PickImageFile()
  if (imagePath) {
    store.setBackground(imagePath)
  }
}

function onSelectHistory(path: string) {
  store.setBackground(path)
}

// 过滤后的动作列表
const filteredMotions = computed(() =>
  filterBySearch(motions.value, motionSearch.value, (m) => m.name),
)

// 过滤后的表情列表
const filteredExpressions = computed(() =>
  filterBySearch(expressions.value, expressionSearch.value, (e) => e.name),
)

// 当前播放状态
const currentState = computed(() => store.selectedModel?.playing ?? { motion: null, expression: null })

// 是否选中占位项（StageMain / BGContainer）
const isSpecial = computed(() => isSpecialId(store.selectedId))

// 统一对外的"当前选中项"：占位项返回 { name }，真实模型返回 ModelEntry
const selectedEntry = computed(() => {
  const id = store.selectedId
  if (!id) return null
  if (isSpecialId(id)) return { name: getSpecialName(id) }
  return store.selectedModel
})

// 判断是否正在播放
function isMotionPlaying(item: MotionInfo): boolean {
  const state = currentState.value
  return state?.motion?.group === item.group && state?.motion?.index === item.index
}

function isExpressionPlaying(item: ExpressionInfo): boolean {
  return currentState.value?.expression?.index === item.index
}

// 播放动作
async function playMotion(item: MotionInfo) {
  if (!store.selectedId) return
  await store.playMotion(store.selectedId, item.group, item.index, item.name)
}

// 播放表情
async function playExpression(item: ExpressionInfo) {
  if (!store.selectedId) return
  await store.playExpression(store.selectedId, item.index, item.name)
}

// 拖拽宽度
function onDragStart(e: MouseEvent) {
  e.preventDefault()
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}

// 是否显示当前页签的配置按钮
const availableTabs: TabKey[] = ['motionExpression']
const hasTabConfig = computed(() => availableTabs.includes(activeTab.value))

// 页签配置按钮点击回调
function onTabConfigClick() {
  msg.info('这里是配置界面(施工中)')
}

function onDragMove(e: MouseEvent) {
  const newWidth = window.innerWidth - e.clientX
  panelWidth.value = Math.max(200, Math.min(500, newWidth))
}

function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// 标签拖拽调参
let _dragAxis: 'x' | 'y' | 'scale' | 'rotation' | 'alpha' | null = null
let _dragStartX = 0
let _dragStartValue = 0

function onLabelDragStart(axis: 'x' | 'y' | 'scale' | 'rotation' | 'alpha', e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  _dragAxis = axis
  _dragStartX = e.clientX
  _dragStartValue = axis === 'x' ? transformState.value.x
                : axis === 'y' ? transformState.value.y
                : axis === 'rotation' ? transformState.value.rotation
                : axis === 'alpha' ? transformState.value.alpha
                : transformState.value.scale
  document.addEventListener('mousemove', onLabelDragMove)
  document.addEventListener('mouseup', onLabelDragEnd)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}

function onLabelDragMove(e: MouseEvent) {
  if (!_dragAxis) return
  const container = getL2dwContainer()
  if (!container) return

  const delta = e.clientX - _dragStartX
  const step = _dragAxis === 'x' ? DRAG_STEP_X
             : _dragAxis === 'y' ? DRAG_STEP_Y
             : _dragAxis === 'rotation' ? DRAG_STEP_ROTATION
             : _dragAxis === 'alpha' ? DRAG_STEP_ALPHA
             : DRAG_STEP_SCALE
  const newVal = Math.round((_dragStartValue + delta * step) * 1000) / 1000

  if (_dragAxis === 'x') container.x = newVal
  else if (_dragAxis === 'y') container.y = newVal
  else if (_dragAxis === 'scale') container.scale.set(newVal)
  else if (_dragAxis === 'rotation') container.rotation = newVal * Math.PI / 180
  else if (_dragAxis === 'alpha') container.alpha = newVal

  const newState = { ...transformState.value, [_dragAxis]: newVal }
  store.setTransformState(store.selectedId, newState)
}

function onLabelDragEnd() {
  _dragAxis = null
  document.removeEventListener('mousemove', onLabelDragMove)
  document.removeEventListener('mouseup', onLabelDragEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}
</script>

<template>
  <aside
    class="model-action-panel"
    :style="{ width: panelWidth + 'px' }"
  >
    <!-- 拖拽手柄 -->
    <div class="panel__drag-handle" @mousedown="onDragStart" />

    <!-- 页签 -->
    <div class="panel__tabs">
      <button
        v-for="tab in visibleTabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ 'is-active': activeTab === tab.key }"
        @click="activeTab = tab.key"
        @mouseenter="hoveredTab = tab.key"
        @mouseleave="hoveredTab = null"
      >
        <span class="tab-btn__label">{{ tab.label }}</span>
        <span
          v-if="activeTab === tab.key && hasTabConfig"
          class="tab-settings-overlay"
          :class="{ 'is-visible': hoveredTab === tab.key }"
        />
        <img
          v-if="activeTab === tab.key && hasTabConfig"
          :src="settingsIcon"
          class="tab-settings-btn"
          :class="{ 'is-visible': hoveredTab === tab.key }"
          @click.stop="onTabConfigClick"
        />
      </button>
    </div>

    <!-- 动作 / 表情 合并页签 -->
    <div v-if="activeTab === 'motionExpression'" class="panel__motion-expression">
      <!-- 上：动作区 -->
      <div class="panel__list-region" :class="{ 'is-collapsed': motionCollapsed }">
        <div class="list-region-header">
          <span class="list-region-title">动作</span>
          <button
            type="button"
            class="list-region-toggle"
            :aria-expanded="!motionCollapsed"
            :aria-label="motionCollapsed ? '展开动作' : '折叠动作'"
            @click="motionCollapsed = !motionCollapsed"
          >
            <span aria-hidden="true">{{ motionCollapsed ? '▸' : '▾' }}</span>
          </button>
        </div>
        <div v-show="!motionCollapsed" class="list-region-body">
          <div class="panel__search">
            <SearchInput v-model="motionSearch" variant="action" placeholder="搜索动作..." />
          </div>
          <ul class="panel__list">
            <li
              v-for="item in filteredMotions"
              :key="`${item.group}_${item.index}`"
              class="list-item"
              :class="{ 'is-playing': isMotionPlaying(item) }"
              @click="playMotion(item)"
            >
              {{ item.name }}
            </li>
            <li v-if="filteredMotions.length === 0" class="list-item list-item--empty">
              暂无动作
            </li>
          </ul>
        </div>
      </div>

      <!-- 下：表情区 -->
      <div class="panel__list-region" :class="{ 'is-collapsed': expressionCollapsed }">
        <div class="list-region-header">
          <span class="list-region-title">表情</span>
          <button
            type="button"
            class="list-region-toggle"
            :aria-expanded="!expressionCollapsed"
            :aria-label="expressionCollapsed ? '展开表情' : '折叠表情'"
            @click="expressionCollapsed = !expressionCollapsed"
          >
            <span aria-hidden="true">{{ expressionCollapsed ? '▸' : '▾' }}</span>
          </button>
        </div>
        <div v-show="!expressionCollapsed" class="list-region-body">
          <div class="panel__search">
            <SearchInput v-model="expressionSearch" variant="action" placeholder="搜索表情..." />
          </div>
          <ul class="panel__list">
            <li
              v-for="item in filteredExpressions"
              :key="item.index"
              class="list-item"
              :class="{ 'is-playing': isExpressionPlaying(item) }"
              @click="playExpression(item)"
            >
              {{ item.name }}
            </li>
            <li v-if="filteredExpressions.length === 0" class="list-item list-item--empty">
              暂无表情
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 变换表单 -->
    <div v-else-if="activeTab === 'transform'" class="panel__transform">
      <div class="form-row">
        <label>名字</label>
        <input
          v-model="selectedEntry!.name"
          type="text"
          class="form-input"
          :readonly="isSpecial"
        />
      </div>
      <div class="form-row">
        <label @mousedown="(e) => onLabelDragStart('x', e)">X</label>
        <input
          v-model.number="transformState.x"
          type="number"
          class="form-input"
          step="1"
          @input="onTransformInput"
        />
      </div>
      <div class="form-row">
        <label @mousedown="(e) => onLabelDragStart('y', e)">Y</label>
        <input
          v-model.number="transformState.y"
          type="number"
          class="form-input"
          step="1"
          @input="onTransformInput"
        />
      </div>
      <div class="form-row">
        <label @mousedown="(e) => onLabelDragStart('scale', e)">缩放</label>
        <input
          v-model.number="transformState.scale"
          type="number"
          class="form-input"
          step="0.01"
          min="0.01"
          max="10"
          @input="onTransformInput"
        />
      </div>
      <div class="form-row">
        <label @mousedown="(e) => onLabelDragStart('rotation', e)">旋转</label>
        <input
          v-model.number="transformState.rotation"
          type="number"
          class="form-input"
          step="1"
          @input="onTransformInput"
        />
      </div>
      <div class="form-row">
        <label @mousedown="(e) => onLabelDragStart('alpha', e)">透明度</label>
        <input
          v-model.number="transformState.alpha"
          type="number"
          class="form-input"
          step="0.01"
          min="0"
          max="1"
          @input="onTransformInput"
        />
      </div>
      <div class="form-row form-row--btn">
        <button class="reset-btn" @click="resetTransform">重置</button>
      </div>
    </div>

    <!-- 场景信息（背景物体） -->
    <div v-else-if="activeTab === 'bgInfo'" class="panel__info">
      <div class="info-section">
        <div class="info-row">
          <label class="info-label">背景模板</label>
          <button class="reset-btn reset-btn--small" @click="generateBgTemplate">生成背景模板</button>
        </div>
        <textarea
          v-model="bgTemplateInput"
          class="form-input form-input--textarea"
          rows="3"
        />
        <div class="info-row">
          <label class="info-label">变换模板</label>
          <button class="reset-btn reset-btn--small" @click="generateBgTransformTemplate">生成变换模板</button>
        </div>
        <textarea
          v-model="bgTransformTemplateInput"
          class="form-input form-input--textarea"
          rows="3"
        />
        <div class="form-row form-row--btn">
          <button class="reset-btn" @click="onLoadBackground">加载背景</button>
        </div>
      </div>
      <div class="history-grid">
        <div
          v-for="path in store.bgHistory"
          :key="path"
          class="history-item"
          :class="{ 'is-current': path === store.backgroundUrl }"
          @click="onSelectHistory(path)"
        >
          <img :src="bgImageSrc(path)" :alt="path" class="history-thumb" />
          <span class="history-name">{{ path.split(/[/\\]/).pop() }}</span>
        </div>
        <div v-if="store.bgHistory.length === 0" class="history-empty">
          暂无历史记录
        </div>
      </div>
    </div>

    <!-- 主场景信息 -->
    <div v-else-if="activeTab === 'stageInfo'" class="panel__info">
      <div class="info-section">
        <div class="info-row">
          <label class="info-label">变换模板</label>
          <button class="reset-btn reset-btn--small" @click="generateStageTransformTemplate">生成变换模板</button>
        </div>
        <textarea
          v-model="stageTransformTemplateInput"
          class="form-input form-input--textarea"
          rows="3"
        />
      </div>
    </div>

    <!-- 立绘信息 -->
    <div v-else-if="activeTab === 'figureInfo'" class="panel__info">
      <div class="info-section">
        <div class="info-row">
          <label class="info-label">立绘模板</label>
          <button class="reset-btn reset-btn--small" @click="generateFigureTemplate">生成立绘模板</button>
        </div>
        <textarea
          v-model="figureTemplateInput"
          class="form-input form-input--textarea"
          rows="3"
          @change="commitFigureTemplates"
        />
        <div class="info-row">
          <label class="info-label">变换模板</label>
          <button class="reset-btn reset-btn--small" @click="generateFigureTransformTemplate">生成变换模板</button>
        </div>
        <textarea
          v-model="figureTransformTemplateInput"
          class="form-input form-input--textarea"
          rows="3"
          @change="commitFigureTemplates"
        />
        <div class="info-row">
          <button class="reset-btn reset-btn--small" @click="onReloadModel">重载模型配置</button>
          <button class="reset-btn reset-btn--small" @click="onReloadTextures">重载纹理</button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.model-action-panel {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 100;
  background: rgba(29, 32, 38, 0.92);
  backdrop-filter: blur(8px);
  border-left: 1px solid #2c313a;
  display: flex;
  flex-direction: column;
  user-select: none;
}

.panel__drag-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: ew-resize;
  background: transparent;
  transition: background 0.15s;
  z-index: 1;
}

.panel__drag-handle:hover {
  background: #2f80ed;
}

.panel__model-name {
  padding: 10px 12px;
  font-size: 13px;
  color: #e6e6e6;
  border-bottom: 1px solid #2c313a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel__tabs {
  display: flex;
  border-bottom: 1px solid #2c313a;
  padding: 0 12px;
}

.tab-btn {
  flex: 1;
  padding: 12px 8px;
  background: transparent;
  border: none;
  color: #8a93a3;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s, border-bottom 0.15s;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  position: relative;
}

.tab-btn:hover {
  color: #e6e6e6;
}

.tab-btn.is-active {
  color: #e6e6e6;
  border-bottom-color: #2f80ed;
}

.tab-btn__label {
  position: relative;
  z-index: 1;
}

.tab-settings-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
  z-index: 1;
}

.tab-settings-btn {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 18px;
  height: 18px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 2;
  filter: brightness(0) invert(1);
  pointer-events: none;
}

.tab-settings-overlay.is-visible,
.tab-settings-btn.is-visible {
  opacity: 1;
  pointer-events: auto;
}

/* ───────── 动作 / 表情 合并页签 ───────── */

.panel__motion-expression {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panel__list-region {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.panel__list-region.is-collapsed {
  flex: 0 0 auto;
  height: 56px;
}

.list-region-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #2c313a;
  background: #232830;
}

.list-region-title {
  flex: 1;
  color: #e6e6e6;
  font-size: 13px;
  font-weight: 500;
}

.list-region-settings {
  position: static;
  transform: none;
  width: 16px;
  height: 16px;
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 0.15s ease;
  filter: brightness(0) invert(1);
  pointer-events: auto;
}

.list-region-settings:hover {
  opacity: 1;
}

.list-region-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #8a93a3;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}

.list-region-toggle:hover {
  background: #2a3140;
  color: #e6e6e6;
}

.list-region-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.list-region-body .panel__list {
  min-height: 0;
}

.panel__search {
  padding: 8px 12px;
  border-bottom: 1px solid #2c313a;
}

.panel__list {
  list-style: none;
  margin: 0;
  padding: 8px 0;
  overflow-y: auto;
  min-height: 0;
}

.list-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.12s ease, border-color 0.12s ease;
  font-size: 13px;
  color: #e6e6e6;
}

.list-item:hover {
  background: #262b34;
}

.list-item.is-playing {
  background: #2a3140;
  border-left-color: #2f80ed;
  font-weight: 500;
}

.list-item--empty {
  color: #6b7280;
  cursor: default;
  justify-content: center;
}

.list-item--empty:hover {
  background: transparent;
}

.panel__transform {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-row label {
  width: 40px;
  color: #8a93a3;
  font-size: 13px;
  flex-shrink: 0;
  cursor: ew-resize;
  padding: 4px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}

.form-row label:hover {
  background: #2a3140;
}

.form-input {
  flex: 1;
  padding: 8px 12px;
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 6px;
  color: #e6e6e6;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.form-input:focus {
  border-color: #2f80ed;
}

.form-row--btn {
  margin-top: 8px;
  justify-content: center;
}

.reset-btn {
  padding: 8px 24px;
  background: #2f80ed;
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.reset-btn:hover {
  background: #3d8ef0;
}

/* ───────── 信息页签 ───────── */

.panel__info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.info-section {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
}

.form-row--stack {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.form-row--stack label {
  width: auto;
  cursor: default;
}

.form-row--stack label:hover {
  background: transparent;
}

.form-input--textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  min-height: 60px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.info-label {
  color: #8a93a3;
  font-size: 13px;
}

.reset-btn--small {
  padding: 4px 10px;
  font-size: 12px;
}

.list-item.is-current {
  border-left-color: #2f80ed;
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  padding: 8px 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  border-top: 1px solid #2c313a;
}

.history-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  border-radius: 6px;
  padding: 6px;
  transition: background 0.12s;
}

.history-item:hover {
  background: #262b34;
}

.history-item.is-current {
  outline: 2px solid #2f80ed;
}

.history-thumb {
  width: 100%;
  max-height: 80px;
  object-fit: contain;
  border-radius: 4px;
  background: #1a1d23;
  display: block;
}

.history-name {
  color: #fff;
  font-size: 11px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  text-shadow: 0 1px 2px #000, 0 -1px 2px #000, 1px 0 2px #000, -1px 0 2px #000;
}

.history-empty {
  grid-column: 1 / -1;
  color: #6b7280;
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
}
</style>
