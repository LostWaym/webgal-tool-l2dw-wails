<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isSpecialId, getSpecialName } from '../live2d/specialIds'
import { useModelStore } from '../stores/models'
import type { TransformSnapshot } from '../stores/models'
import { useTransformSnapshotModal } from '../composables/useTransformSnapshotModal'

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
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="state.visible" class="snapshot-mask" @click.self="onMaskClick">
        <div class="snapshot-modal" @click.stop>
          <header class="snapshot-modal__header">
            <h2 class="snapshot-modal__title">
              变换快照
              <span class="snapshot-modal__subtitle" v-if="selectedName">（{{ selectedName }}）</span>
            </h2>
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
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.snapshot-modal {
  /* 半透明面板，但内部文字不受影响 */
  background-color: rgba(29, 32, 38, 0.36);
  color: #e6e6e6;
  width: min(720px, 92vw);
  max-height: 80vh;
  border-radius: 8px;
  border: 1px solid rgba(60, 68, 80, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.snapshot-modal__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(60, 68, 80, 0.35);
  flex-shrink: 0;
}

.snapshot-modal__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
  /* 文字完全不透明（覆盖父级 rgba 背景的视觉效果） */
  color: #ffffff;
}

.snapshot-modal__subtitle {
  font-size: 13px;
  font-weight: 400;
  color: #b0b8c4;
  margin-left: 4px;
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

.snapshot-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.snapshot-empty {
  padding: 48px 16px;
  text-align: center;
  color: #c8ceda;
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
  background-color: rgba(35, 40, 48, 0.35);
  border: 1px solid rgba(60, 68, 80, 0.35);
  border-radius: 6px;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.snapshot-card:hover {
  border-color: rgba(47, 128, 237, 0.45);
  background-color: rgba(38, 43, 52, 0.39);
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
  color: #ffffff;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 2px 4px;
  border-radius: 4px;
}

.snapshot-card__name:hover {
  background-color: rgba(60, 68, 80, 0.35);
}

.snapshot-card__name-input {
  flex: 1;
  padding: 2px 6px;
  background-color: rgba(20, 23, 28, 0.42);
  border: 1px solid rgba(47, 128, 237, 0.45);
  border-radius: 4px;
  color: #ffffff;
  font-size: 13px;
  outline: none;
}

.snapshot-card__info {
  font-size: 11px;
  color: #c8ceda;
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
  background-color: rgba(44, 49, 58, 0.7);
  border: 1px solid rgba(60, 68, 80, 0.7);
  border-radius: 4px;
  color: #ffffff;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.card-btn:hover {
  background-color: rgba(53, 60, 71, 0.9);
}

.card-btn--primary {
  background-color: rgba(47, 128, 237, 0.85);
  border-color: rgba(47, 128, 237, 0.85);
  color: #ffffff;
}

.card-btn--primary:hover {
  background-color: rgba(63, 144, 255, 0.95);
}

.card-btn--danger {
  background-color: transparent;
  border-color: rgba(90, 48, 48, 0.8);
  color: #ffd9d9;
}

.card-btn--danger:hover {
  background-color: rgba(74, 31, 31, 0.85);
  border-color: rgba(176, 58, 58, 0.9);
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