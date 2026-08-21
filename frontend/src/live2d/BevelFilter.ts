import * as PIXI from 'pixi.js'
import { MotionBlurFilter } from 'pixi-filters'

// WebGAL 上游依赖的 DEG_TO_RAD，本项目直接 inline 避免引 @pixi/math
const DEG_TO_RAD = Math.PI / 180

interface BevelFilterUniforms {
  uSampler: PIXI.Texture
  mask: PIXI.Texture
  filterArea: PIXI.Rectangle
  transformX: number
  transformY: number
  lightColor: Float32Array
  lightAlpha: number
  shadowColor: Float32Array
  shadowAlpha: number
}

interface BevelFilterOptions {
  rotation: number
  thickness: number
  lightColor: number
  lightAlpha: number
  shadowColor: number
  shadowAlpha: number
}

const FRAG = `precision mediump float;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D mask;
uniform vec4 filterArea;

uniform float transformX;
uniform float transformY;
uniform vec3 lightColor;
uniform float lightAlpha;
uniform vec3 shadowColor;
uniform float shadowAlpha;

void main(void) {
    vec2 transform = vec2(1.0 / filterArea) * vec2(transformX, transformY);
    vec4 color = texture2D(uSampler, vTextureCoord);
    float light = texture2D(mask, vTextureCoord - transform).a;
    float shadow = texture2D(mask, vTextureCoord + transform).a;

    // 滤色
    color.rgb = mix(color.rgb, vec3(1.0) - (vec3(1.0) - color.rgb) * (vec3(1.0) - lightColor), clamp((color.a - light) * lightAlpha, 0.0, 1.0));
    // 正片叠底(相乘)
    color.rgb = mix(color.rgb, color.rgb * shadowColor, clamp((color.a - shadow) * shadowAlpha, 0.0, 1.0));

    gl_FragColor = vec4(color.rgb, color.a);
}`

// 上游 @pixi/utils 的 rgb2hex/hex2rgb 简化版：写入前 3 个分量。
function rgb2hex(arr: Float32Array): number {
  const r = Math.round(arr[0] * 255)
  const g = Math.round(arr[1] * 255)
  const b = Math.round(arr[2] * 255)
  return (r << 16) | (g << 8) | b
}

function hex2rgb(value: number, out: Float32Array): void {
  out[0] = ((value >> 16) & 0xff) / 255
  out[1] = ((value >> 8) & 0xff) / 255
  out[2] = (value & 0xff) / 255
}

/**
 * BevelFilter —— 直接移植自 WebGAL 上游 [`shaders/BevelFilter.ts`]()。
 * 与 npm 上的 pixi-filters@4 BevelFilter 不同：上游用 MotionBlurFilter 做 softness 预模糊，
 * 并用滤色 / 正片叠底两段合成高光与阴影，所以保留上游 shader 行为，避免被 npm 包覆盖。
 */
export class BevelFilter extends PIXI.Filter {
  private _thickness = 0
  private _angle = 0
  private _softness = 0
  private _blurFilter: MotionBlurFilter

  constructor(options?: Partial<BevelFilterOptions>) {
    super(null as any, FRAG)

    this.uniforms.lightColor = new Float32Array(3)
    this.uniforms.shadowColor = new Float32Array(3)

    // 让透明边外有 1px padding，shader 内 light/shadow 采样才能拿到正确的 alpha 邻居
    this.padding = 1

    this._blurFilter = new MotionBlurFilter()
    this._blurFilter.kernelSize = 11

    Object.assign(
      this,
      {
        rotation: 0,
        thickness: 0,
        lightColor: 0xffffff,
        lightAlpha: 0,
        shadowColor: 0x000000,
        shadowAlpha: 0,
      },
      options,
    )
  }

  // eslint-disable-next-line max-params
  apply(
    filterManager: PIXI.FilterSystem,
    input: PIXI.RenderTexture,
    output: PIXI.RenderTexture,
    clearMode?: PIXI.CLEAR_MODES,
    _currentState?: PIXI.FilterState,
  ): void {
    if (this.softness > 0) {
      const blurTexture = filterManager.getFilterTexture()
      this._blurFilter.apply(filterManager, input, blurTexture, PIXI.CLEAR_MODES.YES)

      this.uniforms.mask = blurTexture
      filterManager.applyFilter(this, input, output, clearMode)

      filterManager.returnFilterTexture(blurTexture)
    } else {
      this.uniforms.mask = input
      filterManager.applyFilter(this, input, output, clearMode)
    }
  }

  private _updateTransform(): void {
    this.uniforms.transformX = this._thickness * Math.cos(this._angle)
    this.uniforms.transformY = this._thickness * Math.sin(this._angle)
  }

  private _updateBlur(): void {
    this._blurFilter.velocity.set(
      Math.cos(this._angle) * this.thickness * this.softness * -1,
      Math.sin(this._angle) * this.thickness * this.softness * -1,
    )
  }

  get rotation(): number {
    return this._angle / DEG_TO_RAD
  }
  set rotation(value: number) {
    this._angle = value * DEG_TO_RAD
    this._updateTransform()
    this._updateBlur()
  }

  get thickness(): number {
    return this._thickness
  }
  set thickness(value: number) {
    this._thickness = value
    this._updateTransform()
    this._updateBlur()
  }

  get softness(): number {
    return this._softness
  }
  set softness(value: number) {
    this._softness = Math.min(Math.max(value, 0), 1)
    this._updateBlur()
  }

  get lightColor(): number {
    return rgb2hex(this.uniforms.lightColor)
  }
  set lightColor(value: number) {
    hex2rgb(value, this.uniforms.lightColor)
  }

  get lightAlpha(): number {
    return this.uniforms.lightAlpha
  }
  set lightAlpha(value: number) {
    this.uniforms.lightAlpha = value
  }

  get shadowColor(): number {
    return rgb2hex(this.uniforms.shadowColor)
  }
  set shadowColor(value: number) {
    hex2rgb(value, this.uniforms.shadowColor)
  }

  get shadowAlpha(): number {
    return this.uniforms.shadowAlpha
  }
  set shadowAlpha(value: number) {
    this.uniforms.shadowAlpha = value
  }
}