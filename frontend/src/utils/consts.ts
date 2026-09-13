export const DEFAULT_BG_TEMPLATE = 'changeBg:%bg_path% -writeDefault -duration=750;'
export const DEFAULT_BG_TRANSFORM_TEMPLATE = 'setTransform:%me% -target=bg-main -duration=750 -writeDefault;'
export const DEFAULT_STAGE_TRANSFORM_TEMPLATE = 'setTransform:%me% -target=stage-main -duration=750 -writeDefault;'
export const DEFAULT_FIGURE_TEMPLATE = 'changeFigure:%conf_path% -id=%name% %me%;'
export const DEFAULT_TRANSFORM_TEMPLATE = 'setTransform:%me% -target=%name% -duration=750 -writeDefault;'
export const DEFAULT_IMAGE_FIGURE_TEMPLATE = 'changeFigure:%img_path% -id=%img_name% -writeDefault -duration=750;'
export const DEFAULT_IMAGE_TRANSFORM_TEMPLATE = 'setTransform:%me% -target=%img_name% -duration=750 -writeDefault;'

import type { ColorPickerTarget } from '../composables/useColorPickerModal'

// 舞台尺寸（用于预览与编辑器的统一画布尺寸）
export const STAGE_WIDTH = 2560
export const STAGE_HEIGHT = 1440

export interface FilterItemSpec<K extends string = string> {
  key?: K
  label: string
  min?: number
  max?: number
  step?: number
  boolean?: boolean
  colorPicker?: ColorPickerTarget
}
export interface FilterGroupSpec<K extends string = string> {
  title: string
  items: FilterItemSpec<K>[]
}
export const FILTER_GROUPS: FilterGroupSpec[] = [
  {
    title: '基础',
    items: [
      { key: 'blur', label: '模糊', min: 0, max: 32, step: 0.1 },
      { key: 'l2dwAlphaFilter', label: '整体透明度', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: '色彩调整',
    items: [
      { key: 'brightness', label: '亮度', min: 0, max: 2, step: 0.01 },
      { key: 'contrast', label: '对比度', min: 0, max: 2, step: 0.01 },
      { key: 'saturation', label: '饱和度', min: 0, max: 2, step: 0.01 },
      { key: 'gamma', label: '伽马', min: 0, max: 2, step: 0.01 },
      {
        label: '色彩',
        colorPicker: { rKey: 'colorRed', gKey: 'colorGreen', bKey: 'colorBlue' },
      },
    ],
  },
  {
    title: '风格化',
    items: [
      { key: 'oldFilm', label: '老电影', boolean: true },
      { key: 'dotFilm', label: '点阵', boolean: true },
      { key: 'reflectionFilm', label: '反射', boolean: true },
      { key: 'glitchFilm', label: '故障', boolean: true },
      { key: 'rgbFilm', label: 'RGB 分离', boolean: true },
      { key: 'godrayFilm', label: '体积光', boolean: true },
    ],
  },
  {
    title: '光照',
    items: [
      { key: 'bevel', label: '强度', min: 0, max: 1, step: 0.01 },
      { key: 'bevelThickness', label: '厚度', min: 0, max: 32, step: 0.1 },
      { key: 'bevelRotation', label: '角度', min: 0, max: 360, step: 1 },
      { key: 'bevelSoftness', label: '柔度', min: 0, max: 1, step: 0.01 },
      {
        label: '光色',
        colorPicker: { rKey: 'bevelRed', gKey: 'bevelGreen', bKey: 'bevelBlue' },
      },
    ],
  },
  {
    title: '辉光',
    items: [
      { key: 'bloom', label: '强度', min: 0, max: 2, step: 0.01 },
      { key: 'bloomBrightness', label: '亮度', min: 0, max: 5, step: 0.01 },
      { key: 'bloomBlur', label: '模糊', min: 0, max: 32, step: 0.1 },
      { key: 'bloomThreshold', label: '阈值', min: 0, max: 1, step: 0.01 },
    ],
  },
]
