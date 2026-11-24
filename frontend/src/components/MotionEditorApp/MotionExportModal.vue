<script setup lang="ts">
/**
 * 动作导出模态：选择格式（.mtn / .motion3.json）、名称、fade 时长，
 * 确认后弹出保存对话框选择路径，调用 WriteTextFile 写出。
 */
import { computed, ref, watch } from 'vue'
import { choosePath } from '../../utils/fileDialog'
import { useMotionExportModal, type MotionExportFormat } from '../../composables/useMotionExportModal'
import { useMotionEditorStore } from '../../stores/motionEditor'
import { useMessage } from '../../composables/useMessage'
import { buildMtn, buildMotion3Json } from '../../utils/motionExport'
import { SaveMotionExportFileDialog, WriteTextFile } from '../../../wailsjs/go/main/App'

const { state, close, setFormat } = useMotionExportModal()
const store = useMotionEditorStore()
const msg = useMessage()

const nameText = ref('untitled')
const fadeInText = ref('0')
const fadeOutText = ref('1000')
const minify = ref(false)

watch(
  () => state.visible,
  (v) => {
    if (v) {
      nameText.value = store.lanim.name || 'untitled'
      fadeInText.value = '1000'
      fadeOutText.value = '1000'
      minify.value = false
    }
  },
)

const formats: Array<{ key: MotionExportFormat; label: string; ext: string; hint: string }> = [
  { key: 'motion3', label: '.motion3.json', ext: '.motion3.json', hint: 'Cubism 3+ (moc3)' },
  { key: 'mtn', label: '.mtn', ext: '.mtn', hint: 'Cubism 2 (moc)' },
]

const exportName = computed(() => nameText.value.trim() || 'untitled')
const targetFileName = computed(() => {
  const f = formats.find((x) => x.key === state.format)!
  return `${exportName.value}${f.ext}`
})

/**
 * 可实际产出导出内容的轨道数：普通轨道有 key 即算；
 * 组合器轨道需 def 存在且至少一个有效成员（与 collectExportTracks 的跳过条件对齐）。
 */
const trackCount = computed(() => {
  let n = store.lanim.tracks.filter((tr) => tr.keys.length).length
  for (const c of store.lanim.composers ?? []) {
    if (!c.keys.length) continue
    const def = store.composerDefs[c.id]
    if (!def) continue
    if (!def.resolvedMembers.some((pid) => pid != null)) continue
    n++
  }
  return n
})

const exporting = ref(false)

function parseFade(text: string, label: string): number | null {
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0) {
    msg.warning(`${label}必须是不小于 0 的数字（毫秒）`)
    return null
  }
  return Math.round(n)
}

async function onConfirm() {
  if (exporting.value) return
  if (!trackCount.value) {
    msg.warning('没有可导出的轨道（至少要有一条含关键帧的轨道）')
    return
  }
  const fadeInMs = parseFade(fadeInText.value, '淡入时长')
  if (fadeInMs === null) return
  const fadeOutMs = parseFade(fadeOutText.value, '淡出时长')
  if (fadeOutMs === null) return

  const content =
    state.format === 'mtn'
      ? buildMtn(store.lanim, { fadeInMs, fadeOutMs }, store.composerDefOf)
      : buildMotion3Json(store.lanim, { fadeInMs, fadeOutMs, minify: minify.value }, store.composerDefOf)

  exporting.value = true
  try {
    const picked = await choosePath(() => SaveMotionExportFileDialog(targetFileName.value))
    if (!picked) return
    await WriteTextFile(picked, content)
    close()
    msg.success(`导出成功：${picked}`)
  } catch (err) {
    msg.error(`导出失败：${err}`)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="state.visible" class="mex-mask" @click.self="close">
        <div class="mex-modal" @click.stop>
          <header class="mex-modal__header">
            <h2 class="mex-modal__title">导出动作</h2>
            <button class="mex-icon-btn" aria-label="关闭" @click="close">×</button>
          </header>

          <section class="mex-modal__body">
            <label class="mex-field">
              <span class="mex-field__label">动作名称</span>
              <input v-model="nameText" type="text" class="mex-field__input" @keyup.enter="onConfirm" />
            </label>

            <div class="mex-field">
              <span class="mex-field__label">导出格式</span>
              <div class="mex-format-list">
                <button
                  v-for="f in formats"
                  :key="f.key"
                  type="button"
                  class="mex-format-card"
                  :class="{ 'mex-format-card--active': state.format === f.key }"
                  @click="setFormat(f.key)"
                >
                  <span class="mex-format-card__label">{{ f.label }}</span>
                  <span class="mex-format-card__hint">{{ f.hint }}</span>
                </button>
              </div>
            </div>

            <div class="mex-field">
              <span class="mex-field__label">淡入 (ms)</span>
              <input v-model="fadeInText" type="text" class="mex-field__input" />
            </div>
            <div class="mex-field">
              <span class="mex-field__label">淡出 (ms)</span>
              <input v-model="fadeOutText" type="text" class="mex-field__input" />
            </div>

            <label v-if="state.format === 'motion3'" class="mex-check">
              <input v-model="minify" class="ui-switch" type="checkbox" role="switch" />
              <span>压缩输出（单行）</span>
            </label>

            <div class="mex-preview">
              将导出：<b>{{ targetFileName }}</b>
              <span class="mex-preview__meta">（{{ trackCount }} 条轨道 / {{ store.lanim.durationFrames }} 帧 @{{ store.lanim.fps }}fps）</span>
            </div>
          </section>

          <footer class="mex-modal__footer">
            <button type="button" class="mex-btn" @click="close">取消</button>
            <button type="button" class="mex-btn mex-btn--primary" :disabled="exporting" @click="onConfirm">
              {{ exporting ? '导出中…' : '确认导出' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.mex-mask {
  position: fixed;
  inset: 0;
  background: var(--ui-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.mex-modal {
  background: var(--ui-dialog-fill);
  color: var(--ui-text);
  width: min(440px, 92vw);
  border-radius: var(--ui-radius-panel);
  border: 1px solid var(--ui-line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--ui-panel-shadow);
}

.mex-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-line);
  flex-shrink: 0;
}

.mex-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
  color: var(--ui-text);
}

.mex-icon-btn {
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

.mex-icon-btn:hover {
  background-color: var(--ui-hover);
  color: var(--ui-text);
}

.mex-modal__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mex-field {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mex-field__label {
  width: 80px;
  font-size: 13px;
  color: var(--ui-muted);
  flex-shrink: 0;
}

.mex-field__input {
  flex: 1;
  padding: 6px 10px;
  background: var(--ui-field-fill);
  border: 1px solid var(--ui-edge);
  border-radius: 4px;
  color: var(--ui-text);
  font-size: 13px;
  outline: none;
}

.mex-field__input:focus {
  border-color: var(--ui-link);
}

.mex-format-list {
  display: flex;
  gap: 8px;
  flex: 1;
}

.mex-format-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 6px;
  background: var(--ui-control);
  border: 1px solid var(--ui-line);
  border-radius: 6px;
  color: var(--ui-text);
  cursor: pointer;
}

.mex-format-card:hover {
  border-color: var(--ui-link);
}

.mex-format-card--active {
  background: var(--ui-selected);
  border-color: var(--ui-link);
}

.mex-format-card__label {
  font-size: 13px;
  font-weight: 600;
}

.mex-format-card__hint {
  font-size: 11px;
  color: var(--ui-muted);
}

.mex-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ui-text);
  cursor: pointer;
}

.mex-preview {
  font-size: 13px;
  color: var(--ui-text);
  word-break: break-all;
}

.mex-preview b {
  color: var(--ui-link);
}

.mex-preview__meta {
  font-size: 12px;
  color: var(--ui-muted);
}

.mex-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--ui-line);
}

.mex-btn {
  padding: 6px 16px;
  background: var(--ui-control);
  border: 1px solid var(--ui-edge);
  border-radius: 4px;
  color: var(--ui-text);
  font-size: 13px;
  cursor: pointer;
}

.mex-btn:hover {
  background: var(--ui-hover);
}

.mex-btn--primary {
  background: var(--ui-accent);
  border-color: var(--ui-link);
  color: var(--ui-on-accent);
}

.mex-btn--primary:hover {
  background: var(--ui-accent); color: var(--ui-on-accent);
}

.mex-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
