<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { vTabIndicator } from '../../utils/tabIndicator'
import EditWmdlTab from './EditWmdlTab.vue'
import EditParamsTab from './EditParamsTab.vue'
import EditPartsTab from './EditPartsTab.vue'
import EditMotionsTab from './EditMotionsTab.vue'
import EditExpressionsTab from './EditExpressionsTab.vue'
import { useWmdlModelEditorStore } from '../../stores/wmdlModelEditor'

/**
 * 编辑器窗口的右侧操作区。
 *
 * - 顶部：页签栏（wmdl / 初始参数 / 部件参数 / 动作 / 表情）
 * - 底部：根据 activeTab 显示对应内容，
 *   每个 panel 都抽到独立 .vue 组件。
 *
 * App 启动时自动创建一个空白的 wmdl 配置（store 内部已初始化）。
 */
type Tab = 'wmdl' | 'params' | 'parts' | 'motions' | 'exprs'
const activeTab = ref<Tab>('wmdl')

const tabs: { id: Tab; label: string }[] = [
  { id: 'wmdl', label: 'wmdl' },
  { id: 'params', label: '初始参数' },
  { id: 'parts', label: '部件参数' },
  { id: 'motions', label: '动作' },
  { id: 'exprs', label: '表情' },
]

// 确保 wmdl store 已被初始化（store 在 import 时已设置 state，但显式调用一次确保 hot-reload 时不丢状态）
const wmdlStore = useWmdlModelEditorStore()
onMounted(() => {
  // App 启动即创建空白 wmdl 配置（store state 默认已是空白，这里仅作显式触发的钩子）
  if (!wmdlStore.currentWmdl) {
    wmdlStore.reset()
  }
})
</script>

<template>
  <aside class="edit-action-panel">
    <div v-tab-indicator class="panel__tabs">
      <span class="tab-indicator tab-indicator--underline" aria-hidden="true" />
      <button
        v-for="t in tabs"
        :key="t.id"
        class="ui-tab tab-btn"
        :class="{ 'is-active': activeTab === t.id }"
        :aria-pressed="activeTab === t.id"
        :title="t.id === 'wmdl' && wmdlStore.isDirty ? '有未保存的配置或模型 JSON 修改' : undefined"
        @click="activeTab = t.id"
      >
        {{ t.label }}{{ t.id === 'wmdl' && wmdlStore.isDirty ? '*' : '' }}
      </button>
    </div>

    <div class="panel__body">
      <EditWmdlTab v-if="activeTab === 'wmdl'" />
      <EditParamsTab v-else-if="activeTab === 'params'" />
      <EditPartsTab v-else-if="activeTab === 'parts'" />
      <EditMotionsTab v-else-if="activeTab === 'motions'" />
      <EditExpressionsTab v-else-if="activeTab === 'exprs'" />
    </div>
  </aside>
</template>

<style scoped>
.edit-action-panel {
  height: 100%;
  background: var(--ui-panel);
  color: var(--ui-text);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel__tabs {
  position: relative;
  display: flex;
  border-bottom: 1px solid var(--ui-line);
  padding: 4px 4px 0;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.tab-btn {
  flex: 1 0 auto;
  padding: 12px 3px;
  min-width: 0;
  white-space: nowrap;
  font-size: 13px;
}

.panel__body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.panel__placeholder {
  margin: auto;
  color: var(--ui-muted);
  font-size: 13px;
  text-align: center;
  padding: 16px;
}
</style>
