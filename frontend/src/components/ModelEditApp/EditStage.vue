<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { toFileUrl } from '../../path_utils'
import { L2dwContainer } from '../../live2d/L2dwContainer'
import { createTextureWatcher, type TextureWatcher } from '../../live2d/textureUtils'
import EditStageToolbar from './EditStageToolbar.vue'

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
 *   - 无立绘选中/左键拖拽（编辑器后续在 ActionPanel 做）
 *   - 步幅参数常量化（DRAG_SENSITIVITY / ZOOM_SENSITIVITY / MIN_SCALE / MAX_SCALE）
 *   - 使用 wmdlModels store 作为唯一数据源
 */

const store = useWmdlModelEditorStore()

const containerRef = ref<HTMLDivElement | null>(null)

let app: PIXI.Application | null = null
const live2dById = new Map<string, Live2DModel>()
const jsonPathByModelId = new Map<string, string>()
const containersById = new Map<string, L2dwContainer>()
let resizeObserver: ResizeObserver | null = null
let textureWatcher: TextureWatcher | null = null

const STAGE_WIDTH = 2560
const STAGE_HEIGHT = 1440

// Root 容器交互常量（与主 Stage 完全一致）
const DRAG_SENSITIVITY = 1      // 中键拖拽灵敏度
const ZOOM_SENSITIVITY = 0.0001 // 滚轮缩放灵敏度（每像素 deltaY）
const MIN_SCALE = 0.1           // 最小缩放
const MAX_SCALE = 10            // 最大缩放

let rootContainer: PIXI.Container | null = null
let stageMain: PIXI.Container | null = null
let figureContainer: PIXI.Container | null = null
let frameContainer: PIXI.Container | null = null

let isMiddleDown = false
let lastMouseX = 0
let lastMouseY = 0

onMounted(() => {
  void init()
})

onBeforeUnmount(() => {
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
    resolution: window.devicePixelRatio || 1,
  })

  // The plugin's auto-update reads window.PIXI.Ticker.
  ;(window as any).PIXI = PIXI

  container.appendChild(app.view as HTMLCanvasElement)

  // 创建 Root 容器（中键拖拽和滚轮缩放操作它）
  rootContainer = new PIXI.Container()
  rootContainer.x = app.renderer.width / 2
  rootContainer.y = app.renderer.height / 2
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
  const frame = new PIXI.Graphics()
  frame.lineStyle(2, 0x00FF00)
  frame.drawRect(-STAGE_WIDTH / 2, -STAGE_HEIGHT / 2, STAGE_WIDTH, STAGE_HEIGHT)
  frameContainer.addChild(frame)
  rootContainer.addChild(frameContainer)

  resizeObserver = new ResizeObserver(() => {
    if (!app || !containerRef.value || !rootContainer) return
    const w = containerRef.value.clientWidth
    const h = containerRef.value.clientHeight

    const oldW = app.renderer.width
    const oldH = app.renderer.height
    const relX = rootContainer.x / oldW
    const relY = rootContainer.y / oldH

    app.renderer.resize(w, h)
    rootContainer.x = relX * w
    rootContainer.y = relY * h
  })
  resizeObserver.observe(container)

  attachDomHandlers()
  textureWatcher = createTextureWatcher(
    () => live2dById,
    () => jsonPathByModelId,
  )
}

watch(
  () => store.currentWmdl.models.map((m) => ({ id: m.id, jsonAbsPath: m.jsonAbsPath })),
  async (newItems, oldItems) => {
    if (!app) return
    const newMap = new Map(newItems.map((item) => [item.id, item.jsonAbsPath]))
    const oldMap = new Map((oldItems ?? []).map((item) => [item.id, item.jsonAbsPath]))
    const newSet = new Set(newMap.keys())
    const oldSet = new Set(oldMap.keys())

    for (const id of newSet) {
      if (!oldSet.has(id)) {
        await loadOne(id)
        continue
      }

      if (newMap.get(id) !== oldMap.get(id)) {
        removeOne(id)
        await loadOne(id)
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

  try {
    const model = await Live2DModel.from(url, { idleMotionGroup: '', autoInteract: false })

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

    // 暴露给 EditActionPanel 等组件访问当前选中模型对应的 Live2D 实例
    ;(window as any).__l2dwEditModels = live2dById

    // 从模型描述 json 读取动作 / 表情并缓存到 store，供动作/表情页签读取
    void store.populateMotionsExps(id)
    // 从 coreModel 抓取参数 / 部件快照，写入 initParams / initOpacities
    void store.populateInitValues(id)
  } catch (err) {
    console.error('Failed to load Live2D model:', err)
    await store.removeModel(id)
  }
}

function removeOne(id: string) {
  const wrapper = containersById.get(id)
  if (!wrapper) return
  figureContainer?.removeChild(wrapper)
  wrapper.destroy({ children: true })
  live2dById.delete(id)
  jsonPathByModelId.delete(id)
  containersById.delete(id)
  ;(window as any).__l2dwEditModels = live2dById
}

function attachDomHandlers() {
  if (!app) return
  const canvas = app.view as HTMLCanvasElement

  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 1 && rootContainer) {
      isMiddleDown = true
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      e.preventDefault()
    }
  }

  const onPointerMove = (e: PointerEvent) => {
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
    isMiddleDown = false
  }

  const onWheel = (e: WheelEvent) => {
    if (!rootContainer) return
    e.preventDefault()
    const delta = -e.deltaY * ZOOM_SENSITIVITY
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rootContainer.scale.x + delta))
    rootContainer.scale.set(newScale)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  ;(app as any).__l2dwEditCleanup = () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
  }
}

function dispose() {
  textureWatcher?.disable()
  textureWatcher = null

  resizeObserver?.disconnect()
  resizeObserver = null

  for (const id of [...containersById.keys()]) {
    removeOne(id)
  }

  if (app) {
    const cleanup = (app as any).__l2dwEditCleanup
    if (typeof cleanup === 'function') cleanup()
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
  ;(window as any).__l2dwEditModels = undefined
}
</script>

<template>
  <section class="edit-stage">
    <EditStageToolbar :live2dById="live2dById" :jsonPathByModelId="jsonPathByModelId" />
    <div ref="containerRef" class="edit-stage__canvas" />
    <p v-if="!store.currentWmdl.models.length" class="edit-stage__hint">
      点击左侧 "加载模型" 按钮选择 Live2D 模型文件 (.model.json 或 .model3.json)
    </p>
  </section>
</template>

<style scoped>
.edit-stage {
  position: relative;
  height: 100%;
  background: #181a20;
  overflow: hidden;
}

.edit-stage__canvas {
  position: absolute;
  top: 41px;
  left: 0;
  right: 0;
  bottom: 0;
}

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
  color: #6b7280;
  font-size: 14px;
  pointer-events: none;
  text-align: center;
  padding: 24px;
}
</style>
