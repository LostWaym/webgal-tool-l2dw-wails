import { isSpecialId, SpecialId } from '../live2d/specialIds'

export const RADIAL_MENU = {
  deadZone: 26,
  labelRadius: 112,
  extent: 184,
  padding: 12,
} as const

const ACTIONS = {
  filter: { id: 'filter', label: '滤镜', icon: 'filter' },
  snapshot: { id: 'snapshot', label: '变换快照', icon: 'snapshot' },
  reloadConfig: { id: 'reloadConfig', label: '重载模型配置', icon: 'reload' },
  reloadTextures: { id: 'reloadTextures', label: '重载模型纹理', icon: 'texture' },
} as const

export type StageRadialActionId = keyof typeof ACTIONS
export type StageRadialAction = typeof ACTIONS[StageRadialActionId] & { angle: number }

export function getStageRadialActions(id: string, kind?: 'live2d' | 'image'): StageRadialAction[] {
  let ids: StageRadialActionId[] = []
  if (id === SpecialId.Camera) ids = ['snapshot']
  else if (kind === 'live2d') ids = ['filter', 'snapshot', 'reloadConfig', 'reloadTextures']
  else if (kind === 'image' || isSpecialId(id)) ids = ['filter', 'snapshot']
  return ids.map((key, index) => ({ ...ACTIONS[key], angle: -90 + index * 360 / ids.length }))
}

export function radialMenuPosition(x: number, y: number, width: number, height: number) {
  const scale = Math.max(0.01, Math.min(1,
    (width - RADIAL_MENU.padding * 2) / (RADIAL_MENU.extent * 2),
    (height - RADIAL_MENU.padding * 2) / (RADIAL_MENU.extent * 2),
  ))
  const margin = RADIAL_MENU.extent * scale + RADIAL_MENU.padding
  return {
    x: Math.max(margin, Math.min(x, width - margin)),
    y: Math.max(margin, Math.min(y, height - margin)),
    scale,
  }
}

export function radialMenuIndex(dx: number, dy: number, actions: readonly StageRadialAction[]): number {
  if (!actions.length || Math.hypot(dx, dy) <= RADIAL_MENU.deadZone) return -1
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  let nearest = -1
  let distance = Infinity
  actions.forEach((action, index) => {
    const delta = Math.abs(((angle - action.angle + 540) % 360) - 180)
    if (delta < distance) {
      nearest = index
      distance = delta
    }
  })
  return nearest
}
