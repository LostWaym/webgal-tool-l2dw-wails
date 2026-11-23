import { STAGE_HEIGHT, STAGE_WIDTH } from './consts'

export type GuideAxis = 'x' | 'y'
export type PreviewGuide = { axis: GuideAxis; position: number }
type Point = { x: number; y: number }
type GuideSnap = { point: Point; guides: readonly PreviewGuide[] }

export const PREVIEW_FRAME = {
  left: -STAGE_WIDTH / 2,
  right: STAGE_WIDTH / 2,
  top: -STAGE_HEIGHT / 2,
  bottom: STAGE_HEIGHT / 2,
}

export const GUIDE_SNAP_PX = 10
const guideRanges = {
  x: [PREVIEW_FRAME.left, PREVIEW_FRAME.right],
  y: [PREVIEW_FRAME.top, PREVIEW_FRAME.bottom],
} as const

export function previewGuideRange(axis: GuideAxis) {
  return guideRanges[axis]
}

function inRange(axis: GuideAxis, value: number): boolean {
  const [min, max] = guideRanges[axis]
  return value >= min && value <= max
}

export function isPreviewGuide(value: unknown): value is PreviewGuide {
  if (!value || typeof value !== 'object') return false
  const { axis, position } = value as Partial<PreviewGuide>
  return (axis === 'x' || axis === 'y') && typeof position === 'number' && inRange(axis, position)
}

export function previewGuideKey({ axis, position }: PreviewGuide): string {
  return `${axis}:${position}`
}

export function mergePreviewGuides(current: readonly PreviewGuide[], incoming: readonly PreviewGuide[]): PreviewGuide[] {
  const result = [...current]
  const keys = new Set(current.map(previewGuideKey))
  for (const guide of incoming) {
    const key = previewGuideKey(guide)
    if (keys.has(key)) continue
    keys.add(key)
    result.push(guide)
  }
  return result
}

export function previewGuideEnds({ axis, position }: PreviewGuide): [Point, Point] {
  const { left, right, top, bottom } = PREVIEW_FRAME
  return axis === 'x'
    ? [{ x: position, y: top }, { x: position, y: bottom }]
    : [{ x: left, y: position }, { x: right, y: position }]
}

export function placePreviewGuide(axis: GuideAxis, point: Point): PreviewGuide | undefined {
  if (inRange('x', point.x) && inRange('y', point.y)) {
    return { axis, position: point[axis] }
  }
}

function nearestGuide(guides: readonly PreviewGuide[], distance: (guide: PreviewGuide) => number, limit: number) {
  let best: PreviewGuide | undefined
  let bestDistance = Infinity
  for (const guide of guides) {
    const d = distance(guide)
    if (d <= limit && d < bestDistance) {
      best = guide
      bestDistance = d
    }
  }
  return best
}

function segmentDistance(point: Point, guide: PreviewGuide, pixels: Point): number {
  const across = guide.axis === 'x' ? 'y' : 'x'
  const [min, max] = guideRanges[across]
  const outside = Math.max(min - point[across], 0, point[across] - max)
  return Math.hypot((point[guide.axis] - guide.position) * pixels[guide.axis], outside * pixels[across])
}

export function hitPreviewGuide(guides: readonly PreviewGuide[], point: Point, pixels: Point) {
  return nearestGuide(guides, guide => segmentDistance(point, guide, pixels), GUIDE_SNAP_PX)
}

export function snapPreviewGuide(guides: readonly PreviewGuide[], point: Point, pixels: Point, lock: GuideAxis | 'none'): GuideSnap | undefined {
  const closestOnAxis = (axis: GuideAxis) => nearestGuide(guides, guide =>
    guide.axis === axis ? Math.abs(point[axis] - guide.position) * pixels[axis] : Infinity,
    GUIDE_SNAP_PX,
  )
  if (lock !== 'none') {
    const guide = closestOnAxis(lock)
    return guide && { point: { ...point, [lock]: guide.position }, guides: [guide] }
  }

  const x = closestOnAxis('x')
  const y = closestOnAxis('y')
  if (x && y && Math.hypot((point.x - x.position) * pixels.x, (point.y - y.position) * pixels.y) <= GUIDE_SNAP_PX) {
    return { point: { x: x.position, y: y.position }, guides: [x, y] }
  }

  const guide = nearestGuide(guides, g => segmentDistance(point, g, pixels), GUIDE_SNAP_PX)
  return guide && { point: { ...point, [guide.axis]: guide.position }, guides: [guide] }
}
