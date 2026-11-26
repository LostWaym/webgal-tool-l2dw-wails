import { computed, ref, type Ref } from 'vue'

export function useFilteredSelection(entries: Readonly<Ref<readonly { absPath: string }[]>>) {
  const selected = ref(new Set<string>())
  const isSelected = (path: string) => selected.value.has(path)
  const allFilteredSelected = computed(() =>
    entries.value.length > 0 && entries.value.every(entry => isSelected(entry.absPath)),
  )

  function toggleOne(path: string) {
    const next = new Set(selected.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    selected.value = next
  }

  function toggleAllFiltered() {
    const next = new Set(selected.value)
    const remove = allFilteredSelected.value
    for (const { absPath } of entries.value) {
      if (remove) next.delete(absPath)
      else next.add(absPath)
    }
    selected.value = next
  }

  return { selected, isSelected, allFilteredSelected, toggleOne, toggleAllFiltered }
}
