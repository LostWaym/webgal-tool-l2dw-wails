import { reactive } from 'vue'

/**
 * 全局"颜色代码输入"模态控制状态。
 *
 * 通过 reactive 单例共享，让 ColorPicker 点击"#"触发 open()，
 * 并在 App.vue 顶层挂载 ColorPickerModal 来消费 visible。
 *
 * 来源字段上下文（用于确认后拆分 R/G/B 写回 store）：
 * - 复用同一个 modal 弹窗，但不同 ColorPicker 触发的"目标字段"不同；
 * - open() 时传入 colorPicker 配置（rKey/gKey/bKey 都是 FilterState 的字段名）。
 */

export interface RGBColor {
  r: number
  g: number
  b: number
}

/** 三段 RGB 各自对应的 store 字段名（FilterState 字段） */
export interface ColorPickerTarget {
  rKey: string
  gKey: string
  bKey: string
}

export interface ColorPickerModalState {
  visible: boolean
  current: RGBColor
  target: ColorPickerTarget | null
}

const state = reactive<ColorPickerModalState>({
  visible: false,
  current: { r: 255, g: 255, b: 255 },
  target: null,
})

/**
 * 由打开弹窗的一方（ModelActionPanel）注册；ColorPickerModal 在解析成功后回调。
 * 之所以做成回调而不是 vue emit 事件：
 * 因为 ColorPickerModal 挂在 App.vue 顶层，跨组件不直接父子，emit 不便传递。
 */
let onConfirmHandler: ((color: RGBColor) => void) | null = null

export function useColorPickerModal() {
  return {
    state,
    open(target: ColorPickerTarget, current: RGBColor) {
      state.target = target
      state.current = { ...current }
      state.visible = true
    },
    close() {
      state.visible = false
      state.target = null
    },
    /** 由触发弹窗的一方注册；ColorPickerModal 在 confirm 时调用 */
    setOnConfirm(handler: (color: RGBColor) => void) {
      onConfirmHandler = handler
    },
    /** ColorPickerModal.vue 调用：把解析后的 RGB 传给订阅方 */
    triggerConfirm(color: RGBColor) {
      onConfirmHandler?.(color)
    },
  }
}
