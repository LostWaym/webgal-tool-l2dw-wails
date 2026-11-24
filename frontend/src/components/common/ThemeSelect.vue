<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  id: string
  modelValue: number | string
  options: ReadonlyArray<{ value: number | string; label: string }>
  disabled?: boolean
  label?: string
  compact?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: number | string): void }>()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const listStyle = ref<Record<string, string>>({})
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label ?? '')

function show() {
  if (props.disabled || !props.options.length || !trigger.value) return
  activeIndex.value = Math.max(0, props.options.findIndex(option => option.value === props.modelValue))
  const rect = trigger.value.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - 8
  const above = rect.top - 8
  const upwards = below < 150 && above > below
  const maxHeight = Math.max(40, Math.min(240, upwards ? above : below))
  const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 8)
  listStyle.value = {
    left: `${Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    ...(upwards ? { bottom: `${window.innerHeight - rect.top + 4}px` } : { top: `${rect.bottom + 4}px` }),
  }
  open.value = true
  nextTick(() => list.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
}

function choose(index: number) {
  const option = props.options[index]
  if (!option) return
  emit('update:modelValue', option.value)
  open.value = false
  trigger.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    open.value = false
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    if (!open.value) show()
    else activeIndex.value = (activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + props.options.length) % props.options.length
  } else if (open.value && (event.key === 'Home' || event.key === 'End')) {
    event.preventDefault()
    event.stopPropagation()
    activeIndex.value = event.key === 'Home' ? 0 : props.options.length - 1
  } else if (open.value && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault()
    event.stopPropagation()
    choose(activeIndex.value)
  } else if (event.key === 'Tab') {
    open.value = false
  }
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (!root.value?.contains(target) && !list.value?.contains(target)) open.value = false
}

watch(activeIndex, async () => {
  await nextTick()
  list.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
})
watch(() => props.disabled, disabled => { if (disabled) open.value = false })
function onScroll(event: Event) {
  if (!list.value?.contains(event.target as Node)) open.value = false
}
function close() { open.value = false }
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', close)
})
</script>

<template>
  <div ref="root" class="theme-select" :class="{ 'theme-select--compact': compact }" @keydown="onKeydown">
    <button
      :id="id"
      ref="trigger"
      type="button"
      class="theme-select__trigger"
      role="combobox"
      :disabled="disabled"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="`${id}-list`"
      :aria-activedescendant="open ? `${id}-option-${activeIndex}` : undefined"
      @click="open ? open = false : show()"
    >
      <span>{{ selectedLabel }}</span>
      <span class="theme-select__arrow" aria-hidden="true"></span>
    </button>
    <Teleport to="body">
    <div v-if="open" :id="`${id}-list`" ref="list" class="theme-select__list" :style="listStyle" role="listbox" :aria-label="label || selectedLabel">
      <div
        v-for="(option, index) in options"
        :id="`${id}-option-${index}`"
        :key="option.value"
        class="theme-select__option"
        :class="{ 'is-active': index === activeIndex, 'is-selected': option.value === modelValue }"
        :data-active="index === activeIndex"
        role="option"
        :aria-selected="option.value === modelValue"
        @mousemove="activeIndex = index"
        @click="choose(index)"
      >
        <span>{{ option.label }}</span><span v-if="option.value === modelValue" aria-hidden="true">✓</span>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.theme-select { position: relative; width: 100%; }
.theme-select__trigger {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; padding: 9px 12px; text-align: left; font: inherit; color: var(--ui-text);
  border: 1px solid var(--ui-edge); border-radius: var(--ui-radius-control);
  background: var(--ui-field-fill);
  box-shadow: var(--ui-control-shadow); cursor: pointer;
}
.theme-select__trigger:hover, .theme-select__trigger[aria-expanded="true"] { border-color: var(--ui-link); }
.theme-select__trigger:disabled { opacity: 0.5; cursor: not-allowed; }
.theme-select--compact .theme-select__trigger { padding: 4px 8px; border-radius: var(--ui-radius-compact); }
.theme-select__arrow {
  width: 9px; height: 9px; margin: 0 3px 4px; flex: none;
  border-right: 2px solid var(--ui-link); border-bottom: 2px solid var(--ui-link); transform: rotate(45deg);
}
.theme-select__list {
  position: fixed; z-index: 20000; overflow-y: auto; padding: 6px;
  border: 1px solid var(--ui-link); border-radius: var(--ui-radius-control);
  background: var(--ui-menu-fill);
  box-shadow: var(--ui-panel-shadow);
}
.theme-select__option {
  display: flex; justify-content: space-between; gap: 12px; padding: 8px 10px;
  border-radius: var(--ui-radius-compact); color: var(--ui-text); cursor: pointer;
}
.theme-select__option.is-active { background: var(--ui-hover); }
.theme-select__option.is-selected { background: var(--ui-selected); }
.theme-select__option.is-selected span:last-child { color: var(--ui-link); }
</style>
