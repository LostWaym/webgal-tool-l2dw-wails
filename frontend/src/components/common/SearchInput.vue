<script setup lang="ts">
import { computed } from 'vue'
import searchIcon from '../../assets/icons/search.png'
import clearIcon from '../../assets/icons/x.png'

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
    <img :src="searchIcon" alt="" class="search-box__icon" aria-hidden="true" />
    <input
      v-model="inputValue"
      type="text"
      class="search-box__input"
      :placeholder="placeholder"
    />
    <button
      v-if="inputValue"
      type="button"
      class="search-box__clear"
      aria-label="清空搜索"
      @click="onClear"
    >
      <img :src="clearIcon" alt="" aria-hidden="true" />
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
  background: #262b34;
  border: 1px solid #3a4150;
  border-radius: 6px;
  color: #e6e6e6;
  font-size: 13px;
  transition: border-color 0.15s;
}

.search-box:focus-within {
  border-color: #2f80ed;
}

.search-box.is-edit {
  background: #2c313a;
  border-color: #3a404b;
  border-radius: 4px;
}

.search-box.is-edit:focus-within {
  border-color: #2f80ed;
}

.search-box__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-left: 10px;
  opacity: 0.7;
}

.search-box__input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  background: transparent;
  border: none;
  color: #e6e6e6;
  font-size: 13px;
  outline: none;
}

.search-box.is-action .search-box__input {
  padding: 8px 12px;
}

.search-box.is-edit .search-box__input {
  padding: 6px 10px;
}

.search-box__input::placeholder {
  color: #6b7280;
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
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.search-box__clear:hover {
  background: #3a3f4b;
}

.search-box__clear img {
  width: 12px;
  height: 12px;
  display: block;
}
</style>
