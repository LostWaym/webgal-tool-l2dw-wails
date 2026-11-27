<script setup lang="ts">
const paths = {
  model: 'M12 2.5 21 7.5v9l-9 5-9-5v-9l9-5ZM3 7.5l9 5 9-5M12 12.5v9',
  image: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm-1 12 5-5 4 4 3-3 6 6M15 8h.01',
  group: 'M3 7h7l2 2h9v11H3zM3 7V4h8l2 2h7M12 12v5m-2.5-2.5h5',
  project: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  guides: 'M12 2v5m0 10v5M2 12h5m10 0h5M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
  settings: 'm10 3-.8 2.5L7 6.8l-2.6-.5-2 3.4L4.2 12l-1.8 2.3 2 3.4 2.6-.5 2.2 1.3L10 21h4l.8-2.5 2.2-1.3 2.6.5 2-3.4-1.8-2.3 1.8-2.3-2-3.4-2.6.5-2.2-1.3L14 3ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  play: 'M7 4.5 20 12 7 19.5z',
  transform: 'M8 3v13h13M3 8h13v13M12 12h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v5m0-8h.01',
  search: 'M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 5 5',
  close: 'm6 6 12 12M18 6 6 18',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  eyeOff: 'm3 3 18 18M10.6 5.1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.3 3.2M6.4 6.4A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.6-1.8m-7.7-7.3a3 3 0 0 0 4.2 4.2',
  down: 'm6 9 6 6 6-6',
  right: 'm9 6 6 6-6 6',
  left: 'm15 6-6 6 6 6',
  folder: 'M3 7V4h7l2 3h9v13H3Z',
  filter: 'M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5Z',
  snapshot: 'M3 6h5l1.5-2h5L16 6h5v14H3ZM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  reload: 'M20 7v5h-5M4 17v-5h5M5.5 9a7 7 0 0 1 11.8-2L20 12M4 12l2.7 5a7 7 0 0 0 11.8-2',
  texture: 'M3 4h18v16H3ZM8 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 18l5-5 3 3 3-3 5 5',
  pin: 'm9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
}

defineProps<{ name: keyof typeof paths }>()
</script>

<template>
  <svg class="ui-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name]" />
  </svg>
</template>

<style scoped>
.ui-symbol { width: 1em; height: 1em; flex: none; }
</style>
