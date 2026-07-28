<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PickDirectory } from '../../../wailsjs/go/main/App'
import { useWmdlModelEditorStore, type ScannedEntry } from '../../stores/wmdlModelEditor'
import { pathDirname } from '../../path_utils'
import { useBatchAddModal } from '../../composables/useBatchAddModal'

/**
 * 全屏"批量添加动作/表情"模态。
 *
 * 布局：
 *   - 顶部：文件夹路径输入框 + 右侧"打开文件夹"按钮
 *   - 配置区：路径节点勾选 + 前缀/后缀/拼接符 + 递归扫描开关
 *   - 中部：扫描结果预览列表（每行可勾选，含 name / kind / 相对路径）
 *   - 底部：确定 / 取消
 *
 * 数据流：
 *   - 用户点击"打开文件夹" → PickDirectory → store.scanDirectory(dir, modelDir)
 *   - 扫描到的条目以本组件的 `entries` 形式持有（仅做展示用，不直接进 store）
 *   - 用户点击"确定" → 按当前 kind 调 addMotionsBatch / addExpressionsBatch，
 *     名称经过 buildName 计算（节点 + 拼接符 + 前缀 + 原名 + 后缀）
 */

const store = useWmdlModelEditorStore()
const modal = useBatchAddModal()

const folder = ref<string>('')
const entries = ref<ScannedEntry[]>([])
const selected = ref<Set<string>>(new Set())
const busy = ref(false)
const errorMsg = ref<string>('')

// 命名规则配置
const prefix = ref('')
const suffix = ref('')
const separator = ref('_')
const scanSubfolders = ref(true)

// 路径节点（从选定目录解析）+ 用户勾选集合
const nodes = ref<string[]>([])
const checkedNodes = ref<Set<string>>(new Set())

const kindLabel = computed(() => (modal.state.kind === 'motion' ? '动作' : '表情'))
const modelDir = computed(() => {
  const m = store.selectedModel
  return m?.jsonAbsPath ? pathDirname(m.jsonAbsPath) : ''
})

const filteredEntries = computed(() => entries.value.filter((e) => e.kind === modal.state.kind))

const allFilteredSelected = computed(() => {
  const list = filteredEntries.value
  if (list.length === 0) return false
  return list.every((e) => selected.value.has(e.absPath))
})

function isSelected(absPath: string): boolean {
  return selected.value.has(absPath)
}

function toggleOne(absPath: string) {
  const next = new Set(selected.value)
  if (next.has(absPath)) {
    next.delete(absPath)
  } else {
    next.add(absPath)
  }
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

function toggleNode(node: string) {
  const next = new Set(checkedNodes.value)
  if (next.has(node)) {
    next.delete(node)
  } else {
    next.add(node)
  }
  checkedNodes.value = next
}

/**
 * 把 selected 路径按扫描根目录分割，提取节点列表。
 * 例如 `E:/a/b/c` → `['a', 'b', 'c']`、`/a/b/c` → `['a','b','c']`、
 * `\\server\share\a\b` → `['a','b']`。
 * 相对路径输入也按 `/` 和 `\\` 切分。
 */
function deriveNodesFromFolder(f: string): string[] {
  if (!f) return []
  // 剥掉根（盘符/UNC/POSIX 根）再切分节点，避免把 `E:` 之类当作节点
  const stripped = f
    .replace(/^[A-Za-z]:[\\/]*/, '')
    .replace(/^[\/\\]+/, '')
    .replace(/^\/\/[^\/]+\/[^\/]+\//, '')
  return stripped.split(/[\\/]+/).filter((s) => s.length > 0)
}

function buildName(originalName: string, relPath: string, entrySubFolders: string[]): string {
  // 强制拼部分：entrySubFolders 直接使用
  const forced = entrySubFolders

  // UI 勾选部分：去掉被强制拼已覆盖的，避免重复
  const userPicked = nodes.value.filter(
    (n) => checkedNodes.value.has(n) && !forced.includes(n),
  )

  const baseName = prefix.value + originalName + suffix.value
  return [...userPicked, ...forced, baseName].filter((p) => p !== '').join(separator.value)
}

// 当模态打开 / kind 变化时重置选择集合；切到不同 kind 时清空旧选中。
watch(
  () => [modal.state.visible, modal.state.kind] as const,
  ([visible]) => {
    if (visible) {
      selected.value = new Set()
      filteredEntries.value.forEach((e) => selected.value.add(e.absPath))
    }
    errorMsg.value = ''
  },
)

async function doScan(dir: string) {
  if (!dir || busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    const list = await store.scanDirectory(dir, modelDir.value, scanSubfolders.value)
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

async function onPickFolder() {
  if (busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    const dir = await PickDirectory(modal.state.kind)
    if (!dir) return
    folder.value = dir
    nodes.value = deriveNodesFromFolder(dir)
  } catch (e: any) {
    console.error('pick failed', e)
    errorMsg.value = String(e?.message ?? e)
    busy.value = false
    return
  }
  busy.value = false
  await doScan(folder.value)
}

async function onRescan() {
  await doScan(folder.value)
}

// 切换"递归扫描子文件夹"立即重扫，无需点"重新扫描"
watch(scanSubfolders, () => {
  if (folder.value) doScan(folder.value)
})

function onConfirm() {
  const items = filteredEntries.value
    .filter((e) => selected.value.has(e.absPath))
    .map((e) => ({
      name: buildName(e.name, e.relPath ?? '', e.subFolders ?? []),
      path: e.relPath || e.absPath,
    }))
  if (items.length === 0) {
    modal.close()
    return
  }
  if (modal.state.kind === 'motion') {
    store.addMotionsBatch(items)
  } else {
    store.addExpressionsBatch(items)
  }
  modal.close()
}

function onCancel() {
  modal.close()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modal.state.visible" class="batch-modal-mask" @click.self="onCancel">
        <div class="batch-modal">
          <header class="batch-modal__header">
            <h2 class="batch-modal__title">批量添加{{ kindLabel }}</h2>
            <button class="icon-btn" aria-label="关闭" @click="onCancel">×</button>
          </header>

          <section class="batch-modal__path-row">
            <input
              v-model="folder"
              type="text"
              class="path-input"
              placeholder="选择文件夹路径…"
            />
            <button class="op-btn" :disabled="busy" @click="onPickFolder">打开文件夹</button>
            <button class="op-btn" :disabled="busy || !folder" @click="onRescan">重新扫描</button>
          </section>

          <section v-if="nodes.length" class="batch-modal__config">
            <div class="config-row">
              <span class="config-label">路径节点：</span>
              <label
                v-for="node in nodes"
                :key="node"
                class="node-chip"
                :class="{ 'is-checked': checkedNodes.has(node) }"
              >
                <input
                  type="checkbox"
                  :checked="checkedNodes.has(node)"
                  @change="toggleNode(node)"
                />
                <span>{{ node }}</span>
              </label>
            </div>
            <div class="config-row">
              <label class="config-field">
                <span>前缀</span>
                <input v-model="prefix" type="text" class="mini-input" placeholder="(无)" />
              </label>
              <label class="config-field">
                <span>后缀</span>
                <input v-model="suffix" type="text" class="mini-input" placeholder="(无)" />
              </label>
              <label class="config-field">
                <span>拼接符</span>
                <input
                  v-model="separator"
                  type="text"
                  class="mini-input mini-input--sep"
                  maxlength="1"
                />
              </label>
              <label class="config-field config-field--inline">
                <input v-model="scanSubfolders" type="checkbox" />
                <span>递归扫描子文件夹</span>
              </label>
            </div>
          </section>

          <section class="batch-modal__body">
            <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
            <div v-if="filteredEntries.length === 0" class="empty-hint">
              {{ folder ? '未找到可添加的' + kindLabel + '文件' : '请选择文件夹' }}
            </div>
            <div v-else class="list-toolbar-row">
              <label class="select-all">
                <input
                  type="checkbox"
                  :checked="allFilteredSelected"
                  @change="toggleAllFiltered"
                />
                <span>全选（{{ filteredEntries.length }} 项）</span>
              </label>
            </div>
            <ul v-if="filteredEntries.length" class="entry-list">
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
                  <div class="entry-row__name">
                    {{ buildName(entry.name, entry.relPath ?? '', entry.subFolders ?? []) }}
                  </div>
                  <div class="entry-row__path" :title="entry.absPath">
                    {{ entry.relPath || entry.absPath }}
                  </div>
                </div>
              </li>
            </ul>
          </section>

          <footer class="batch-modal__footer">
            <button class="op-btn" @click="onCancel">取消</button>
            <button
              class="op-btn op-btn--primary"
              :disabled="filteredEntries.filter((e) => selected.has(e.absPath)).length === 0"
              @click="onConfirm"
            >
              确定
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

.config-label {
  font-size: 12px;
  color: #8a93a3;
  margin-right: 4px;
}

.node-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: #14171c;
  border: 1px solid #2c313a;
  border-radius: 12px;
  font-size: 12px;
  color: #c0c5cd;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.node-chip:hover {
  border-color: #3a4250;
}

.node-chip.is-checked {
  background: #1f3a5f;
  border-color: #2f80ed;
  color: #e6e6e6;
}

.node-chip input {
  margin: 0;
  cursor: pointer;
}

.config-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #c0c5cd;
}

.config-field--inline {
  margin-left: auto;
  cursor: pointer;
  user-select: none;
}

.mini-input {
  width: 90px;
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

.mini-input--sep {
  width: 36px;
  text-align: center;
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