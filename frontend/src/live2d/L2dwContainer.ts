import * as PIXI from 'pixi.js'

/**
 * L2dwContainer
 * - 继承 PIXI.Container，对外暴露"以自身中心为原点"的局部坐标。
 * - 内部 `_baseX / _baseY` 表示容器在父坐标系下的基准位置（即"中心点"对应的父坐标）。
 *   - `super.x` 是父坐标系下的实际位置；`this.x` 是相对中心的局部值。
 *   - 公式：`this.x = super.x - baseX`  ⇔  `super.x = this.x + baseX`。
 * - 旋转 (`rotation`) 与缩放 (`scale`) 直接透传：外部一律通过本容器修改，
 *   子节点 `Live2DModel` 跟随缩放 / 旋转。
 *
 * 约定：
 *   - `Live2DModel` 必须挂在 `L2dwContainer` 下，且 `model.anchor = (0.5, 0.5)`、
 *     `model.x = model.y = 0`，使模型天然位于容器中心。
 *   - 初始化时如果要给"裸模型"一个初始显示尺寸，可以写在 `Live2DModel.scale` 上，
 *     但**初始化之后不允许再写 `Live2DModel` 的 `x / y / scale / rotation`**，
 *     所有变换都走 `L2dwContainer`。
 */
export class L2dwContainer extends PIXI.Container {
  private _baseX = 0
  private _baseY = 0

  /**
   * 设置容器在父坐标系下的基准位置（中心点）。
   * 写入后 `this.x / this.y` 仍为 0，但 `super.x / super.y` 已更新。
   */
  setBasePosition(baseX: number, baseY: number): void {
    this._baseX = baseX
    this._baseY = baseY
    super.position.set(baseX, baseY)
  }

  get baseX(): number {
    return this._baseX
  }

  get baseY(): number {
    return this._baseY
  }

  get x(): number {
    return super.x - this._baseX
  }

  set x(value: number) {
    super.x = value + this._baseX
  }

  get y(): number {
    return super.y - this._baseY
  }

  set y(value: number) {
    super.y = value + this._baseY
  }

  get rotation(): number {
    return super.rotation
  }

  set rotation(value: number) {
    super.rotation = value
  }

  get scale(): PIXI.ObservablePoint {
    return super.scale
  }
}