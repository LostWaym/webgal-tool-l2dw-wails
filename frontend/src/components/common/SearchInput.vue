<script setup lang="ts">
import { computed } from 'vue'
import UiIcon from './UiIcon.vue'

type SearchVariant = 'action' | 'edit'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    variant?: SearchVariant
  }>(),
  {
    placeholder: '搜索...',
    variant: 'action',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const inputValue = computed<string>({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function onClear() {
  emit('update:modelValue', '')
}
</script>

<template>
  <div class="search-box" :class="[`is-${variant}`, $attrs.class]" :style="$attrs.style">
    <UiIcon name="search" class="search-box__icon" />
    <input
      v-model="inputValue"
      type="text"
      class="search-box__input"
      :placeholder="placeholder"
      :aria-label="placeholder"
    />
    <button
      v-if="inputValue"
      type="button"
      class="search-box__clear"
      aria-label="清空搜索"
      title="清空搜索"
      @click="onClear"
    >
      <UiIcon name="close" />
    </button>
  </div>
</template>

<style scoped>
.search-box {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
  background: var(--ui-field-fill);
  border: 1px solid var(--ui-edge);
  border-radius: var(--ui-radius-search);
  color: var(--ui-text);
  font-size: 13px;
  transition: border-color 0.15s;
}

.search-box:focus-within {
  border-color: var(--ui-link);
  box-shadow: 0 0 0 1px var(--ui-link);
}

.search-box__icon {
  font-size: 16px;
  flex-shrink: 0;
  margin-left: 10px;
  color: var(--ui-muted);
}

.search-box__input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  background: transparent;
  border: none;
  color: var(--ui-text);
  font-size: 13px;
  outline: none;
}

.search-box.is-action .search-box__input {
  padding: 9px 10px;
  font-size: 14px;
}

.search-box.is-edit .search-box__input {
  padding: 6px 10px;
}

.search-box__input::placeholder {
  color: var(--ui-muted);
}

.search-box__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: 6px;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--ui-radius-pill);
  cursor: pointer;
  transition: background 0.12s ease;
}

.search-box__clear:hover {
  background: var(--ui-hover);
}

</style>
