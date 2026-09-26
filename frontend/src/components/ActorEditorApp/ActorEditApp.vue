<script setup lang="ts">
/**
 * 演出编辑器（Actor Editor）的根组件。
 *
 * 布局：
 *   顶部  标题栏（模型选择器 + 当前 wmdl 文件名）
 *   中部  左侧 ActorStage (PIXI 预览) + 右侧 EditPanel (表情/参数面板)
 *
 * 数据：复用 useWmdlModelEditorStore，仅在演出编辑模式下持有当前 wmdl 的副本。
 * 加载逻辑由 main.ts 在启动时（通过 --actor-wmdl 参数）自动触发。
 *
 * 右侧面板支持拖拽调整宽度（min 280, max 600）。
 */
import { computed, ref } from 'vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'
import type { ParamCalc } from '../../stores/wmdlTypes'
import ActorStage from './ActorStage.vue'
import EditPanel from './EditPanel.vue'
import ResizeHandle from '../ModelEditApp/ResizeHandle.vue'
import MessageHost from '../common/MessageHost.vue'

const store = useWmdlModelEditorStore()
const stageRef = ref<InstanceType<typeof ActorStage> | null>(null)

const wmdlName = computed(() => store.currentWmdl.name || '未加载')

const PANEL_MIN = 280
const PANEL_MAX = 600
const DEFAULT_PANEL = 360
const panelWidth = ref(DEFAULT_PANEL)

function onRightDrag(dx: number) {
  const next = panelWidth.value - dx
  panelWidth.value = Math.max(PANEL_MIN, Math.min(PANEL_MAX, next))
}

function onApplyParams(params: Array<{ id: string; val: number; calc: ParamCalc }>) {
  stageRef.value?.applyParameters(params)
}
</script>

<template>
  <div class="actor-app">
    <header class="actor-app__header">
      <h1 class="actor-app__title">演出编辑器</h1>
      <div class="actor-app__meta">
        <span class="actor-app__wmdl-name" :title="store.currentWmdl.wmdlFilePath ?? ''">
          {{ wmdlName }}
        </span>
      </div>
    </header>

    <section class="actor-app__body">
      <div class="actor-app__stage">
        <ActorStage ref="stageRef" />
      </div>
      <ResizeHandle side="right" @drag="onRightDrag" />
      <aside class="actor-app__panel" :style="{ width: panelWidth + 'px' }">
        <EditPanel @apply-params="onApplyParams" />
      </aside>
    </section>
    <MessageHost />
  </div>
</template>

<style scoped>
.actor-app {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background: #181a20;
  color: #e6e6e6;
  overflow: hidden;
}

.actor-app__header {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #2c313a;
  background: #1d2026;
  flex-shrink: 0;
  gap: 16px;
}

.actor-app__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}

.actor-app__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.actor-app__wmdl-name {
  font-size: 12px;
  color: #b0b8c4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

.actor-app__body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  align-items: stretch;
}

.actor-app__stage {
  flex: 1;
  min-width: 0;
  padding: 12px;
  display: flex;
}

.actor-app__panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #2c313a;
  background: #1d2026;
  min-width: 0;
}
</style>
