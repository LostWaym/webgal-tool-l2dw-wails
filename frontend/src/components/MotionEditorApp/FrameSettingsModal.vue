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
            <button type="button" class="frame-btn" @click="close">取消</button>
            <button type="button" class="frame-btn frame-btn--primary" @click="onApply">应用</button>
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
  background: rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.frame-modal {
  background-color: rgba(29, 32, 38, 0.96);
  color: #e6e6e6;
  width: min(420px, 92vw);
  border-radius: 8px;
  border: 1px solid rgba(60, 68, 80, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.frame-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  flex-shrink: 0;
}

.frame-modal__title {
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
}

.icon-btn:hover {
  background-color: rgba(53, 60, 71, 0.42);
  color: #ffffff;
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
  color: #8a93a3;
  flex-shrink: 0;
}

.frame-field__input {
  flex: 1;
  padding: 6px 10px;
  background: #1e222a;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 13px;
  outline: none;
}

.frame-field__input:focus {
  border-color: #2f80ed;
}

.frame-preview {
  font-size: 13px;
  color: #cfd4dc;
}

.frame-preview b {
  color: #5fa8ff;
}

.frame-risk {
  margin: 0;
  font-size: 12px;
  color: #f0a050;
}

.frame-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(60, 68, 80, 0.35);
}

.frame-btn {
  padding: 6px 16px;
  background: #2c313a;
  border: 1px solid #3a4150;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 13px;
  cursor: pointer;
}

.frame-btn:hover {
  background: #343b49;
}

.frame-btn--primary {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #ffffff;
}

.frame-btn--primary:hover {
  background: #1a5bb8;
}
</style>
