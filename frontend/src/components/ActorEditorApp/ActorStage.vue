<script setup lang="ts">
/**
 * 演出编辑器的 PIXI 舞台。
 *
 * 简化版的 EditStage：
 *   - 不支持多模型（只渲染当前选中模型）。
 *   - 不需要 zIndex、可见性、offset 同步。
 *   - 不需要 texture watcher（编辑表情不需要重载纹理）。
 *   - 加载完成后通过 editRuntime.live2dModels 暴露 Live2DModel，使 coreAdapter 写入生效。
 *   - 通过 defineExpose 暴露 applyParameters，供 EditPanel 在表情/参数变化时实时预览。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import { toFileUrl } from '../../path_utils'
import { editRuntime } from '../../utils/runtimeRegistry'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../../utils/consts'

; (window as any).PIXI = PIXI

const store = useWmdlModelEditorStore()
const containerRef = ref<HTMLDivElement | null>(null)

let app: PIXI.Application | null = null
let rootContainer: PIXI.Container | null = null
let stageMain: PIXI.Container | null = null
let modelWrapper: PIXI.Container | null = null
let live2d: Live2DModel | null = null
let resizeObserver: ResizeObserver | null = null
let detachDomHandlers: (() => void) | null = null

let isDragging = false
let dragLastX = 0
let dragLastY = 0

const MIN_SCALE = 0.1
const MAX_SCALE = 10
const ZOOM_FACTOR = 1.1

const hasSelection = computed(() => !!store.selectedModelId)

onMounted(async () => {
  await init()
  await ensureModelLoaded()
})

onBeforeUnmount(() => {
  dispose()
})

watch(
  () => store.selectedModelId,
  async (newId, oldId) => {
    if (!app) return
    if (newId !== oldId || !live2d) {
      await ensureModelLoaded()
    }
  },
)

async function init() {
  const container = containerRef.value
  if (!container) return

  app = new PIXI.Application({
    width: container.clientWidth || 800,
    height: container.clientHeight || 600,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  })
  app.ticker.maxFPS = 60

  container.appendChild(app.view as HTMLCanvasElement)

  rootContainer = new PIXI.Container()
  rootContainer.x = app.renderer.width / 2
  rootContainer.y = app.renderer.height / 2
  rootContainer.scale.set(0.5)

  stageMain = new PIXI.Container()
  stageMain.width = STAGE_WIDTH
  stageMain.height = STAGE_HEIGHT
  stageMain.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)

  rootContainer.addChild(stageMain)
  app.stage.addChild(rootContainer)

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
}

async function ensureModelLoaded() {
  if (!app || !stageMain) return
  const item = store.selectedModel
  if (!item) {
    if (modelWrapper) {
      modelWrapper.destroy({ children: true })
      modelWrapper = null
    }
    live2d = null
    editRuntime.live2dModels = new Map()
    return
  }

  // 清理旧模型
  if (modelWrapper) {
    modelWrapper.destroy({ children: true })
    modelWrapper = null
    live2d = null
  }

  const url = toFileUrl(item.jsonAbsPath)
  try {
    const model = await Live2DModel.from(url, {
      idleMotionGroup: '',
      autoInteract: false,
    })
    const scaleX = STAGE_WIDTH / model.width
    const scaleY = STAGE_HEIGHT / model.height
    const targetScale = Math.min(scaleX, scaleY) * 1.25
    model.scale.set(targetScale, targetScale)
    model.anchor.set(0.5)
    model.position.x = 0 + item.offsetX
    model.position.y = STAGE_HEIGHT / 1.8 + item.offsetY

    modelWrapper = new PIXI.Container()
    modelWrapper.addChild(model)
    stageMain.addChild(modelWrapper)
    live2d = model

    const map = new Map<string, Live2DModel>()
    map.set(item.id, model)
    editRuntime.live2dModels = map

    // 缓存 motions/expressions + 抓取 initParams/initOpacities 快照
    await store.populateMotionsExps(item.id)
    await store.populateInitValues(item.id)
  } catch (err) {
    console.error('ActorStage load failed:', err)
  }
}

function attachDomHandlers() {
  if (!app) return
  const canvas = app.view as HTMLCanvasElement

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    isDragging = true
    dragLastX = e.clientX
    dragLastY = e.clientY
    canvas.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging || !rootContainer) return
    rootContainer.x += e.clientX - dragLastX
    rootContainer.y += e.clientY - dragLastY
    dragLastX = e.clientX
    dragLastY = e.clientY
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!isDragging) return
    isDragging = false
    canvas.releasePointerCapture?.(e.pointerId)
  }

  const onWheel = (e: WheelEvent) => {
    if (!rootContainer) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rootContainer.scale.x * factor))
    rootContainer.scale.set(next)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  detachDomHandlers = () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
  }
}

function dispose() {
  detachDomHandlers?.()
  detachDomHandlers = null
  resizeObserver?.disconnect()
  resizeObserver = null
  if (modelWrapper) {
    modelWrapper.destroy({ children: true })
    modelWrapper = null
  }
  live2d = null
  editRuntime.live2dModels = new Map()
  if (rootContainer) {
    rootContainer.destroy({ children: true })
    rootContainer = null
  }
  if (app) {
    try {
      app.destroy(true, { children: true, texture: true, baseTexture: true })
    } catch (e) {
      console.warn('ActorStage pixi destroy error:', e)
    }
    app = null
  }
}

defineExpose({
  applyParameters(params: Array<{ id: string; val: number }>) {
    if (!live2d) return
    const core: any = (live2d as any).internalModel?.coreModel
    if (!core) return
    for (const { id, val } of params) {
      if (typeof core.setParameterValueById === 'function') {
        core.setParameterValueById(id, val)
      } else if (typeof core.setParamFloat === 'function') {
        core.setParamFloat(id, val)
      }
    }
  },
})
</script>

<template>
  <div ref="containerRef" class="actor-stage">
    <p v-if="!hasSelection" class="actor-stage__hint">请先在 wmdl 中选择模型</p>
  </div>
</template>

<style scoped>
.actor-stage {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: rgba(20, 23, 28, 0.6);
  border-radius: 6px;
  overflow: hidden;
}

.actor-stage :deep(canvas) {
  display: block;
}

.actor-stage__hint {
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
</style>
