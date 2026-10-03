<script setup lang="ts">
import { useModelStore } from '../../../stores/previewStore'
import { useBackgroundHistoryModal } from '../../../composables/useBackgroundHistoryModal'

const { state, close } = useBackgroundHistoryModal()
const store = useModelStore()

function bgImageSrc(path: string): string {
  if (/^(https?:|data:)/i.test(path)) return path
  return `/abs_files/${encodeURI(path)}`
}

function bgName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

function onSelect(path: string) {
  store.setBackground(path)
  close()
}

function onRemove(path: string) {
  store.removeBgHistory(path)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="state.visible" class="bg-history-mask" @click.self="close">
        <div class="bg-history-modal" @click.stop>
          <header class="bg-history-modal__header">
            <h2 class="bg-history-modal__title">历史背景</h2>
            <button class="icon-btn" aria-label="关闭" @click="close">×</button>
          </header>

          <section class="bg-history-modal__body">
            <div v-if="store.bgHistory.length" class="history-grid">
              <div
                v-for="path in store.bgHistory"
                :key="path"
                class="history-card"
                :class="{ 'is-current': path === store.backgroundUrl }"
                @click="onSelect(path)"
              >
                <button class="history-card__remove" title="从历史记录中删除" @click.stop="onRemove(path)">×</button>
                <img :src="bgImageSrc(path)" :alt="bgName(path)" class="history-card__thumb" />
                <span class="history-card__name" :title="path">{{ bgName(path) }}</span>
              </div>
            </div>
            <div v-else class="history-empty">暂无历史记录</div>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bg-history-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.bg-history-modal {
  background-color: rgba(29, 32, 38, 0.92);
  color: #e6e6e6;
  width: min(900px, 94vw);
  height: min(640px, 86vh);
  border-radius: 8px;
  border: 1px solid rgba(60, 68, 80, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.bg-history-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  flex-shrink: 0;
}

.bg-history-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
  color: #ffffff;
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

.bg-history-modal__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

/* 横向流式排列，排满自动换行继续 */
.history-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.history-card {
  position: relative;
  width: 256px;
  height: 256px;
  border-radius: 6px;
  overflow: hidden;
  border: 2px solid rgba(60, 68, 80, 0.5);
  cursor: pointer;
  background: rgba(20, 23, 28, 0.6);
  display: flex;
  flex-direction: column;
  transition: border-color 0.12s ease;
}

.history-card:hover {
  border-color: rgba(47, 128, 237, 0.8);
}

.history-card.is-current {
  border-color: #2f80ed;
}

.history-card__thumb {
  flex: 1;
  width: 100%;
  min-height: 0;
  object-fit: contain;
  display: block;
}

.history-card__name {
  flex-shrink: 0;
  height: 26px;
  line-height: 26px;
  padding: 0 8px;
  font-size: 12px;
  color: #e6e6e6;
  background: rgba(20, 23, 28, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-card__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease, background-color 0.12s ease;
  z-index: 1;
}

.history-card:hover .history-card__remove {
  opacity: 1;
}

.history-card__remove:hover {
  background: #b03a3a;
}

.history-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  font-size: 13px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
