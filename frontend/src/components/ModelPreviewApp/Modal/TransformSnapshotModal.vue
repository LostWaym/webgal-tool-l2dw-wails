<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isSpecialId, getSpecialName } from '../../../live2d/specialIds'
import { useModelStore } from '../../../stores/previewStore'
import type { TransformSnapshot } from '../../../stores/previewStore'
import { useTransformSnapshotModal } from '../../../composables/useTransformSnapshotModal'
import { useMessage } from '../../../composables/useMessage'

/**
 * 变换快照模态。
 *
 * 状态/打开方式：
 * - 通过 reactive 单例 `state` 控制可见性
 * - 入口处调用 open() 缓存当前选中模型的变换
 * - 用户点击遮罩外部 → close() 还原变换并清除缓存
 * - 列表项 hover：实时预览快照的变换到模型
 * - 列表项 mouseleave：恢复缓存的变换
 * - 点击"应用"：应用快照后关闭模态
 * - 点击"删除"：移除该快照
 * - 标题点击可编辑快照名
 *
 * 主场景 / 背景同样视为可变换对象（store 已统一处理 SpecialId）。
 */

const { state, close } = useTransformSnapshotModal()
const store = useModelStore()
const msg = useMessage()

// 列表项展示辅助：保留最多 3 位小数（去掉无意义的尾零）
function fmt3(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const s = n.toFixed(3)
  return Number(s).toString()
}

const editingId = ref<string | null>(null)
const editingName = ref('')

function startEdit(snap: TransformSnapshot) {
  editingId.value = snap.id
  editingName.value = snap.name
}

function commitEdit() {
  if (editingId.value) {
    store.renameTransformSnapshot(editingId.value, editingName.value.trim() || '未命名')
  }
  editingId.value = null
}

function cancelEdit() {
  editingId.value = null
  editingName.value = ''
}

// 当前选中项的展示名（用于模态顶部）
const selectedName = computed(() => {
  const id = store.selectedId
  if (!id) return ''
  if (isSpecialId(id)) return getSpecialName(id as any)
  return store.selectedModel?.name ?? ''
})

// 打开时缓存当前变换
watch(
  () => state.visible,
  (visible) => {
    if (visible) {
      store.setCachedTransform()
    }
  },
)

function onMaskClick() {
  // 关闭时恢复缓存的变换，避免用户中途预览后留下残值
  store.restoreCachedTransform()
  store.clearCachedTransform()
  close()
}

function onCardEnter(snap: TransformSnapshot) {
  store.applyTransformSnapshotRaw(snap)
}

function onCardLeave() {
  store.restoreCachedTransform()
}

function onApply(snap: TransformSnapshot) {
  store.applyTransformSnapshot(snap.id)
  store.clearCachedTransform()
  close()
}

function onDelete(id: string) {
  store.deleteTransformSnapshot(id)
}

function onEditKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    commitEdit()
  } else if (e.key === 'Escape') {
    cancelEdit()
  }
}

async function onSave() {
  try {
    const ok = await store.exportTransformSnapshots()
    if (ok) msg.success('变换快照已保存')
  } catch (err) {
    msg.error(`保存失败：${err}`)
  }
}

async function onLoad() {
  try {
    const count = await store.importTransformSnapshots()
    if (count > 0) msg.success(`已导入 ${count} 个快照`)
  } catch (err) {
    msg.error(`读取失败：${err}`)
  }
}

function onClearAll() {
  if (store.transformSnapshots.length === 0) return
  if (!window.confirm('确定清空当前所有的变换快照？')) return
  store.clearTransformSnapshots()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="state.visible" class="snapshot-mask" @click.self="onMaskClick">
        <div class="snapshot-modal" @click.stop>
          <header class="snapshot-modal__header">
            <h2 class="snapshot-modal__title">
              变换快照
              <span class="snapshot-modal__subtitle" v-if="selectedName" :title="selectedName">（{{ selectedName }}）</span>
            </h2>
            <div class="snapshot-modal__toolbar">
              <button class="toolbar-btn" @click="onSave">保存</button>
              <button class="toolbar-btn" @click="onLoad">读取</button>
              <button
                class="toolbar-btn toolbar-btn--danger"
                :disabled="store.transformSnapshots.length === 0"
                @click="onClearAll"
              >清空</button>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="onMaskClick">×</button>
          </header>

          <section class="snapshot-modal__body">
            <div v-if="store.transformSnapshots.length === 0" class="snapshot-empty">
              暂无快照，先在变换区点击"记录变换快照"
            </div>
            <div v-else class="snapshot-grid">
              <div
                v-for="snap in store.transformSnapshots"
                :key="snap.id"
                class="snapshot-card"
                @mouseenter="onCardEnter(snap)"
                @mouseleave="onCardLeave"
              >
                <div class="snapshot-card__title-row">
                  <input
                    v-if="editingId === snap.id"
                    v-model="editingName"
                    class="snapshot-card__name-input"
                    type="text"
                    autofocus
                    @blur="commitEdit"
                    @keydown="onEditKey"
                    @click.stop
                  />
                  <span
                    v-else
                    class="snapshot-card__name"
                    :title="snap.name"
                    @click.stop="startEdit(snap)"
                  >{{ snap.name }}</span>
                </div>
                <div class="snapshot-card__info">
                  pos={{ fmt3(snap.x) }}, {{ fmt3(snap.y) }}
                  &nbsp;scale={{ fmt3(snap.scale.x) }}, {{ fmt3(snap.scale.y) }}
                  &nbsp;rot={{ fmt3(snap.rotation) }}°
                </div>
                <div class="snapshot-card__actions">
                  <button class="card-btn card-btn--primary" @click.stop="onApply(snap)">应用</button>
                  <button class="card-btn card-btn--danger" @click.stop="onDelete(snap.id)">删除</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/**
 * 视觉规则：
 * - 模态整体半透明，方便预览背后的舞台
 * - 文字保持完全不透明（color 不透明 + 不被父级 alpha 影响）
 *   实现：所有容器用 rgba 背景 + 不继承 opacity；
 *   模态自身用 rgba 背景而不设 opacity，避免子元素颜色一并变淡。
 */
.snapshot-mask {
  position: fixed;
  inset: 0;
  background: var(--ui-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.snapshot-modal {
  /* 半透明面板，但内部文字不受影响 */
  background-color: color-mix(in srgb, var(--ui-panel) 72%, transparent);
  color: var(--ui-text);
  width: min(720px, 92vw);
  max-height: 80vh;
  border-radius: var(--ui-radius-panel);
  border: 1px solid var(--ui-line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--ui-panel-shadow);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.snapshot-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-line);
  flex-shrink: 0;
}

.snapshot-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 文字完全不透明（覆盖父级 rgba 背景的视觉效果） */
  color: var(--ui-text);
}

.snapshot-modal__subtitle {
  font-size: 13px;
  font-weight: 400;
  color: var(--ui-muted);
  margin-left: 4px;
}

.snapshot-modal__toolbar {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  margin-right: 10px;
}

.toolbar-btn {
  padding: 4px 12px;
  background-color: var(--ui-control);
  border: 1px solid var(--ui-edge);
  border-radius: 4px;
  color: var(--ui-text);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.toolbar-btn:hover {
  background-color: var(--ui-hover);
}

.toolbar-btn--danger {
  border-color: var(--ui-danger);
  color: var(--ui-danger);
}

.toolbar-btn--danger:hover {
  background-color: var(--ui-panel-tint-danger);
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon-btn {
  flex-shrink: 0;
  background-color: transparent;
  border: none;
  color: var(--ui-text);
  font-size: 22px;
  line-height: 1;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.icon-btn:hover {
  background-color: var(--ui-hover);
  color: var(--ui-text);
}

.snapshot-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.snapshot-empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--ui-text);
  font-size: 13px;
}

.snapshot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.snapshot-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  /* 卡片背景半透明（rgba），但文字颜色保持完全不透明 */
  background-color: color-mix(in srgb, var(--ui-control) 75%, transparent);
  border: 1px solid var(--ui-line);
  border-radius: 6px;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.snapshot-card:hover {
  border-color: var(--ui-link);
  background-color: var(--ui-hover);
}

.snapshot-card__title-row {
  display: flex;
  align-items: center;
  min-height: 24px;
}

.snapshot-card__name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--ui-text);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 2px 4px;
  border-radius: 4px;
}

.snapshot-card__name:hover {
  background-color: var(--ui-hover);
}

.snapshot-card__name-input {
  flex: 1;
  padding: 2px 6px;
  background-color: var(--ui-well);
  border: 1px solid var(--ui-link);
  border-radius: 4px;
  color: var(--ui-text);
  font-size: 13px;
  outline: none;
}

.snapshot-card__info {
  font-size: 11px;
  color: var(--ui-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  /* 单行显示 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.snapshot-card__actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.card-btn {
  flex: 1;
  padding: 5px 10px;
  background-color: var(--ui-control);
  border: 1px solid var(--ui-edge);
  border-radius: 4px;
  color: var(--ui-text);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.card-btn:hover {
  background-color: var(--ui-hover);
}

.card-btn--primary {
  background-color: var(--ui-accent);
  border-color: var(--ui-link);
  color: var(--ui-on-accent);
}

.card-btn--primary:hover {
  background-color: var(--ui-accent-hover); color: var(--ui-on-accent);
}

.card-btn--danger {
  background-color: transparent;
  border-color: var(--ui-danger);
  color: var(--ui-danger);
}

.card-btn--danger:hover {
  background-color: var(--ui-panel-tint-danger);
  border-color: var(--ui-danger);
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
