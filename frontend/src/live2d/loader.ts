import * as PIXI from 'pixi.js'

// pixi-live2d-display reads window.PIXI.Ticker to drive model updates.
// Importing pixi.js does NOT expose it globally, so we have to do that here.
;(window as any).PIXI = PIXI

export function isCubism3Plus(jsonPath: string): boolean {
  return /\.model3\.json$/i.test(jsonPath)
}