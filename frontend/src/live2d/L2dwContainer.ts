import * as PIXI from 'pixi.js'
import { filters as pixiFilters } from 'pixi.js'
import {
  AdjustmentFilter,
  AdvancedBloomFilter,
  DotFilter,
  GlitchFilter,
  GodrayFilter,
  OldFilmFilter,
  RGBSplitFilter,
  ReflectionFilter,
} from 'pixi-filters'
import { BevelFilter } from './BevelFilter'

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
 *
 * 滤镜：
 *   - 滤镜系统参考 WebGAL 的 WebGALPixiContainer；默认全空，不挂任何 PIXI.Filter。
 *   - 通过 `FILTER_CONFIGS` 注册可启用滤镜；通过 `PROPERTY_CONFIGS` 暴露属性 getter/setter。
 *   - **不实现**：`shockwave` / `radiusAlpha`（按需求作废）。
 *   - `alpha`（继承自 `PIXI.Container`）保持默认递归子容器行为不动；新增的"整容器 alpha 滤镜"
 *     改名为 `l2dwAlphaFilter`，避免与父类 `alpha` 字段冲突。
 */
export class L2dwContainer extends PIXI.Container {
  private _baseX = 0
  private _baseY = 0

  private _l2dwAlphaFilter = new pixiFilters.AlphaFilter(1)
  private _containerFilters = new Map<string, PIXI.Filter>()
  private _filterToName = new Map<PIXI.Filter, string>()

  constructor() {
    super()
    this._addInternalFilter(this._l2dwAlphaFilter)
  }

  // ───────── 基位置 / 变换（保留旧行为） ─────────

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

  // ───────── 滤镜 getter / setter ─────────

  // 整容器 alpha（不与 PIXI.Container.alpha 冲突）
  get l2dwAlphaFilter(): number {
    return this._l2dwAlphaFilter.alpha
  }
  set l2dwAlphaFilter(v: number) {
    this._l2dwAlphaFilter.alpha = v
  }

  get blur(): number { return this._getPropertyValue('blur') }
  set blur(v: number) { this._setPropertyValue('blur', v) }

  get brightness(): number { return this._getPropertyValue('brightness') }
  set brightness(v: number) { this._setPropertyValue('brightness', v) }

  get contrast(): number { return this._getPropertyValue('contrast') }
  set contrast(v: number) { this._setPropertyValue('contrast', v) }

  get saturation(): number { return this._getPropertyValue('saturation') }
  set saturation(v: number) { this._setPropertyValue('saturation', v) }

  get gamma(): number { return this._getPropertyValue('gamma') }
  set gamma(v: number) { this._setPropertyValue('gamma', v) }

  get colorRed(): number { return this._getPropertyValue('colorRed') }
  set colorRed(v: number) { this._setPropertyValue('colorRed', v) }

  get colorGreen(): number { return this._getPropertyValue('colorGreen') }
  set colorGreen(v: number) { this._setPropertyValue('colorGreen', v) }

  get colorBlue(): number { return this._getPropertyValue('colorBlue') }
  set colorBlue(v: number) { this._setPropertyValue('colorBlue', v) }

  get oldFilm(): number { return this._getPropertyValue('oldFilm') }
  set oldFilm(v: number) { this._setPropertyValue('oldFilm', v) }

  get dotFilm(): number { return this._getPropertyValue('dotFilm') }
  set dotFilm(v: number) { this._setPropertyValue('dotFilm', v) }

  get reflectionFilm(): number { return this._getPropertyValue('reflectionFilm') }
  set reflectionFilm(v: number) { this._setPropertyValue('reflectionFilm', v) }

  get glitchFilm(): number { return this._getPropertyValue('glitchFilm') }
  set glitchFilm(v: number) { this._setPropertyValue('glitchFilm', v) }

  get rgbFilm(): number { return this._getPropertyValue('rgbFilm') }
  set rgbFilm(v: number) { this._setPropertyValue('rgbFilm', v) }

  get godrayFilm(): number { return this._getPropertyValue('godrayFilm') }
  set godrayFilm(v: number) { this._setPropertyValue('godrayFilm', v) }

  get bevel(): number { return this._getPropertyValue('bevel') }
  set bevel(v: number) { this._setPropertyValue('bevel', v) }

  get bevelThickness(): number { return this._getPropertyValue('bevelThickness') }
  set bevelThickness(v: number) { this._setPropertyValue('bevelThickness', v) }

  get bevelRotation(): number { return this._getPropertyValue('bevelRotation') }
  set bevelRotation(v: number) { this._setPropertyValue('bevelRotation', v) }

  get bevelSoftness(): number { return this._getPropertyValue('bevelSoftness') }
  set bevelSoftness(v: number) { this._setPropertyValue('bevelSoftness', v) }

  get bevelRed(): number { return this._getPropertyValue('bevelRed') }
  set bevelRed(v: number) { this._setPropertyValue('bevelRed', v) }

  get bevelGreen(): number { return this._getPropertyValue('bevelGreen') }
  set bevelGreen(v: number) { this._setPropertyValue('bevelGreen', v) }

  get bevelBlue(): number { return this._getPropertyValue('bevelBlue') }
  set bevelBlue(v: number) { this._setPropertyValue('bevelBlue', v) }

  get bloom(): number { return this._getPropertyValue('bloom') }
  set bloom(v: number) { this._setPropertyValue('bloom', v) }

  get bloomBrightness(): number { return this._getPropertyValue('bloomBrightness') }
  set bloomBrightness(v: number) { this._setPropertyValue('bloomBrightness', v) }

  get bloomBlur(): number { return this._getPropertyValue('bloomBlur') }
  set bloomBlur(v: number) { this._setPropertyValue('bloomBlur', v) }

  get bloomThreshold(): number { return this._getPropertyValue('bloomThreshold') }
  set bloomThreshold(v: number) { this._setPropertyValue('bloomThreshold', v) }

  // ───────── 内部 ─────────

  private _addInternalFilter(filter: PIXI.Filter): void {
    if (!this.filters) {
      this.filters = [filter]
    } else {
      this.filters.push(filter)
    }
  }

  private _removeFilterByName(filterName: string): void {
    const filter = this._containerFilters.get(filterName)
    if (!filter || !this.filters) return
    const idx = this.filters.indexOf(filter)
    if (idx !== -1) this.filters.splice(idx, 1)
    this._containerFilters.delete(filterName)
    this._filterToName.delete(filter)
  }

  private _removeIfDefault(filterName: string): void {
    const inst = this._containerFilters.get(filterName)
    const cfg = FILTER_CONFIGS[filterName]
    if (inst && cfg?.isDefault && cfg.isDefault(inst)) {
      this._removeFilterByName(filterName)
    }
  }

  private _ensureFilterByName<T extends PIXI.Filter>(filterName: string): T {
    let inst = this._containerFilters.get(filterName) as T | undefined
    if (inst) return inst
    const cfg = FILTER_CONFIGS[filterName]
    if (!cfg) throw new Error(`Unknown filter configuration: ${filterName}`)
    inst = cfg.create() as T
    this._insertFilterWithPriority(filterName, inst)
    return inst
  }

  private _insertFilterWithPriority(name: string, filter: PIXI.Filter): void {
    const priority = FILTER_CONFIGS[name]?.priority ?? 0

    if (!this.filters || this.filters.length === 0) {
      this.filters = [filter]
    } else {
      let insertIndex = this.filters.length
      for (let i = 0; i < this.filters.length; i++) {
        const currentFilter = this.filters[i]!
        if (currentFilter === this._l2dwAlphaFilter) {
          insertIndex = i
          break
        }
        const currentName = this._filterToName.get(currentFilter)
        if (currentName) {
          const currentPriority = FILTER_CONFIGS[currentName]?.priority ?? 0
          if (priority > currentPriority) {
            insertIndex = i
            break
          }
        } else {
          if (priority > 0) {
            insertIndex = i
            break
          }
        }
      }
      this.filters.splice(insertIndex, 0, filter)
    }
    this._containerFilters.set(name, filter)
    this._filterToName.set(filter, name)
  }

  private _getPropertyValue(propertyName: string): number {
    const propConfig = PROPERTY_CONFIGS[propertyName]
    if (!propConfig) {
      console.warn(`L2dwContainer: unknown property getter: ${propertyName}`)
      return 0
    }
    if (propConfig.isBoolean) {
      return this._containerFilters.has(propConfig.filterName) ? 1 : 0
    }
    const filterInstance = this._containerFilters.get(propConfig.filterName)
    if (propConfig.overrideGet) {
      return propConfig.overrideGet(filterInstance, propConfig.defaultValue)
    }
    if (filterInstance && propConfig.filterProperty) {
      return (filterInstance as any)[propConfig.filterProperty]
    }
    return propConfig.defaultValue
  }

  private _setPropertyValue(propertyName: string, value: number): void {
    const propConfig = PROPERTY_CONFIGS[propertyName]
    if (!propConfig) {
      console.warn(`L2dwContainer: unknown property setter: ${propertyName}`)
      return
    }
    if (propConfig.isBoolean) {
      if (value === 0 || value === undefined || value === null) {
        this._removeFilterByName(propConfig.filterName)
      } else {
        if (!this._containerFilters.has(propConfig.filterName)) {
          this._ensureFilterByName(propConfig.filterName)
        }
      }
      return
    }
    if (value === propConfig.defaultValue && !this._containerFilters.has(propConfig.filterName)) {
      return
    }
    const filterInstance = this._ensureFilterByName<any>(propConfig.filterName)
    if (propConfig.overrideSet) {
      propConfig.overrideSet(value, filterInstance)
    } else if (propConfig.filterProperty) {
      ;(filterInstance as any)[propConfig.filterProperty] = value
    } else {
      console.warn(
        `L2dwContainer: property '${propertyName}' has neither overrideSet nor filterProperty.`,
      )
    }
    this._removeIfDefault(propConfig.filterName)
  }
}

// ───────── 滤镜 / 属性配置（模块级） ─────────

const enum FilterPriority {
  ReflectionFilm,
  Blur,
  RgbFilm,
  DotFilm,
  GlitchFilm,
  OldFilm,
  GodrayFilm,
  Bloom,
  Bevel,
  Adjustment,
}

interface FilterConfig {
  priority: number
  create: () => PIXI.Filter
  isDefault?: (f: PIXI.Filter) => boolean
}

interface PropertyConfig {
  filterName: string
  filterProperty?: string
  defaultValue: number
  isBoolean?: boolean
  overrideSet?: (value: number, filter: PIXI.Filter) => void
  overrideGet?: (filter: PIXI.Filter | undefined, defaultValue: number) => number
}

const FILTER_CONFIGS: Record<string, FilterConfig> = {
  blur: {
    priority: FilterPriority.Blur,
    create: () => {
      const f = new pixiFilters.BlurFilter()
      f.blur = 0
      return f
    },
    isDefault: (f) => (f as InstanceType<typeof pixiFilters.BlurFilter>).blur === 0,
  },
  oldFilm: {
    priority: FilterPriority.OldFilm,
    create: () => new OldFilmFilter(),
  },
  dotFilm: {
    priority: FilterPriority.DotFilm,
    create: () => new DotFilter(),
  },
  reflectionFilm: {
    priority: FilterPriority.ReflectionFilm,
    create: () => new ReflectionFilter(),
  },
  glitchFilm: {
    priority: FilterPriority.GlitchFilm,
    create: () => new GlitchFilter(),
  },
  rgbFilm: {
    priority: FilterPriority.RgbFilm,
    create: () => new RGBSplitFilter(),
  },
  godrayFilm: {
    priority: FilterPriority.GodrayFilm,
    create: () => new GodrayFilter(),
  },
  adjustment: {
    priority: FilterPriority.Adjustment,
    create: () => new AdjustmentFilter(),
    isDefault: (f) => {
      const a = f as AdjustmentFilter
      return (
        a.brightness === 1 &&
        a.contrast === 1 &&
        a.saturation === 1 &&
        a.gamma === 1 &&
        a.red === 1 &&
        a.green === 1 &&
        a.blue === 1
      )
    },
  },
  bevel: {
    priority: FilterPriority.Bevel,
    create: () => {
      const f = new BevelFilter()
      // lightAlpha / thickness / rotation / softness / lightColor / shadowAlpha
      // 已在 BevelFilter 构造时设为 0/0/0/0/0xffffff/0，等价"无效果"
      return f
    },
    isDefault: (f) => {
      const b = f as BevelFilter
      return (
        b.lightAlpha === 0 &&
        b.thickness === 0 &&
        b.rotation === 0 &&
        b.softness === 0 &&
        b.lightColor === 0xffffff &&
        b.shadowAlpha === 0
      )
    },
  },
  bloom: {
    priority: FilterPriority.Bloom,
    create: () => {
      const f = new AdvancedBloomFilter()
      f.bloomScale = 0
      f.brightness = 1
      f.blur = 0
      f.threshold = 0
      return f
    },
    isDefault: (f) => {
      const ab = f as AdvancedBloomFilter
      return ab.bloomScale === 0 && ab.brightness === 1 && ab.blur === 0 && ab.threshold === 0
    },
  },
}

const PROPERTY_CONFIGS: Record<string, PropertyConfig> = {
  blur: { filterName: 'blur', filterProperty: 'blur', defaultValue: 0 },
  brightness: { filterName: 'adjustment', filterProperty: 'brightness', defaultValue: 1 },
  contrast: { filterName: 'adjustment', filterProperty: 'contrast', defaultValue: 1 },
  saturation: { filterName: 'adjustment', filterProperty: 'saturation', defaultValue: 1 },
  gamma: { filterName: 'adjustment', filterProperty: 'gamma', defaultValue: 1 },
  colorRed: {
    filterName: 'adjustment',
    defaultValue: 255,
    overrideSet: (value, filter) => {
      ;(filter as AdjustmentFilter).red = value / 255
    },
    overrideGet: (filter, defaultValue) => (filter ? (filter as AdjustmentFilter).red * 255 : defaultValue),
  },
  colorGreen: {
    filterName: 'adjustment',
    defaultValue: 255,
    overrideSet: (value, filter) => {
      ;(filter as AdjustmentFilter).green = value / 255
    },
    overrideGet: (filter, defaultValue) => (filter ? (filter as AdjustmentFilter).green * 255 : defaultValue),
  },
  colorBlue: {
    filterName: 'adjustment',
    defaultValue: 255,
    overrideSet: (value, filter) => {
      ;(filter as AdjustmentFilter).blue = value / 255
    },
    overrideGet: (filter, defaultValue) => (filter ? (filter as AdjustmentFilter).blue * 255 : defaultValue),
  },
  oldFilm: { filterName: 'oldFilm', defaultValue: 0, isBoolean: true },
  dotFilm: { filterName: 'dotFilm', defaultValue: 0, isBoolean: true },
  reflectionFilm: { filterName: 'reflectionFilm', defaultValue: 0, isBoolean: true },
  glitchFilm: { filterName: 'glitchFilm', defaultValue: 0, isBoolean: true },
  rgbFilm: { filterName: 'rgbFilm', defaultValue: 0, isBoolean: true },
  godrayFilm: { filterName: 'godrayFilm', defaultValue: 0, isBoolean: true },
  bevel: { filterName: 'bevel', filterProperty: 'lightAlpha', defaultValue: 0 },
  bevelThickness: { filterName: 'bevel', filterProperty: 'thickness', defaultValue: 0 },
  bevelRotation: { filterName: 'bevel', filterProperty: 'rotation', defaultValue: 0 },
  bevelSoftness: { filterName: 'bevel', filterProperty: 'softness', defaultValue: 0 },
  bevelRed: {
    filterName: 'bevel',
    defaultValue: 255,
    overrideSet: (value, filter) => {
      const b = filter as BevelFilter
      const g = (b.lightColor >> 8) & 0xff
      const bl = b.lightColor & 0xff
      b.lightColor = (value << 16) | (g << 8) | bl
    },
    overrideGet: (filter, defaultValue) => {
      if (filter) return ((filter as BevelFilter).lightColor >> 16) & 0xff
      return defaultValue
    },
  },
  bevelGreen: {
    filterName: 'bevel',
    defaultValue: 255,
    overrideSet: (value, filter) => {
      const b = filter as BevelFilter
      const r = (b.lightColor >> 16) & 0xff
      const bl = b.lightColor & 0xff
      b.lightColor = (r << 16) | (value << 8) | bl
    },
    overrideGet: (filter, defaultValue) => {
      if (filter) return ((filter as BevelFilter).lightColor >> 8) & 0xff
      return defaultValue
    },
  },
  bevelBlue: {
    filterName: 'bevel',
    defaultValue: 255,
    overrideSet: (value, filter) => {
      const b = filter as BevelFilter
      const r = (b.lightColor >> 16) & 0xff
      const g = (b.lightColor >> 8) & 0xff
      b.lightColor = (r << 16) | (g << 8) | value
    },
    overrideGet: (filter, defaultValue) => {
      if (filter) return (filter as BevelFilter).lightColor & 0xff
      return defaultValue
    },
  },
  bloom: { filterName: 'bloom', filterProperty: 'bloomScale', defaultValue: 0 },
  bloomBrightness: { filterName: 'bloom', filterProperty: 'brightness', defaultValue: 1 },
  bloomBlur: { filterName: 'bloom', filterProperty: 'blur', defaultValue: 0 },
  bloomThreshold: { filterName: 'bloom', filterProperty: 'threshold', defaultValue: 0 },
}

/** 列出一个 id 对应容器内全部"可读属性"当前值，便于 store / UI 双向同步。 */
export const FILTER_PROPERTY_KEYS = Object.keys(PROPERTY_CONFIGS)

/** 默认值快照（不包含 l2dwAlphaFilter；该字段独立管理） */
export const DEFAULT_FILTER_PROPERTY_VALUES: Record<string, number> = Object.fromEntries(
  Object.entries(PROPERTY_CONFIGS).map(([key, cfg]) => [key, cfg.defaultValue]),
)