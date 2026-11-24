import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const themes = JSON.parse(readFileSync(new URL('../src/themes/palettes.json', import.meta.url), 'utf8'))
const surfaces = ['window', 'panel', 'well', 'control', 'hover', 'selected']
const inks = ['text', 'muted', 'link', 'success', 'warning', 'danger', 'alternate']
const roles = [...surfaces, ...inks, 'line', 'edge', 'accent', 'on-accent'].sort()

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

assert.ok(themes.length)
assert.equal(new Set(themes.map(t => t.id)).size, themes.length, 'duplicate theme ID')
for (const { id, scheme, colors } of themes) {
  assert.match(id, /^[a-z][a-z0-9-]*$/)
  assert.ok(['light', 'dark'].includes(scheme))
  assert.deepEqual(Object.keys(colors).sort(), roles, `${id}: incomplete palette`)
  for (const hex of Object.values(colors)) assert.match(hex, /^#[\da-f]{6}$/i)
  function check(a, b, minimum) {
    const [lo, hi] = [colors[a], colors[b]].map(luminance).sort((x, y) => x - y)
    const ratio = (hi + 0.05) / (lo + 0.05)
    assert.ok(ratio >= minimum, `${id}: ${a}/${b} = ${ratio.toFixed(2)} < ${minimum}`)
  }
  for (const bg of surfaces) {
    for (const ink of inks) check(ink, bg, 4.5)
    check('edge', bg, 3)
  }
  check('accent', 'on-accent', 4.5)
  console.log(`${id}: OK`)
}
