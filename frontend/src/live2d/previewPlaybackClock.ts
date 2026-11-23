import type { Live2DModel } from 'pixi-live2d-display-webgal'

interface Cubism2Clock {
  getUserTimeMSec: () => number
}

function getCubism2Clock(): Cubism2Clock | undefined {
  const clock = (window as any).UtSystem
  return typeof clock?.getUserTimeMSec === 'function' ? clock : undefined
}

function isCubism2(model: Live2DModel): boolean {
  return typeof (model.internalModel.coreModel as any)?.setParameterValueById !== 'function'
}

/** 配置独立预览模型的动作时钟，不更改其他模型的计时。 */
export function configurePreviewPlaybackClocks(models: Live2DModel[]): boolean {
  const clock = getCubism2Clock()
  const supported = models.every(model => {
    if (!isCubism2(model)) return true
    const manager = model.internalModel.motionManager as any
    const queues = [manager?.queueManager, manager?.expressionManager?.queueManager].filter(Boolean)
    return !!clock && !!manager?.queueManager && queues.every(queue =>
      typeof queue.startMotion === 'function' && typeof queue.updateParam === 'function')
  })

  for (const model of models) {
    const manager = model.internalModel.motionManager as any
    const queues = [manager?.queueManager, manager?.expressionManager?.queueManager].filter(Boolean)
    if (isCubism2(model)) {
      if (!supported || !clock) continue
      const origin = clock.getUserTimeMSec()
      const elapsedOrigin = model.elapsedTime
      for (const queue of queues) {
        for (const method of ['startMotion', 'updateParam'] as const) {
          const original = queue[method]
          queue[method] = function (...args: any[]) {
            const previous = clock.getUserTimeMSec
            clock.getUserTimeMSec = () => origin + model.elapsedTime - elapsedOrigin
            try {
              return original.apply(this, args)
            } finally {
              clock.getUserTimeMSec = previous
            }
          }
        }
      }
    } else {
      for (const queue of queues) {
        if (typeof queue.startMotion !== 'function') continue
        const start = queue.startMotion
        queue.startMotion = function (...args: any[]) {
          args[2] = model.elapsedTime
          return start.apply(this, args)
        }
      }
    }
  }
  return supported
}
