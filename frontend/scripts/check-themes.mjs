import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const themes = JSON.parse(readFileSync(new URL('../src/themes/palettes.json', import.meta.url), 'utf8'))
const surfaces = ['window', 'panel', 'well', 'control', 'hover', 'selected']
const inks = ['text', 'muted', 'link', 'success', 'warning', 'danger', 'alternate']
const roles = [...surfaces, ...inks, 'line', 'edge', 'accent', 'on-accent'].sort()
const stylesheet = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const profiles = new Set(Array.from(stylesheet.matchAll(/:root\[data-profile="([a-z-]+)"\]/g), match => match[1]))
const glassOpacity = Number(stylesheet.match(/--ui-stage-glass-opacity:\s*(\d+)%;/)?.[1]) / 100
assert.ok(glassOpacity > 0 && glassOpacity < 1, 'stage hints must have a translucent background')

function channels(hex) {
  return hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255)
}

function luminance(channels) {
  const rgb = channels
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

function contrast(a, b) {
  const [lo, hi] = [a, b].map(luminance).sort((x, y) => x - y)
  return (hi + 0.05) / (lo + 0.05)
}

assert.ok(themes.length)
assert.equal(new Set(themes.map(t => t.id)).size, themes.length, 'duplicate theme ID')
for (const { id, scheme, profile, colors } of themes) {
  assert.match(id, /^[a-z][a-z0-9-]*$/)
  assert.ok(['light', 'dark'].includes(scheme))
  assert.ok(profile === undefined || profiles.has(profile), `${id}: unknown control profile ${profile}`)
  assert.deepEqual(Object.keys(colors).sort(), roles, `${id}: incomplete palette`)
  for (const hex of Object.values(colors)) assert.match(hex, /^#[\da-f]{6}$/i)
  function check(a, b, minimum) {
    const ratio = contrast(channels(colors[a]), channels(colors[b]))
    assert.ok(ratio >= minimum, `${id}: ${a}/${b} = ${ratio.toFixed(2)} < ${minimum}`)
  }
  for (const bg of surfaces) {
    for (const ink of inks) check(ink, bg, 4.5)
    check('edge', bg, 3)
  }
  check('accent', 'on-accent', 4.5)
  for (const backdrop of [0, 1]) {
    const glass = channels(colors.panel).map(c => c * glassOpacity + backdrop * (1 - glassOpacity))
    for (const ink of ['text', 'link', 'warning']) {
      const ratio = contrast(channels(colors[ink]), glass)
      assert.ok(ratio >= 4.5, `${id}: ${ink}/stage glass over ${backdrop} = ${ratio.toFixed(2)} < 4.5`)
    }
  }
  console.log(`${id}: OK`)
}
