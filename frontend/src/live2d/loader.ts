import * as PIXI from 'pixi.js'
import { CUBISM_CORE_MEMORY } from '../utils/consts'

// pixi-live2d-display reads window.PIXI.Ticker to drive model updates.
// Importing pixi.js does NOT expose it globally, so we have to do that here.
;(window as any).PIXI = PIXI

console.log("setting init memory!")

// 扩大 Cubism 4 core 内存池，须在加载任何模型前执行一次
window.Live2DCubismCore?.Memory?.initializeAmountOfMemory(CUBISM_CORE_MEMORY)

export function isCubism3Plus(jsonPath: string): boolean {
  return /\.model3\.json$/i.test(jsonPath)
}