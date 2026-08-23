<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PickMotionFile,
  PickExpressionFile,
  PickDirectory,
} from '../../../../wailsjs/go/main/App'
import { useWmdlModelEditorStore, type ScannedEntry } from '../../../stores/wmdlModelEditor'
import { useBatchModifyModal } from '../../../composables/useBatchModifyModal'
import { useMessage } from '../../../composables/useMessage'
import {
  modifyMtnFiles,
  modifyExpFiles,
  type CalcKind,
} from '../../../utils/mtnExpMdf'

type Mode = 'file' | 'folder'
type Action = 'set' | 'remove' | 'applyCalcOne' | 'applyCalcAll'

/**
 * 全屏"批量修改动作/表情"模态。
 *
 * 两种选择模式：
 *   - file: 选 1 个 .mtn / .exp.json，写回原文件；
 *   - folder: 选目录，扫描所有 .mtn / .exp.json，用户勾选 → 批量写回。
 *
 * 表单：
 *   - 动作 (motion)：
 *       action = set | remove
 *       字段：参数名、参数值
 *   - 表情 (expression)：
 *       action = set | remove | applyCalcOne | applyCalcAll
 *       字段：参数名、参数值、calc 枚举
 *
 * 写入策略：
 *   - 每个文件独立 try/catch；
 *   - 全部跑完后用 useMessage 弹「批量修改完成：成功 N 个，失败 M 个」，
 *     失败文件列表写入 console.error。
 */

const store = useWmdlModelEditorStore()
const modal = useBatchModifyModal()
const msg = useMessage()

const mode = ref<Mode>('file')
const filePath = ref<string>('')
const folder = ref<string>('')
const entries = ref<ScannedEntry[]>([])
const selected = ref<Set<string>>(new Set())
const busy = ref(false)
const errorMsg = ref<string>('')
const scanSubfolders = ref(true)

const paramName = ref<string>('')
const paramValue = ref<number>(0)
const calc = ref<CalcKind>('none')
const action = ref<Action>('set')

const kindLabel = computed(() => (modal.state.kind === 'motion' ? '动作' : '表情'))

const filteredEntries = computed(() => entries.value.filter((e) => e.kind === modal.state.kind))

const allFilteredSelected = computed(() => {
  const list = filteredEntries.value
  if (list.length === 0) return false
  return list.every((e) => selected.value.has(e.absPath))
})

const candidateCount = computed(() => filteredEntries.value.length)
const selectedCount = computed(() => filteredEntries.value.filter((e) => selected.value.has(e.absPath)).length)

const isExpression = computed(() => modal.state.kind === 'expression')

// 字段按 action 显隐：
//   - 动作 (motion)：总是显示参数名 + 参数值
//   - 表情 (expression)：
//       set            → 参数名 + 参数值 + calc
//       remove         → 仅参数名
//       applyCalcOne   → 参数名 + calc
//       applyCalcAll   → 仅 calc
const showParamName = computed(() => {
  if (modal.state.kind === 'motion') return true
  return action.value !== 'applyCalcAll'
})

const showParamValue = computed(() => {
  if (modal.state.kind === 'motion') return true
  return action.value === 'set'
})

const showCalc = computed(() => {
  if (modal.state.kind !== 'expression') return false
  return action.value !== 'remove'
})

const confirmDisabled = computed(() => {
  if (busy.value) return true
  if (showParamName.value && !paramName.value.trim()) return true
  if (mode.value === 'file') return !filePath.value
  return selectedCount.value === 0
})

function isSelected(absPath: string): boolean {
  return selected.value.has(absPath)
}

function toggleOne(absPath: string) {
  const next = new Set(selected.value)
  if (next.has(absPath)) next.delete(absPath)
  else next.add(absPath)
  selected.value = next
}

function toggleAllFiltered() {
  const list = filteredEntries.value
  const next = new Set(selected.value)
  if (allFilteredSelected.value) {
    for (const e of list) next.delete(e.absPath)
  } else {
    for (const e of list) next.add(e.absPath)
  }
  selected.value = next
}

watch(
  () => [modal.state.visible, modal.state.kind] as const,
  ([visible]) => {
    if (visible) {
      mode.value = 'file'
      filePath.value = ''
      folder.value = ''
      entries.value = []
      selected.value = new Set()
      paramName.value = ''
      paramValue.value = 0
      calc.value = 'none'
      action.value = 'set'
      errorMsg.value = ''
      scanSubfolders.value = true
    }
  },
)

async function pickSingleFile() {
  if (busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    const picked =
      modal.state.kind === 'motion' ? await PickMotionFile() : await PickExpressionFile()
    if (!picked) return
    filePath.value = picked
  } catch (e: any) {
    console.error('pick file failed', e)
    errorMsg.value = String(e?.message ?? e)
  } finally {
    busy.value = false
  }
}

async function pickFolder() {
  if (busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    const dir = await PickDirectory(modal.state.kind)
    if (!dir) return
    folder.value = dir
  } catch (e: any) {
    console.error('pick folder failed', e)
    errorMsg.value = String(e?.message ?? e)
    busy.value = false
    return
  }
  busy.value = false
  await doScan(folder.value)
}

async function doScan(dir: string) {
  if (!dir || busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    const list = await store.scanDirectory(dir, '', scanSubfolders.value)
    entries.value = list
    selected.value = new Set(
      list.filter((e) => e.kind === modal.state.kind).map((e) => e.absPath),
    )
  } catch (e: any) {
    console.error('scan failed', e)
    errorMsg.value = String(e?.message ?? e)
  } finally {
    busy.value = false
  }
}

async function onRescan() {
  await doScan(folder.value)
}

watch(scanSubfolders, () => {
  if (folder.value && mode.value === 'folder') doScan(folder.value)
})

watch(mode, (m) => {
  errorMsg.value = ''
  if (m === 'file') {
    entries.value = []
    selected.value = new Set()
  } else {
    filePath.value = ''
  }
})

async function onConfirm() {
  if (confirmDisabled.value) return
  const name = paramName.value.trim()
  const value = Number(paramValue.value)

  busy.value = true
  errorMsg.value = ''
  try {
    if (modal.state.kind === 'motion') {
      const paths =
        mode.value === 'file'
          ? [filePath.value]
          : filteredEntries.value.filter((e) => selected.value.has(e.absPath)).map((e) => e.absPath)
      if (paths.length === 0) {
        busy.value = false
        return
      }
      const res = await modifyMtnFiles(paths, {
        paramName: name,
        paramValue: value,
        action: action.value as 'set' | 'remove',
      })
      finishWithResult(res)
    } else {
      const paths =
        mode.value === 'file'
          ? [filePath.value]
          : filteredEntries.value.filter((e) => selected.value.has(e.absPath)).map((e) => e.absPath)
      if (paths.length === 0) {
        busy.value = false
        return
      }
      const res = await modifyExpFiles(paths, {
        calc: calc.value,
        paramName: name,
        paramValue: value,
        action: action.value,
      })
      finishWithResult(res)
    }
  } finally {
    busy.value = false
  }
}

function finishWithResult(res: { ok: number; failed: { path: string; error: string }[] }) {
  if (res.failed.length > 0) {
    console.error('batch modify failed files:', res.failed)
  }
  msg.success(`批量修改完成：成功 ${res.ok} 个，失败 ${res.failed.length} 个`)
  // 保持模态打开，便于用户连续微调后再次应用。
}

function onClose() {
  modal.close()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modal.state.visible" class="batch-modal-mask" @click.self="onClose">
        <div class="batch-modal">
          <header class="batch-modal__header">
            <h2 class="batch-modal__title">批量修改{{ kindLabel }}</h2>
            <button class="icon-btn" aria-label="关闭" @click="onClose">×</button>
          </header>

          <section class="batch-modal__path-row">
            <div class="mode-toggle">
              <button
                class="mode-btn"
                :class="{ 'is-active': mode === 'file' }"
                @click="mode = 'file'"
              >
                选择单个文件
              </button>
              <button
                class="mode-btn"
                :class="{ 'is-active': mode === 'folder' }"
                @click="mode = 'folder'"
              >
                选择文件夹
              </button>
            </div>
          </section>

          <section class="batch-modal__path-row">
            <template v-if="mode === 'file'">
              <input
                v-model="filePath"
                type="text"
                class="path-input"
                placeholder="选择单个 .mtn / .exp.json 文件路径…"
              />
              <button class="op-btn" :disabled="busy" @click="pickSingleFile">选择文件</button>
            </template>
            <template v-else>
              <input
                v-model="folder"
                type="text"
                class="path-input"
                placeholder="选择文件夹路径…"
              />
              <button class="op-btn" :disabled="busy" @click="pickFolder">打开文件夹</button>
              <button class="op-btn" :disabled="busy || !folder" @click="onRescan">重新扫描</button>
              <label class="config-field config-field--inline">
                <input v-model="scanSubfolders" type="checkbox" />
                <span>递归扫描子文件夹</span>
              </label>
            </template>
          </section>

          <section class="batch-modal__config">
            <div class="config-row">
              <label v-if="showParamName" class="config-field">
                <span>参数名</span>
                <input
                  v-model="paramName"
                  type="text"
                  class="mini-input"
                  placeholder="如 PARAM_ANGLE_X"
                />
              </label>
              <label v-if="showParamValue" class="config-field">
                <span>参数值</span>
                <input
                  v-model.number="paramValue"
                  type="number"
                  step="0.01"
                  class="mini-input"
                />
              </label>
              <label v-if="showCalc" class="config-field">
                <span>calc</span>
                <select v-model="calc" class="mini-input">
                  <option value="none">无</option>
                  <option value="add">add</option>
                  <option value="mult">mult</option>
                  <option value="set">set</option>
                </select>
              </label>
              <label class="config-field">
                <span>动作</span>
                <select v-model="action" class="mini-input">
                  <option value="set">设定</option>
                  <option value="remove">移除</option>
                  <option v-if="isExpression" value="applyCalcOne">应用 calc 到当前参数</option>
                  <option v-if="isExpression" value="applyCalcAll">应用 calc 到所有参数</option>
                </select>
              </label>
            </div>
          </section>

          <section class="batch-modal__body">
            <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
            <template v-if="mode === 'folder'">
              <div v-if="candidateCount === 0" class="empty-hint">
                {{ folder ? '未找到可修改的' + kindLabel + '文件' : '请选择文件夹' }}
              </div>
              <div v-else class="list-toolbar-row">
                <label class="select-all">
                  <input
                    type="checkbox"
                    :checked="allFilteredSelected"
                    @change="toggleAllFiltered"
                  />
                  <span>全选（{{ candidateCount }} 项） · 已选 {{ selectedCount }}</span>
                </label>
              </div>
              <ul v-if="candidateCount" class="entry-list">
                <li
                  v-for="entry in filteredEntries"
                  :key="entry.absPath"
                  class="entry-row"
                  :class="{ 'is-selected': isSelected(entry.absPath) }"
                  @click="toggleOne(entry.absPath)"
                >
                  <input
                    type="checkbox"
                    :checked="isSelected(entry.absPath)"
                    @click.stop="toggleOne(entry.absPath)"
                  />
                  <div class="entry-row__main">
                    <div class="entry-row__name">{{ entry.name }}</div>
                    <div class="entry-row__path" :title="entry.absPath">
                      {{ entry.relPath || entry.absPath }}
                    </div>
                  </div>
                </li>
              </ul>
            </template>
            <template v-else>
              <div v-if="!filePath" class="empty-hint">请选择单个 {{ kindLabel }} 文件</div>
              <div v-else class="single-file-hint">
                将修改并写回：
                <span class="single-file-hint__path" :title="filePath">{{ filePath }}</span>
              </div>
            </template>
          </section>

          <footer class="batch-modal__footer">
            <button class="op-btn" @click="onClose">关闭</button>
            <button
              class="op-btn op-btn--primary"
              :disabled="confirmDisabled"
              @click="onConfirm"
            >
              应用
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.batch-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.batch-modal {
  background: #1d2026;
  color: #e6e6e6;
  width: min(720px, 90vw);
  height: min(640px, 90vh);
  border-radius: 8px;
  border: 1px solid #2c313a;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
}

.batch-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #2c313a;
  flex-shrink: 0;
}

.batch-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
}

.icon-btn {
  background: transparent;
  border: none;
  color: #8a93a3;
  font-size: 22px;
  line-height: 1;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.icon-btn:hover {
  background: #353c47;
  color: #e6e6e6;
}

.batch-modal__path-row {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #2c313a;
  flex-shrink: 0;
  align-items: center;
}

.mode-toggle {
  display: inline-flex;
  background: #14171c;
  border: 1px solid #2c313a;
  border-radius: 4px;
  overflow: hidden;
}

.mode-btn {
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: #c0c5cd;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.mode-btn:hover {
  background: #2a2f37;
}

.mode-btn.is-active {
  background: #2f80ed;
  color: #fff;
}

.path-input {
  flex: 1;
  padding: 8px 10px;
  background: #14171c;
  border: 1px solid #2c313a;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.path-input:focus {
  outline: none;
  border-color: #2f80ed;
}

.batch-modal__config {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #2c313a;
  flex-shrink: 0;
}

.config-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.config-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #c0c5cd;
}

.config-field--inline {
  cursor: pointer;
  user-select: none;
}

.mini-input {
  width: 120px;
  padding: 4px 8px;
  background: #14171c;
  border: 1px solid #2c313a;
  border-radius: 4px;
  color: #e6e6e6;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.mini-input:focus {
  outline: none;
  border-color: #2f80ed;
}

select.mini-input {
  font-family: inherit;
}

.batch-modal__body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.batch-modal__body .list-toolbar-row {
  padding: 8px 16px;
  border-bottom: 1px solid #2c313a;
  flex-shrink: 0;
}

.select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #c0c5cd;
  cursor: pointer;
  user-select: none;
}

.entry-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
}

.entry-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.entry-row:hover {
  background: #262b34;
}

.entry-row.is-selected {
  background: #2a3140;
}

.entry-row__main {
  flex: 1;
  min-width: 0;
}

.entry-row__name {
  font-size: 13px;
  color: #e6e6e6;
}

.entry-row__path {
  font-size: 11px;
  color: #8a93a3;
  font-family: ui-monospace, SFMono-Regular, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.single-file-hint {
  margin: auto;
  padding: 24px;
  color: #c0c5cd;
  font-size: 13px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.single-file-hint__path {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: #8a93a3;
  word-break: break-all;
}

.batch-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #2c313a;
  flex-shrink: 0;
}

.op-btn {
  padding: 8px 14px;
  background: #2c313a;
  color: #e6e6e6;
  border: 1px solid #2c313a;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.12s ease;
}

.op-btn:hover:not(:disabled) {
  background: #353c47;
}

.op-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.op-btn--primary {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #fff;
}

.op-btn--primary:hover:not(:disabled) {
  background: #3f90ff;
}

.empty-hint {
  margin: auto;
  padding: 24px;
  color: #6b7280;
  font-size: 13px;
  text-align: center;
}

.error-msg {
  margin: 8px 16px;
  padding: 8px 12px;
  background: #4a1f1f;
  border: 1px solid #b03a3a;
  border-radius: 4px;
  color: #f3c4c4;
  font-size: 12px;
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
