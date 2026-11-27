export interface NumberAdjustment {
  step: number
  min?: number
  max?: number
  precision?: number
}

export function adjustNumber(value: number, steps: number, options: NumberAdjustment): number {
  const { step, min = -Infinity, max = Infinity, precision = 2 } = options
  if (!Number.isFinite(value) || !Number.isFinite(steps) || !Number.isFinite(step)) return value
  const rounded = Number((value + steps * step).toFixed(precision))
  return Math.max(min, Math.min(max, rounded))
}
