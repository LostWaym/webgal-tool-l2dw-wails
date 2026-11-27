<script setup lang="ts">
import { computed } from 'vue'
import { RADIAL_MENU, type StageRadialAction } from '../../utils/stageRadialMenu'
import UiIcon from '../common/UiIcon.vue'

const props = defineProps<{
  x: number
  y: number
  scale: number
  name: string
  actions: StageRadialAction[]
  active: number
  dx: number
  dy: number
}>()

const size = RADIAL_MENU.extent * 2
const ringRadius = 41
function point(angle: number, radius: number) {
  const radians = angle * Math.PI / 180
  return { x: Math.cos(radians) * radius, y: Math.sin(radians) * radius }
}

function arcPath(angle: number) {
  const half = 180 / props.actions.length
  const start = angle - half + 2
  const end = angle + half - 2
  const from = point(start, ringRadius)
  const to = point(end, ringRadius)
  const large = end - start > 180 ? 1 : 0
  return `M ${from.x} ${from.y} A ${ringRadius} ${ringRadius} 0 ${large} 1 ${to.x} ${to.y}`
}

const activeArc = computed(() => {
  const action = props.actions[props.active]
  return action ? arcPath(action.angle) : ''
})

const indicator = computed(() => {
  const angle = Math.atan2(props.dy, props.dx) * 180 / Math.PI
  return point(angle, ringRadius - 9)
})

function labelStyle(action: StageRadialAction) {
  const position = point(action.angle, RADIAL_MENU.labelRadius)
  return { left: `${RADIAL_MENU.extent + position.x}px`, top: `${RADIAL_MENU.extent + position.y}px` }
}
</script>

<template>
  <Teleport to="body">
    <div class="stage-radial-backdrop" @contextmenu.prevent @click.stop.prevent @auxclick.stop.prevent @wheel.stop.prevent>
      <div class="stage-radial" :style="{ left: `${x}px`, top: `${y}px` }" role="group" :aria-label="`${name}的操作轮盘`">
        <div class="stage-radial__dial" :style="{ width: `${size}px`, height: `${size}px`, transform: `translate(-50%, -50%) scale(${scale})` }">
          <svg class="stage-radial__ring" :viewBox="`${-RADIAL_MENU.extent} ${-RADIAL_MENU.extent} ${size} ${size}`" aria-hidden="true">
            <circle class="stage-radial__track" :r="ringRadius" />
            <path v-if="activeArc" class="stage-radial__arc" :d="activeArc" />
            <circle v-if="active >= 0" class="stage-radial__indicator" :cx="indicator.x" :cy="indicator.y" r="2.5" />
          </svg>
          <div v-for="(action, index) in actions" :key="action.id" class="stage-radial__label"
            :class="{ 'is-active': index === active }" :style="labelStyle(action)" :data-action="action.id">
            <UiIcon :name="action.icon" />
            <span>{{ action.label }}</span>
          </div>
        </div>
        <div class="stage-radial__center" :class="{ 'is-active': active >= 0 }"
          :style="{ width: `${RADIAL_MENU.deadZone * 2}px`, height: `${RADIAL_MENU.deadZone * 2}px` }"
          :aria-label="active < 0 ? '松开取消' : '松开执行'">
          <UiIcon name="close" />
          <span class="stage-radial__hint">松开取消</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.stage-radial-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1500;
  cursor: default;
  user-select: none;
  touch-action: none;
}
.stage-radial { position: absolute; color: var(--ui-text); }
.stage-radial__dial { position: absolute; pointer-events: none; }
.stage-radial__ring { position: absolute; inset: 0; width: 100%; height: 100%; fill: none; stroke-width: 10; }
.stage-radial__track { stroke: color-mix(in srgb, var(--ui-text) 12%, transparent); }
.stage-radial__arc { stroke: var(--ui-accent); stroke-linecap: round; }
.stage-radial__indicator { fill: var(--ui-accent); }
.stage-radial__label {
  position: absolute;
  box-sizing: border-box;
  width: max-content;
  min-width: 76px;
  height: 32px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transform: translate(-50%, -50%);
  border: 1px solid var(--ui-control-line);
  border-radius: 999px;
  background: var(--ui-stage-glass);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);
  color: var(--ui-text);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition: transform 90ms ease-out, border-color 90ms ease-out, background-color 90ms ease-out;
}
.stage-radial__label.is-active {
  border-color: var(--ui-accent);
  background: color-mix(in srgb, var(--ui-accent) 22%, var(--ui-floating));
  color: var(--ui-link);
  transform: translate(-50%, -50%) scale(1.05);
}
.stage-radial__center {
  position: absolute;
  box-sizing: border-box;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 1px solid var(--ui-control-line);
  border-radius: 50%;
  background: var(--ui-stage-glass);
  backdrop-filter: blur(10px);
  font-size: 12px;
  pointer-events: none;
  transition: opacity 90ms ease-out;
}
.stage-radial__center.is-active { opacity: 0.55; }
.stage-radial__hint { color: var(--ui-muted); font-size: 10px; white-space: nowrap; line-height: 1.2; }
</style>
