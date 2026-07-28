<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
    <div class="panel__tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="tab-btn"
        :class="{ 'is-active': activeTab === t.id }"
        @click="activeTab = t.id"
      >
        {{ t.label }}
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
  background: #1d2026;
  color: #e6e6e6;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel__tabs {
  display: flex;
  border-bottom: 1px solid #2c313a;
  padding: 0 12px;
  flex-shrink: 0;
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
}

.tab-btn:hover {
  color: #e6e6e6;
}

.tab-btn.is-active {
  color: #e6e6e6;
  border-bottom-color: #2f80ed;
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
  color: #6b7280;
  font-size: 13px;
  text-align: center;
  padding: 16px;
}
</style>
