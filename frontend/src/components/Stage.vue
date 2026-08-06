<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import { LoaderResource } from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display-webgal'
import { useModelStore } from '../stores/models'
import { toFileUrl } from '../path_utils'
import { L2dwContainer } from '../live2d/L2dwContainer'
import { SpecialId } from '../live2d/specialIds'
import { OpenEditor } from '../../wailsjs/go/main/App'
import type { WmdlModelItem } from '../stores/wmdlTypes'
import { getShortcutHints, resolveShortcutTargetType } from '../composables/useShortcuts'
import emitter, { StageEvents } from '../stores/emitter'
import defaultBackgroundUrl from '../assets/backgrounds/default.jpg'
import { previewRuntime } from '../utils/runtimeRegistry'

const store = useModelStore()

const containerRef = ref<HTMLDivElement | null>(null)

// 左下操作提示：折叠状态独立于选择结果，由用户手工切换
const hintsExpanded = ref(true)
function toggleHints() {
  hintsExpanded.value = !hintsExpanded.value
}

interface MouseHint { keys: string; description: string }
interface HintsView {
  title: string
  mouse: MouseHint[]
  shortcuts: MouseHint[]
}

const TARGET_LABELS: Record<ReturnType<typeof resolveShortcutTargetType>, string> = {
  background: '背景',
  stage: '主场景',
  model: '立绘',
  none: '未选中',
}

// 通用操作：所有选中状态都会显示
const COMMON_MOUSE_HINTS: MouseHint[] = [
  { keys: '中键拖动', description: '平移舞台视图' },
  { keys: '鼠标滚轮', description: '缩放舞台视图' },
]
const COMMON_SHORTCUT_HINTS: MouseHint[] = [
  { keys: 'F1', description: '打开模型编辑器窗口' },
]

// 各类型专属的鼠标提示
const MOUSE_HINTS_BY_TYPE: Record<ReturnType<typeof resolveShortcutTargetType>, MouseHint[]> = {
  background: [{ keys: '左键拖动', description: '移动背景' }],
  stage: [{ keys: '左键拖动', description: '移动主场景' }],
  model: [{ keys: '左键拖动', description: '移动立绘' }],
  none: [],
}

const hints = computed<HintsView>(() => {
  const type = resolveShortcutTargetType(store.selectedId)
  return {
    title: `操作提示 · ${TARGET_LABELS[type]}`,
    mouse: [...MOUSE_HINTS_BY_TYPE[type], ...COMMON_MOUSE_HINTS],
    shortcuts: [...getShortcutHints(type), ...COMMON_SHORTCUT_HINTS],
  }
})

let app: PIXI.Application | null = null
const live2dById = new Map<string, Live2DModel>()
const containersById = new Map<string, L2dwContainer>()
let resizeObserver: ResizeObserver | null = null
let backgroundSprite: PIXI.Sprite | null = null

const STAGE_WIDTH = 2560
const STAGE_HEIGHT = 1440

// Root 容器交互常量
const DRAG_SENSITIVITY = 1      // 中键拖拽灵敏度
const ZOOM_SENSITIVITY = 0.0001  // 滚轮缩放灵敏度（每像素 deltaY）
const MIN_SCALE = 0.1           // 最小缩放
const MAX_SCALE = 10            // 最大缩放

let rootContainer: PIXI.Container | null = null
let stageMain: PIXI.Container | null = null
let backgroundContainer: L2dwContainer | null = null
let figureContainer: PIXI.Container | null = null
let frameContainer: PIXI.Container | null = null

interface DragState {
  wrapper: { x: number; y: number }
  offsetX: number
  offsetY: number
}
let drag: DragState | null = null
let isMiddleDown = false
let lastMouseX = 0
let lastMouseY = 0

onMounted(() => {
  void init()
  emitter.on(StageEvents.ReloadModel, reloadOne)
})

onBeforeUnmount(() => {
  emitter.off(StageEvents.ReloadModel, reloadOne)
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
  app.ticker.maxFPS = 60
  previewRuntime.app = app

  // The plugin's auto-update reads window.PIXI.Ticker.
  ;(window as any).PIXI = PIXI

  container.appendChild(app.view as HTMLCanvasElement)

  // 创建 Root 容器（用户通过中键拖拽和滚轮缩放操作它）
  rootContainer = new PIXI.Container()
  rootContainer.x = app.renderer.width / 2
  rootContainer.y = app.renderer.height / 2
  rootContainer.scale.set(0.33)

  // 创建主容器结构
  stageMain = new PIXI.Container()
  stageMain.width = STAGE_WIDTH
  stageMain.height = STAGE_HEIGHT
  stageMain.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  stageMain.x = 0
  stageMain.y = 0

  // 创建子容器
  backgroundContainer = new L2dwContainer()
  backgroundContainer.width = STAGE_WIDTH
  backgroundContainer.height = STAGE_HEIGHT
  backgroundContainer.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)
  backgroundContainer.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 2)

  figureContainer = new PIXI.Container()
  figureContainer.width = STAGE_WIDTH
  figureContainer.height = STAGE_HEIGHT

  // 添加到舞台（背景容器在最下，立绘在上）
  stageMain.addChild(backgroundContainer)
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
    fitBackground()
  })
  resizeObserver.observe(container)

  attachDomHandlers()

  // 暴露特殊容器（StageMain / BGContainer），供 ModelActionPanel 直接做变换
  previewRuntime.specialContainers.set(SpecialId.StageMain, stageMain!)
  previewRuntime.specialContainers.set(SpecialId.BgContainer, backgroundContainer!)

  void loadDefaultBackground()
}

watch(
  () => store.models.map((m) => m.id),
  async (newIds, oldIds) => {
    if (!app) return
    const newSet = new Set(newIds)
    const oldSet = new Set(oldIds ?? [])

    for (const id of newIds) {
      if (!oldSet.has(id) && !containersById.has(id)) {
        await loadOne(id)
      }
    }

    for (const id of oldIds ?? []) {
      if (!newSet.has(id)) {
        removeOne(id)
      }
    }
  },
  { immediate: true },
)

// 监听模型顺序变化，同步更新渲染层级
watch(
  () => store.models.map((m) => m.id),
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

// 监听模型可见性变化
watch(
  () => store.models.map((m) => ({ id: m.id, visible: m.visible })),
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

watch(
  () => store.selectedId,
  (id) => {
    setCursor(id ? 'grab' : 'default')
  },
  { immediate: true },
)

// baseX/baseY 锚定的是 stageMain 内部坐标系的中心，与画布像素无关，
// 在 loadOne 里 setBasePosition 一次即可，无需随 resize 更新。

async function loadOne(id: string) {
  if (!app) return
  const entry = store.models.find((m) => m.id === id)
  if (!entry) return

  try {
    await loadWmdlModels(entry)

    store.selectedId = id
  } catch (err) {
    console.error('Failed to load model:', err)
    await store.remove(id)
  }
}

async function loadWmdlModels(entry: NonNullable<ReturnType<typeof store.models.find>>) {
  const wmdlModels = entry.wmdlModels ?? []
  if (wmdlModels.length === 0) return

  // 创建主 wrapper（wmdl 整体容器）
  const mainWrapper = new L2dwContainer()
  mainWrapper.setBasePosition(STAGE_WIDTH / 2, STAGE_HEIGHT / 1.8)
  mainWrapper.pivot.set(0, STAGE_HEIGHT / 2);
  figureContainer?.addChild(mainWrapper)
  containersById.set(entry.id, mainWrapper)

  // 同步 state 到 container
  if (entry.state) {
    mainWrapper.x = entry.state.x ?? 0
    mainWrapper.y = entry.state.y ?? 0
    mainWrapper.scale.set(entry.state.scale ?? 1)
    mainWrapper.rotation = ((entry.state.rotation ?? 0) * Math.PI) / 180
    mainWrapper.alpha = entry.state.alpha ?? 1
  }

  const subModelIds: string[] = []

  // 每个子模型用独立的 wrapper，最后装入主 wrapper
  for (const wmdlModel of wmdlModels) {
    const url = toFileUrl(wmdlModel.jsonAbsPath)
    const model = await Live2DModel.from(url, { idleMotionGroup: '', autoInteract: false })

    const scaleX = STAGE_WIDTH / model.width
    const scaleY = STAGE_HEIGHT / model.height
    const targetScale = Math.min(scaleX, scaleY) * 1.25
    const targetHeight = model.height * targetScale

    model.scale.x = targetScale
    model.scale.y = targetScale
    model.anchor.set(0.5)
    model.position.x = 0 + wmdlModel.offsetX;
    model.position.y = STAGE_HEIGHT / 2 + wmdlModel.offsetY;

    mainWrapper.addChild(model)
    live2dById.set(wmdlModel.id, model)
    subModelIds.push(wmdlModel.id)
  }

  // 存储子模型 ID 映射
  previewRuntime.wmdlSubModels.set(entry.id, { subModelIds, mainWrapper })

  // 暴露给外部组件访问
  previewRuntime.live2dModels = live2dById
  previewRuntime.modelWrappers = containersById
}

async function reloadOne(id: string) {
  const entry = store.models.find((m) => m.id === id)
  if (!entry?.wmdlConfig?.wmdlFilePath) return

  const ok = await store.reloadWmdlConfig(id)
  if (!ok) return

  store.selectedId = null
  removeOne(id)
  await loadWmdlModels(entry)
  store.selectedId = id
}

function removeOne(id: string) {
  const wmdlInfo = previewRuntime.wmdlSubModels.get(id)
  wmdlInfo?.subModelIds.forEach((subId: string) => {
    live2dById.delete(subId)
  })
  previewRuntime.wmdlSubModels.delete(id)

  const wrapper = containersById.get(id)
  if (wrapper) {
    if (drag && drag.wrapper === wrapper) {
      drag = null
    }
    figureContainer?.removeChild(wrapper)
    wrapper.destroy({ children: true })
    containersById.delete(id)
  }

  // 更新全局引用
  previewRuntime.live2dModels = live2dById
  previewRuntime.modelWrappers = containersById
}

// Pixi v6's pointer events go through the InteractionManager plugin and use
// InteractionEvent (with data: InteractionData). For drag handling we listen
// on the canvas DOM element directly — simpler and works regardless of the
// InteractionManager state.
function attachDomHandlers() {
  if (!app) return
  const canvas = app.view as HTMLCanvasElement

  const toLocal = (clientX: number, clientY: number): PIXI.Point => {
    const rect = canvas.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * app!.renderer.width
    const y = ((clientY - rect.top) / rect.height) * app!.renderer.height
    return new PIXI.Point(x, y)
  }

  const onPointerDown = (e: PointerEvent) => {
    // 点击 canvas 时移除输入框焦点，避免快捷键被拦截
    if (document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        (document.activeElement as HTMLElement)?.isContentEditable) {
      ;(document.activeElement as HTMLElement).blur()
    }

    // 中键优先：中键按下即标记拖拽
    if (e.button === 1 && rootContainer) {
      isMiddleDown = true
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      e.preventDefault()
      return
    }
    // 中键正在拖拽时忽略左键
    if (isMiddleDown) return
    const id = store.selectedId
    if (!id) return
    const wrapper = containersById.get(id)
    if (wrapper) {
      const p = toLocal(e.clientX, e.clientY)
      const scale = rootContainer!.scale.x
      drag = { wrapper, offsetX: p.x / scale - wrapper.x, offsetY: p.y / scale - wrapper.y }
      setCursor('grabbing')
      e.preventDefault()
      return
    }
    // 占位项（StageMain / BGContainer）也可以拖拽
    const specialC = previewRuntime.specialContainers.get(id)
    if (specialC) {
      const p = toLocal(e.clientX, e.clientY)
      const scale = rootContainer!.scale.x
      drag = { wrapper: specialC, offsetX: p.x / scale - specialC.x, offsetY: p.y / scale - specialC.y }
      setCursor('grabbing')
      e.preventDefault()
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    // 中键拖拽 Root（优先）
    if (isMiddleDown && rootContainer) {
      const dx = (e.clientX - lastMouseX) * DRAG_SENSITIVITY
      const dy = (e.clientY - lastMouseY) * DRAG_SENSITIVITY
      rootContainer.x += dx
      rootContainer.y += dy
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      return
    }
    // 左键拖拽立绘
    if (drag) {
      const p = toLocal(e.clientX, e.clientY)
      const scale = rootContainer!.scale.x
      drag.wrapper.x = p.x / scale - drag.offsetX
      drag.wrapper.y = p.y / scale - drag.offsetY
      emitter.emit(StageEvents.TransformChange, store.selectedId)
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    if (drag) setCursor(store.selectedId ? 'grab' : 'default')
    drag = null
    // pointerup 一定触发（任意按钮），统一清空中键状态
    isMiddleDown = false
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  // 滚轮缩放 Root
  const onWheel = (e: WheelEvent) => {
    if (!rootContainer) return
    e.preventDefault()
    const delta = -e.deltaY * ZOOM_SENSITIVITY
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rootContainer.scale.x + delta))
    rootContainer.scale.set(newScale)
  }

  canvas.addEventListener('wheel', onWheel, { passive: false })

  // F1 打开独立的"模型编辑器"窗口
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'F1') {
      e.preventDefault()
      OpenEditor().catch((err) => console.error('OpenEditor failed:', err))
    }
  }
  window.addEventListener('keydown', onKeyDown)

  // Save for cleanup
  previewRuntime.cleanup = () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKeyDown)
  }
}

function setCursor(c: string) {
  if (containerRef.value) {
    containerRef.value.style.cursor = c
  }
}

function fitBackground() {
  if (!backgroundSprite || !backgroundContainer) return
  const w = STAGE_WIDTH
  const h = STAGE_HEIGHT
  const texture = backgroundSprite.texture.baseTexture

  // 原始图片尺寸
  const imgW = texture.width
  const imgH = texture.height

  // 计算等比缩放，保证填满 backgroundContainer，短边刚好顶到边缘
  const scale = Math.max(w / imgW, h / imgH)

  backgroundSprite.width = imgW * scale
  backgroundSprite.height = imgH * scale

  // 居中
  backgroundSprite.x = w / 2
  backgroundSprite.y = h / 2
}

function applyBackgroundTexture(texture: PIXI.Texture) {
  if (!backgroundContainer) return
  if (backgroundSprite) {
    backgroundContainer.removeChild(backgroundSprite)
    backgroundSprite.destroy({ texture: true, baseTexture: true })
    backgroundSprite = null
  }
  const sprite = new PIXI.Sprite(texture)
  sprite.anchor.set(0.5)
  backgroundContainer.addChildAt(sprite, 0)
  backgroundSprite = sprite
  fitBackground()
}

async function loadBackground(url: string) {
  if (!app || !backgroundContainer) return

  try {
    const texture = await new Promise<PIXI.Texture>((resolve, reject) => {
      const loader = new PIXI.Loader()
      loader.add('background', toFileUrl(url), {
        loadType: LoaderResource.LOAD_TYPE.IMAGE,
      })
      loader.onError.add((_, __, err) => {
        console.error('PIXI Loader error:', err)
        reject(err)
      })
      loader.load((_, resources) => {
        if (resources.background?.texture) {
          resolve(resources.background.texture)
        } else {
          const err = resources.background?.error || new Error('Failed to load background image')
          console.error('Resource error:', err)
          reject(err)
        }
      })
    })
    applyBackgroundTexture(texture)
  } catch (err) {
    console.error('Failed to load background image:', err)
  }
}

async function loadDefaultBackground() {
  if (!app || !backgroundContainer) return
  try {
    const texture = await new Promise<PIXI.Texture>((resolve, reject) => {
      const resolved = PIXI.Texture.from(defaultBackgroundUrl)
      if (resolved.baseTexture.valid) {
        resolve(resolved)
        return
      }
      resolved.baseTexture.once('loaded', () => resolve(resolved))
      resolved.baseTexture.once('error', (err) => reject(err))
    })
    applyBackgroundTexture(texture)
  } catch (err) {
    console.error('Failed to load default background:', err)
  }
}

watch(
  () => store.backgroundUrl,
  async (url) => {
    if (!backgroundContainer) return
    if (url) {
      await loadBackground(url)
    } else if (backgroundSprite) {
      backgroundContainer.removeChild(backgroundSprite)
      backgroundSprite.destroy({ texture: true, baseTexture: true })
      backgroundSprite = null
    }
  },
  { immediate: true }
)

function dispose() {
  resizeObserver?.disconnect()
  resizeObserver = null

  if (backgroundSprite) {
    backgroundSprite.destroy({ texture: true, baseTexture: true })
    backgroundSprite = null
  }

  for (const id of [...containersById.keys()]) {
    removeOne(id)
  }

  if (app) {
    if (typeof previewRuntime.cleanup === 'function') previewRuntime.cleanup()
    try {
      app.destroy(true, { children: true, texture: true, baseTexture: true })
    } catch (e) {
      console.warn('Pixi destroy error:', e)
    }
    app = null
  }

  rootContainer = null
  stageMain = null
  backgroundContainer = null
  figureContainer = null
  if (frameContainer) {
    frameContainer.destroy({ children: true })
    frameContainer = null
  }
  isMiddleDown = false

  previewRuntime.specialContainers.clear()
  previewRuntime.wmdlSubModels.clear()
  previewRuntime.app = null
  previewRuntime.cleanup = () => {}
}
</script>

<template>
  <section class="stage">
    <div ref="containerRef" class="stage__canvas" />
    <!-- <p v-if="!store.models.length && !backgroundSprite" class="stage__hint">
      点击左上角 “加载模型” 按钮选择 Live2D 模型文件 (.model.json 或 .model3.json)
    </p> -->
    <div class="stage__hints" :class="{ 'is-collapsed': !hintsExpanded }">
      <button
        type="button"
        class="stage__hints-toggle"
        :aria-expanded="hintsExpanded"
        :aria-label="hintsExpanded ? '收起操作提示' : '展开操作提示'"
        @click="toggleHints"
      >
        <span class="stage__hints-toggle-text">{{ hints.title }}</span>
        <span class="stage__hints-toggle-icon" aria-hidden="true">{{ hintsExpanded ? '▾' : '▸' }}</span>
      </button>
      <div v-show="hintsExpanded" class="stage__hints-body">
        <section v-if="hints.mouse.length" class="stage__hints-group">
          <h4 class="stage__hints-heading">鼠标</h4>
          <ul class="stage__hints-list">
            <li v-for="item in hints.mouse" :key="`m-${item.keys}`">
              <span class="stage__hints-keys">{{ item.keys }}</span>
              <span class="stage__hints-desc">{{ item.description }}</span>
            </li>
          </ul>
        </section>
        <section v-if="hints.shortcuts.length" class="stage__hints-group">
          <h4 class="stage__hints-heading">快捷键</h4>
          <ul class="stage__hints-list">
            <li v-for="item in hints.shortcuts" :key="`s-${item.keys}`">
              <span class="stage__hints-keys">{{ item.keys }}</span>
              <span class="stage__hints-desc">{{ item.description }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stage {
  position: relative;
  height: 100%;
  background: #181a20;
  overflow: hidden;
}

.stage__canvas {
  position: absolute;
  inset: 0;
}

.stage__canvas :deep(canvas) {
  display: block;
}

.stage__hint {
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

.stage__hints {
  position: absolute;
  left: 16px;
  bottom: 16px;
  max-width: calc(100% - 32px);
  z-index: 10;
  font-size: 12px;
  line-height: 1.5;
  color: #fff;
  pointer-events: none; /* 正文不拦截舞台操作，仅折叠按钮可点击 */
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000,
    0 0 2px rgba(0, 0, 0, 0.85);
  user-select: none;
}

.stage__hints-toggle {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-shadow: inherit;
}

.stage__hints-toggle:hover {
  background: rgba(0, 0, 0, 0.55);
}

.stage__hints-toggle-text {
  font-weight: 600;
}

.stage__hints-toggle-icon {
  font-size: 12px;
}

.stage__hints-body {
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  width: max-content;
  max-width: calc(100vw - 32px);
}

.stage__hints-group + .stage__hints-group {
  margin-top: 6px;
}

.stage__hints-heading {
  margin: 0 0 4px 0;
  font-size: 11px;
  font-weight: 600;
  color: #ffe082;
  letter-spacing: 0.5px;
}

.stage__hints-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.stage__hints-list li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  white-space: nowrap;
}

.stage__hints-keys {
  flex: 0 0 auto;
  min-width: 96px;
  font-weight: 600;
  color: #b3e5fc;
}

.stage__hints-desc {
  flex: 1 1 auto;
}

.stage__hints.is-collapsed .stage__hints-toggle {
  background: rgba(0, 0, 0, 0.55);
}
</style>
