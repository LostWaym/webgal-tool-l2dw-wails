import { shallowRef } from 'vue'
import { GetAppTheme, SetAppTheme } from '../../wailsjs/go/main/App'
import { EventsOn, WindowSetBackgroundColour, WindowSetDarkTheme, WindowSetLightTheme } from '../../wailsjs/runtime/runtime'
import { useMessage } from '../composables/useMessage'
import palettes from './palettes.json'

export const themes = palettes
type Theme = typeof palettes[number]
export const currentTheme = shallowRef<Theme>(themes[0])
let generation = 0
let writes = 0
let save = Promise.resolve()
let confirmed = themes[0]

export function themeColor(role: keyof Theme['colors']) {
  return parseInt(currentTheme.value.colors[role].slice(1), 16)
}

function apply(theme: Theme) {
  const root = document.documentElement
  if (root.dataset.theme === theme.id) return
  for (const [role, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--ui-${role}`, value)
  }
  root.style.colorScheme = theme.scheme
  root.dataset.scheme = theme.scheme
  root.dataset.theme = theme.id
  currentTheme.value = theme
  if ('runtime' in window) {
    if (theme.scheme === 'light') WindowSetLightTheme()
    else WindowSetDarkTheme()
    const rgb = themeColor('window')
    WindowSetBackgroundColour(rgb >> 16, rgb >> 8 & 255, rgb & 255, 255)
  }
}

async function refresh() {
  if (writes) return
  const version = ++generation
  try {
    const id = await GetAppTheme()
    if (version === generation) {
      confirmed = themes.find(t => t.id === id) ?? themes[0]
      apply(confirmed)
    }
  } catch (err) {
    console.warn('读取应用主题失败', err)
    if (version === generation) apply(confirmed)
  }
}

export async function initializeAppearance() {
  const off = 'runtime' in window ? EventsOn('appearance:changed', refresh) : undefined
  window.addEventListener('focus', refresh)
  if (import.meta.hot) import.meta.hot.dispose(() => {
    off?.()
    window.removeEventListener('focus', refresh)
  })
  await refresh()
}

export function selectTheme(theme: Theme) {
  if (theme === currentTheme.value) return
  ++generation
  ++writes
  apply(theme)
  save = save.then(async () => {
    await SetAppTheme(theme.id)
    confirmed = theme
  }).catch(err => {
    console.warn('保存应用主题失败', err)
    if (writes === 1) {
      apply(confirmed)
      useMessage().warning('主题保存失败，已恢复原设置')
    }
  }).finally(() => {
    if (--writes === 0) void refresh()
  })
}
