<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { toFileUrl } from '../../path_utils'
import { L2dwContainer } from '../../live2d/L2dwContainer'
import { clearModelTextureRecords, createTextureWatcher, type TextureWatcher } from '../../live2d/textureUtils'
import EditStageToolbar from './EditStageToolbar.vue'
import { editRuntime } from '../../utils/runtimeRegistry'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../../utils/consts'
import { getDevicePixelRatio, observePixiViewport } from '../../live2d/viewport'
import { currentTheme, themeColor } from '../../themes/appearance'
import { useMessage } from '../../composables/useMessage'
import { emitter, StageEvents } from '../../stores/emitter'
import { previewModelEntries, type ModelEditorPreviewRequest } from '../../utils/modelEditorPreview'
import { useBatchAddModal } from '../../composables/useBatchAddModal'
import { useBatchModifyModal } from '../../composables/useBatchModifyModal'
import { useEditorConfirm } from '../../composables/useEditorConfirm'

/**
 * 编辑器窗口的 Pixi 预览画布。
 *
 * 层级结构（与主 Stage 保持一致）：
 *   app.stage
 *     └─ rootContainer          ← 中键拖拽、滚轮缩放目标
 *          └─ stageMain         ← 锚定 STAGE 尺寸的内部坐标系
 *               └─ figureContainer  ← 立绘列表所在的 PIXI 容器
 *
 * 与主 Stage 区别：
 *   - 无背景层（编辑器只关心立绘）
 *   - 使用 G 模式调整选中副模型的偏移
 *   - 步幅参数常量化（DRAG_SENSITIVITY / ZOOM_FACTOR / MIN_SCALE / MAX_SCALE）
 *   - 使用 wmdlModels store 作为唯一数据源
 */

const store = useWmdlModelEditorStore()
const message = useMessage()
const loadingIds = computed(() => store.loadingModelIds)
const background = ref('theme')
const moveMode = ref<{ id: string; name: string; startX: number; startY: number; axis: 'none' | 'x' | 'y'; baseX: number | null; baseY: number | null; cursor: string } | null>(null)
const batchAdd = useBatchAddModal()
const batchModify = useBatchModifyModal()
const editorConfirm = useEditorConfirm()
function finishMove(cancel: boolean) {
  const move = moveMode.value
  if (!move) return
  moveMode.value = null
  if (cancel) store.updateModelOffset(move.id, move.startX, move.startY)
  document.body.style.cursor = move.cursor
}
watch(() => [store.selectedModelId, ...store.currentWmdl.models.map(model => model.id)], () => {
  const move = moveMode.value
  if (move && (store.selectedModelId !== move.id || !store.currentWmdl.models.some(m => m.id === move.id) || store.currentWmdl.models[0]?.id === move.id)) finishMove(true)
}, { flush: 'sync' })
const loadTokens = new Map<string, symbol>()
let disposed = false

async function onPreview(request: ModelEditorPreviewRequest) {
  const targets = store.currentWmdl.models.flatMap(item => {
    const model = live2dById.get(item.id)
    return model && !model.destroyed ? [{ model, item }] : []
  })
  if (!targets.length) { message.warning('请等待模型加载完成'); return }
  await previewModelEntries(targets, request, (item, error) => {
    message.error(`${item.name} 预览失败：${error}`)
  })
}
function resetView() {
  if (!app || !rootContainer) return
  rootContainer.position.set(app.screen.width / 2, app.screen.height / 2)
  rootContainer.scale.set(0.5)
}

const containerRef = ref<HTMLDivElement | null>(null)

let app: PIXI.Application | null = null
const live2dById = new Map<string, Live2DModel>()
const jsonPathByModelId = new Map<string, string>()
const containersById = new Map<string, L2dwContainer>()
let stopObservingViewport: (() => void) | null = null
let textureWatcher: TextureWatcher | null = null

// Root 容器交互常量（与主 Stage 完全一致）
const DRAG_SENSITIVITY = 1      // 中键拖拽灵敏度
const ZOOM_FACTOR = 1.1         // 滚轮缩放倍率（与 Live2dPreview 一致）
const MIN_SCALE = 0.05          // 最小缩放
const MAX_SCALE = 20            // 最大缩放

let rootContainer: PIXI.Container | null = null
let stageMain: PIXI.Container | null = null
let figureContainer: PIXI.Container | null = null
let frameContainer: PIXI.Container | null = null
let frameLines: PIXI.Graphics | null = null
watch(currentTheme, () => { if (frameLines) frameLines.tint = themeColor('success') })

let isMiddleDown = false
let lastMouseX = 0
let lastMouseY = 0

onMounted(() => {
  emitter.on(StageEvents.ModelEditorPreview, onPreview)
  void init()
})

onBeforeUnmount(() => {
  disposed = true
  emitter.off(StageEvents.ModelEditorPreview, onPreview)
  dispose()
})

async function init() {
  const container = containerRef.value
  if (!container) return

  app = new PIXI.Application({
    width: container.clientWidth || 1024,
    height: container.clientHeight || 768,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: getDevicePixelRatio(),
  })
  app.ticker.maxFPS = 60
  editRuntime.app = app

  // The plugin's auto-update reads window.PIXI.Ticker.
  ;(window as any).PIXI = PIXI

  container.appendChild(app.view as HTMLCanvasElement)

  // 创建 Root 容器（中键拖拽和滚轮缩放操作它）
  rootContainer = new PIXI.Container()
  rootContainer.x = app.screen.width / 2
  rootContainer.y = app.screen.height / 2
  rootContainer.scale.set(0.5)

  // 创建主容器
  stageMain = new PIXI.Container()
  stageMain.width = STAGE_WIDTH
  stageMain.height = STAGE_HEIGHT
  stageMain.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  stageMain.x = 0
  stageMain.y = 0

  // 立绘容器
  figureContainer = new PIXI.Container()
  figureContainer.width = STAGE_WIDTH
  figureContainer.height = STAGE_HEIGHT

  stageMain.addChild(figureContainer)
  rootContainer.addChild(stageMain)
  app.stage.addChild(rootContainer)
  
  // 创建边框容器（rootContainer 的子节点，渲染层级最高）
  frameContainer = new PIXI.Container()
  const frame = frameLines = new PIXI.Graphics()
  frame.tint = themeColor('success')
  frame.lineStyle(2, 0xffffff)
  frame.drawRect(-STAGE_WIDTH / 2, -STAGE_HEIGHT / 2, STAGE_WIDTH, STAGE_HEIGHT)
  frameContainer.addChild(frame)
  rootContainer.addChild(frameContainer)

  stopObservingViewport = observePixiViewport(app, container, rootContainer)

  attachDomHandlers()
  textureWatcher = createTextureWatcher(
    () => live2dById,
    () => jsonPathByModelId,
  )
  if (store.dynamicTextureWatch) textureWatcher.enable()
  for (const entry of store.currentWmdl.models) void loadOne(entry.id)
}

watch(
  () => store.currentWmdl.models.map((m) => ({ id: m.id, jsonAbsPath: m.jsonAbsPath, raw: m.rawJsonObject })),
  (newItems, oldItems) => {
    if (!app) return
    const newMap = new Map(newItems.map((item) => [item.id, item]))
    const oldMap = new Map((oldItems ?? []).map((item) => [item.id, item]))
    const newSet = new Set(newMap.keys())
    const oldSet = new Set(oldMap.keys())

    for (const id of newSet) {
      if (!oldSet.has(id)) {
        void loadOne(id)
        continue
      }

      if (newMap.get(id)?.jsonAbsPath !== oldMap.get(id)?.jsonAbsPath || newMap.get(id)?.raw !== oldMap.get(id)?.raw) {
        removeOne(id)
        void loadOne(id)
      }
    }

    for (const id of oldSet) {
      if (!newSet.has(id)) {
        removeOne(id)
      }
    }
  },
  { immediate: true },
)

// 同步编辑器侧模型顺序到 zIndex
watch(
  () => store.currentWmdl.models.map((m) => m.id),
  (newIds) => {
    if (!figureContainer) return
    newIds.forEach((id, index) => {
      const wrapper = containersById.get(id)
      if (wrapper) {
        wrapper.zIndex = index
      }
    })
    figureContainer.sortChildren()
  },
)

// 监听编辑器模型可见性变化
watch(
  () => store.currentWmdl.models.map((m) => ({ id: m.id, visible: m.state.visible })),
  (newList) => {
    if (!app) return
    for (const { id, visible } of newList) {
      const wrapper = containersById.get(id)
      if (wrapper) {
        wrapper.visible = visible
      }
    }
  },
  { deep: true },
)

// 同步 store 里的 offsetX/offsetY 到对应容器的局部坐标
watch(
  () => store.currentWmdl.models.map((m) => ({ id: m.id, offsetX: m.offsetX, offsetY: m.offsetY })),
  (list) => {
    if (!figureContainer) return
    for (const { id, offsetX, offsetY } of list) {
      const wrapper = containersById.get(id)
      if (wrapper) {
        wrapper.x = offsetX
        wrapper.y = offsetY
      }
    }
  },
  { deep: true },
)

// 监听"动态更新纹理"开关，联动启停 watcher
watch(
  () => store.dynamicTextureWatch,
  (enabled) => {
    if (!textureWatcher) return
    if (enabled) {
      void textureWatcher.enable()
    } else {
      textureWatcher.disable()
    }
  },
)

async function loadOne(id: string) {
  if (!app) return
  const entry = store.currentWmdl.models.find((m) => m.id === id)
  if (!entry) return

  const url = toFileUrl(entry.jsonAbsPath)
  const path = entry.jsonAbsPath
  const token = Symbol(id)
  loadTokens.set(id, token)
  store.loadingModelIds = [...loadTokens.keys()]
  delete store.loadErrors[id]

  try {
    const model = await Live2DModel.from(url, { idleMotionGroup: '', autoInteract: false })
    if (disposed || loadTokens.get(id) !== token || !store.currentWmdl.models.includes(entry) || entry.jsonAbsPath !== path) {
      model.destroy({ children: true, texture: true, baseTexture: true })
      return
    }
    model.internalModel.motionManager.groups.idle = '__l2dw_editor_no_idle__'

    const scaleX = STAGE_WIDTH / model.width
    const scaleY = STAGE_HEIGHT / model.height
    const targetScale = Math.min(scaleX, scaleY)
    const targetWidth = model.width * targetScale
    const targetHeight = model.height * targetScale
    model.scale.x = targetScale
    model.scale.y = targetScale
    model.anchor.set(0.5)
    model.position.x = 0
    model.position.y = STAGE_HEIGHT / 2

    let baseY = STAGE_HEIGHT / 2
    if (targetHeight < STAGE_HEIGHT) {
      baseY = STAGE_HEIGHT / 2 + (STAGE_HEIGHT - targetHeight) / 2
    }

    const wrapper = new L2dwContainer()
    wrapper.setBasePosition(STAGE_WIDTH / 2, baseY)
    wrapper.addChild(model)
    wrapper.pivot.set(0, STAGE_HEIGHT / 2)
    wrapper.x = entry.offsetX
    wrapper.y = entry.offsetY

    figureContainer?.addChild(wrapper)

    live2dById.set(id, model)
    jsonPathByModelId.set(id, entry.jsonAbsPath)
    containersById.set(id, wrapper)
    wrapper.visible = entry.state.visible
    wrapper.zIndex = store.currentWmdl.models.findIndex(m => m.id === id)
    figureContainer?.sortChildren()

    // 暴露给 EditActionPanel 等组件访问当前选中模型对应的 Live2D 实例
    editRuntime.live2dModels = live2dById

    // 从模型描述 json 读取动作 / 表情并缓存到 store，供动作/表情页签读取
    await store.populateMotionsExps(id)
    if (loadTokens.get(id) !== token) return
    // 从 coreModel 抓取参数 / 部件快照，写入 initParams / initOpacities
    await store.populateInitValues(id)
    store.markModelLoaded(id)
  } catch (err) {
    console.error('Failed to load Live2D model:', err)
    if (disposed || loadTokens.get(id) !== token) return
    removeOne(id)
    store.loadErrors[id] = String(err)
    message.error(`模型加载失败：${path}\n${err}。配置已保留，可在 wmdl 页签更改路径。`, { duration: 8000 })
  } finally {
    if (loadTokens.get(id) === token) loadTokens.delete(id)
    store.loadingModelIds = [...loadTokens.keys()]
  }
}

function removeOne(id: string) {
  loadTokens.delete(id)
  store.loadingModelIds = [...loadTokens.keys()]
  clearModelTextureRecords(id)
  const wrapper = containersById.get(id)
  if (wrapper) {
    figureContainer?.removeChild(wrapper)
    wrapper.destroy({ children: true, texture: true, baseTexture: true })
  }
  live2dById.delete(id)
  jsonPathByModelId.delete(id)
  containersById.delete(id)
  editRuntime.live2dModels = live2dById
}

function attachDomHandlers() {
  if (!app) return
  const canvas = app.view as HTMLCanvasElement
  let previousCursor = ''
  let previousUserSelect = ''
  function beginDrag() {
    previousCursor = document.body.style.cursor
    previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }
  function canvasPoint(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    return new PIXI.Point((event.clientX - rect.left) * (app!.screen.width / rect.width),
      (event.clientY - rect.top) * (app!.screen.height / rect.height))
  }

  const onPointerDown = (e: PointerEvent) => {
    if (isMiddleDown || moveMode.value) return
    if (e.button === 1 && rootContainer) {
      isMiddleDown = true
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      e.preventDefault()
      beginDrag()
    }
  }

  const onWindowPointerDown = (e: PointerEvent) => {
    if (!moveMode.value || (e.button !== 0 && e.button !== 2)) return
    e.preventDefault()
    e.stopPropagation()
    finishMove(e.button === 2)
  }
  const onContextMenu = (e: MouseEvent) => {
    if (suppressContextMenu || moveMode.value) {
      e.preventDefault()
      suppressContextMenu = false
    }
  }
  let suppressContextMenu = false
  const onModePointerDown = (e: PointerEvent) => {
    if (!moveMode.value) suppressContextMenu = false
    if (moveMode.value && e.button === 2) suppressContextMenu = true
    onWindowPointerDown(e)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
    if (batchAdd.state.visible || batchModify.state.visible || editorConfirm.state.visible) return
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    const key = e.key.toLowerCase()
    const move = moveMode.value
    if (key === 'g') {
      e.preventDefault()
      if (move) { finishMove(true); return }
      if (isMiddleDown) return
      const model = store.selectedModel
      if (!model) { message.warning('请先在左侧选择一个副模型'); return }
      if (model === store.currentWmdl.models[0]) { message.warning('主模型偏移固定为 0，仅支持移动副模型'); return }
      moveMode.value = { id: model.id, name: model.name, startX: model.offsetX, startY: model.offsetY, axis: 'none', baseX: null, baseY: null, cursor: document.body.style.cursor }
      document.body.style.cursor = 'move'
    } else if (move && (key === 'x' || key === 'y')) {
      e.preventDefault()
      move.axis = move.axis === key ? 'none' : key
      const model = store.currentWmdl.models.find(m => m.id === move.id)
      if (model && move.axis !== 'none') store.updateModelOffset(move.id, move.axis === 'y' ? move.startX : model.offsetX, move.axis === 'x' ? move.startY : model.offsetY)
    } else if (move && (key === 'enter' || key === ' ' || key === 'escape')) {
      e.preventDefault()
      finishMove(key === 'escape')
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    const move = moveMode.value
    if (move && rootContainer) {
      if (move.baseX === null || move.baseY === null) {
        move.baseX = e.clientX
        move.baseY = e.clientY
      }
      const round = (v: number) => Math.round(v * 10) / 10
      store.updateModelOffset(move.id, move.axis === 'y' ? move.startX : round(move.startX + (e.clientX - move.baseX) / rootContainer.scale.x),
        move.axis === 'x' ? move.startY : round(move.startY + (e.clientY - move.baseY) / rootContainer.scale.x))
    }
    if (isMiddleDown && rootContainer) {
      const dx = (e.clientX - lastMouseX) * DRAG_SENSITIVITY
      const dy = (e.clientY - lastMouseY) * DRAG_SENSITIVITY
      rootContainer.x += dx
      rootContainer.y += dy
      lastMouseX = e.clientX
      lastMouseY = e.clientY
    }
  }

  const onPointerUp = () => {
    if (isMiddleDown) {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
    isMiddleDown = false
  }
  const onBlur = () => { onPointerUp(); finishMove(true); suppressContextMenu = false }

  const onWheel = (e: WheelEvent) => {
    if (!rootContainer) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rootContainer.scale.x * factor))
    const point = canvasPoint(e)
    const ratio = newScale / rootContainer.scale.x
    rootContainer.position.set(point.x - (point.x - rootContainer.x) * ratio,
      point.y - (point.y - rootContainer.y) * ratio)
    rootContainer.scale.set(newScale)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerdown', onModePointerDown, true)
  window.addEventListener('contextmenu', onContextMenu, true)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('blur', onBlur)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  ;editRuntime.cleanup = () => {
    onPointerUp()
    finishMove(true)
    canvas.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerdown', onModePointerDown, true)
    window.removeEventListener('contextmenu', onContextMenu, true)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('blur', onBlur)
    canvas.removeEventListener('wheel', onWheel)
  }
}

function dispose() {
  loadTokens.clear()
  store.loadingModelIds = []
  frameLines = null
  textureWatcher?.disable()
  textureWatcher = null

  stopObservingViewport?.()
  stopObservingViewport = null

  for (const id of [...containersById.keys()]) {
    removeOne(id)
  }

  if (app) {
    if (typeof editRuntime.cleanup === 'function') editRuntime.cleanup()
    try {
      app.destroy(true, { children: true, texture: true, baseTexture: true })
    } catch (e) {
      console.warn('Pixi destroy error:', e)
    }
    app = null
  }

  rootContainer = null
  stageMain = null
  figureContainer = null
  isMiddleDown = false

  // 清理外部访问入口，避免热重载/卸载后悬挂旧实例
  editRuntime.live2dModels.clear()
  editRuntime.app = null
  editRuntime.cleanup = () => {}
}
</script>

<template>
  <section class="edit-stage">
    <EditStageToolbar :live2dById="live2dById" :jsonPathByModelId="jsonPathByModelId" :background="background"
      @reset-view="resetView" @update:background="background = $event" />
    <div ref="containerRef" class="edit-stage__canvas" :class="`canvas-${background}`" />
    <div v-if="moveMode && store.selectedModel" class="stage-mode" role="status">
      <strong>正在移动：{{ moveMode.name }}</strong>
      <span>移动鼠标调整 · 左键 / Enter 确认 · 右键 / Esc 取消 · X / Y 锁轴</span>
      <span>锁定轴：{{ moveMode.axis === 'none' ? '无' : moveMode.axis.toUpperCase() }} · offsetX: {{ store.selectedModel.offsetX }} · offsetY: {{ store.selectedModel.offsetY }}</span>
    </div>
    <p v-else-if="loadingIds.length" class="stage-status" role="status">正在加载 {{ loadingIds.length }} 个模型…</p>
    <p v-else-if="store.currentWmdl.models.length" class="stage-controls">G 移动选中副模型 · 中键平移 · 滚轮缩放</p>
    <p v-if="!store.currentWmdl.models.length" class="edit-stage__hint">
      点击左侧 "加载模型" 按钮选择 Live2D 模型文件 (.model.json 或 .model3.json)
    </p>
  </section>
</template>

<style scoped>
.edit-stage {
  display: flex;
  flex-direction: column;
  position: relative;
  height: 100%;
  background: var(--ui-window);
  overflow: hidden;
}

.edit-stage__canvas {
  flex: 1;
  min-height: 0;
  position: relative;
}
.canvas-checker { background-color: var(--ui-panel); background-image: conic-gradient(var(--ui-control) 25%, var(--ui-panel) 0 50%, var(--ui-control) 0 75%, var(--ui-panel) 0); background-size: 24px 24px; }
.canvas-dark { background: var(--ui-canvas-dark); }
.canvas-light { background: var(--ui-canvas-light); }
.stage-status, .stage-controls { position: absolute; bottom: 12px; left: 12px; right: 12px; margin: 0; padding: 6px 10px; pointer-events: none; color: var(--ui-text); background: var(--ui-panel); border: 1px solid var(--ui-line); border-radius: var(--ui-radius-compact); font-size: 12px; width: fit-content; max-width: calc(100% - 44px); }
.stage-controls { color: var(--ui-muted); }
.stage-mode { position: absolute; bottom: 12px; left: 12px; max-width: calc(100% - 44px); display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; pointer-events: none; color: var(--ui-text); background: var(--ui-floating); border: 1px solid var(--ui-link); border-radius: var(--ui-radius-compact); font-size: 12px; }

.edit-stage__canvas :deep(canvas) {
  display: block;
}

.edit-stage__hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--ui-muted);
  font-size: 14px;
  pointer-events: none;
  text-align: center;
  padding: 24px;
}
</style>
