<script setup lang="ts">
/**
 * 帧率 / 时长设置模态。
 *
 * fps 与总时长（帧）编辑，实时预览换算时间。
 * 点「应用」时若新时长会截断已有超出范围的关键帧，
 * 弹二次确认提示丢失数量，确认后才真正写入 store。
 */
import { ref, watch } from 'vue'
import { useFrameSettingsModal } from '../../composables/useFrameSettingsModal'
import { useMotionEditorStore } from '../../stores/motionEditor'
import { useMessage } from '../../composables/useMessage'

const { state, close } = useFrameSettingsModal()
const store = useMotionEditorStore()
const msg = useMessage()

const fpsText = ref('60')
const durationText = ref('180')

watch(
  () => state.visible,
  (v) => {
    if (v) {
      fpsText.value = String(store.lanim.fps)
      durationText.value = String(store.lanim.durationFrames)
      refreshPreview()
    }
  },
)

const fpsNum = ref(0)
const durationNum = ref(0)

function parseInputs(): boolean {
  const fps = Number(fpsText.value)
  const dur = Number(durationText.value)
  if (!Number.isFinite(fps) || fps < 1 || Math.round(fps) !== fps) {
    msg.warning('帧率必须是不小于 1 的整数')
    return false
  }
  if (!Number.isFinite(dur) || dur < 1 || Math.round(dur) !== dur) {
    msg.warning('时长（帧）必须是不小于 1 的整数')
    return false
  }
  fpsNum.value = fps
  durationNum.value = dur
  return true
}

const previewTime = ref('')

function refreshPreview() {
  const fps = Number(fpsText.value)
  const dur = Number(durationText.value)
  if (Number.isFinite(fps) && fps > 0 && Number.isFinite(dur) && dur >= 0) {
    previewTime.value = (dur / fps).toFixed(2)
  } else {
    previewTime.value = '--'
  }
}

function onApply() {
  if (!parseInputs()) return
  // 预检截断数量：临时统计超出新时长的关键帧
  const lost = store.lanim.tracks.reduce(
    (acc, tr) => acc + tr.keys.filter((k) => k.frame > durationNum.value).length,
    0,
  )
  const doApply = () => {
    const removed = store.applyFrameSettings(fpsNum.value, durationNum.value)
    close()
    if (removed > 0) {
      msg.warning(`已应用：帧率 ${fpsNum.value}fps，时长 ${durationNum.value} 帧（截断了 ${removed} 个关键帧）`)
    } else {
      msg.success(`已应用：帧率 ${fpsNum.value}fps，时长 ${durationNum.value} 帧`)
    }
  }
  if (lost > 0) {
    if (window.confirm(`新时长 ${durationNum.value} 帧将丢失 ${lost} 个超出范围的关键帧，确认应用？`)) {
      doApply()
    }
  } else {
    doApply()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="state.visible" class="frame-mask" @click.self="close">
        <div class="frame-modal" @click.stop>
          <header class="frame-modal__header">
            <h2 class="frame-modal__title">帧率与时长设置</h2>
            <button class="icon-btn" aria-label="关闭" @click="close">×</button>
          </header>

          <section class="frame-modal__body">
            <label class="frame-field">
              <span class="frame-field__label">帧率 (fps)</span>
              <input v-model="fpsText" type="text" class="frame-field__input" @input="refreshPreview" @keyup.enter="onApply" />
            </label>
            <label class="frame-field">
              <span class="frame-field__label">时长 (帧)</span>
              <input v-model="durationText" type="text" class="frame-field__input" @input="refreshPreview" @keyup.enter="onApply" />
            </label>
            <div class="frame-preview">
              对应时长：<b>{{ previewTime }}</b> 秒
            </div>
            <p class="frame-risk">
              注意：缩短时长会截断超出范围的关键帧，且无法恢复；帧率变更不影响已有帧号。
            </p>
          </section>

          <footer class="frame-modal__footer">
            <button type="button" class="ui-button frame-btn" @click="close">取消</button>
            <button type="button" class="ui-button ui-button--primary frame-btn" @click="onApply">应用</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.frame-mask {
  position: fixed;
  inset: 0;
  background: var(--ui-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.frame-modal {
  background-color: var(--ui-dialog);
  color: var(--ui-text);
  width: min(420px, 92vw);
  border-radius: var(--ui-radius-panel);
  border: 1px solid var(--ui-line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--ui-panel-shadow);
}

.frame-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-line);
  flex-shrink: 0;
}

.frame-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
  color: var(--ui-text);
}

.icon-btn {
  background-color: transparent;
  border: none;
  color: var(--ui-text);
  font-size: 22px;
  line-height: 1;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
}

.icon-btn:hover {
  background-color: var(--ui-hover);
  color: var(--ui-text);
}

.frame-modal__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.frame-field {
  display: flex;
  align-items: center;
  gap: 10px;
}

.frame-field__label {
  width: 80px;
  font-size: 13px;
  color: var(--ui-muted);
  flex-shrink: 0;
}

.frame-field__input {
  flex: 1;
  padding: 6px 10px;
  background: var(--ui-panel);
  border: 1px solid var(--ui-edge);
  border-radius: var(--ui-radius-compact);
  color: var(--ui-text);
  font-size: 13px;
}

.frame-field__input:focus {
  border-color: var(--ui-link);
}

.frame-preview {
  font-size: 13px;
  color: var(--ui-text);
}

.frame-preview b {
  color: var(--ui-link);
}

.frame-risk {
  margin: 0;
  font-size: 12px;
  color: var(--ui-warning);
}

.frame-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--ui-line);
}

.frame-btn {
  padding: 6px 16px;
  font-size: 13px;
}
</style>
