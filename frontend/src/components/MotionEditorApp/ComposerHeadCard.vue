<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ComposerDef } from '../../utils/motionComposors'

/**
 * 组合器轨道行头卡片：外观复用 range-card 壳，值区为 dropdown。
 * 点击选项即向上抛 update:modelValue（父级负责 k 帧）。
 * 菜单 Teleport 到 body + fixed 定位：行头列 overflow:hidden 会裁剪
 * 内联绝对定位的菜单，底部行的选项会不可见。
 */
const props = withDefaults(
  defineProps<{
    def: ComposerDef
    /** 当前帧激活成员索引；-1 = 无 key（显示 —） */
    modelValue: number
    highlight?: boolean
    /** def 缺失/成员全无效时灰显 */
    disabled?: boolean
  }>(),
  {
    highlight: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', index: number): void
}>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
/** Teleport 菜单的 fixed 定位坐标与宽度 */
const menuX = ref(0)
const menuY = ref(0)
const menuW = ref(0)

const items = computed(() =>
  props.def.members.map((name, i) => ({
    index: i,
    name,
    valid: props.def.resolvedMembers[i] != null,
  })),
)

const currentName = computed(() => {
  const idx = props.modelValue
  if (idx < 0 || idx >= props.def.members.length) return '—'
  return props.def.members[idx]
})

function onPick(index: number) {
  if (props.disabled) return
  emit('update:modelValue', index)
  open.value = false
}

function toggleOpen() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  const rect = rootEl.value?.getBoundingClientRect()
  if (!rect) {
    open.value = true
    return
  }
  menuX.value = rect.left
  menuY.value = rect.bottom + 2
  menuW.value = rect.width
  // 先开菜单再测量：nextTick 必须在 open 置 true 之后调度，
  // 否则回调先于渲染执行、拿到的高度为 0，夹紧逻辑失效
  open.value = true
  void nextTick(() => {
    const h = menuEl.value?.offsetHeight ?? 0
    if (!h) return
    // 视口内夹紧：默认向下弹，底部空间不足则向上弹，极端矮窗口再兜底 clamp
    if (rect.bottom + h + 8 > window.innerHeight) {
      menuY.value = Math.max(8, rect.top - h - 2)
    }
    menuY.value = Math.max(8, Math.min(menuY.value, window.innerHeight - h - 8))
  })
}

function onScrollOrResize(e: Event) {
  // 菜单自身滚动（滚轮选项/拖滚动条）不关闭；外部容器滚动/窗口 resize 关闭
  if (e.type === 'scroll' && menuEl.value?.contains(e.target as Node)) return
  open.value = false
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  if (rootEl.value?.contains(e.target as Node)) return
  if (menuEl.value?.contains(e.target as Node)) return
  open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
})
</script>

<template>
  <div
    ref="rootEl"
    class="range-card composer-card"
    :class="{ 'is-highlight': highlight, 'is-disabled': disabled }"
  >
    <div class="range-card__header">
      <span class="range-card__name" :title="def.name">{{ def.name }}</span>
      <span class="composer-card__tag">switch</span>
    </div>
    <div
      class="composer-card__select"
      :class="{ 'is-open': open }"
      @click="toggleOpen"
    >
      <span class="composer-card__value" :title="currentName">{{ currentName }}</span>
      <span class="composer-card__caret">▾</span>
    </div>
    <Teleport to="body">
      <ul
        v-if="open"
        ref="menuEl"
        class="composer-card__menu"
        :style="{ left: menuX + 'px', top: menuY + 'px', width: menuW + 'px' }"
      >
        <li
          v-for="item in items"
          :key="item.index"
          class="composer-card__item"
          :class="{
            'is-active': item.index === modelValue,
            'is-invalid': !item.valid,
          }"
          :title="item.valid ? item.name : '未在模型参数中找到该成员'"
          @click.stop="onPick(item.index)"
        >
          {{ item.name }}
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.composer-card__tag {
  flex: 0 0 auto;
  font-size: 10px;
  color: #8a93a3;
  background: #1d2026;
  border: 1px solid #2c313a;
  border-radius: 3px;
  padding: 1px 4px;
  line-height: 1.2;
}

.composer-card__select {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #1d2026;
  border: 1px solid #2c313a;
  border-radius: 3px;
  padding: 3px 6px;
  cursor: pointer;
  user-select: none;
}

.composer-card__select:hover,
.composer-card__select.is-open {
  border-color: #2f80ed;
}

.composer-card__value {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: #e6e6e6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-card__caret {
  flex: 0 0 auto;
  font-size: 10px;
  color: #8a93a3;
}

.composer-card__menu {
  position: fixed;
  z-index: 1000;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: #2c313a;
  border: 1px solid #3a404b;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  max-height: 200px;
  overflow-y: auto;
}

.composer-card__item {
  padding: 4px 10px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: #e6e6e6;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-card__item:hover {
  background: #3a404b;
}

.composer-card__item.is-active {
  color: #5fa8ff;
}

.composer-card__item.is-invalid {
  color: #6b7280;
  text-decoration: line-through;
  cursor: not-allowed;
}
</style>
