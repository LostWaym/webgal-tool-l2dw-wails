/**
 * 魔术 ID 常量集合
 * - Stage.vue、ModelList.vue、ModelActionPanel.vue 中所有"非真实模型"的占位项 id
 *   必须从这里引用，禁止在其它地方硬编码字符串。
 * - 占位项不对应 store.models 数组中的任何元素，只参与 selectedId 流转。
 */
export const SpecialId = {
  StageMain: '__stage_main__',
  BgContainer: '__bg_container__',
} as const

export type SpecialIdValue = typeof SpecialId[keyof typeof SpecialId]

export const SPECIAL_IDS: readonly SpecialIdValue[] = [
  SpecialId.StageMain,
  SpecialId.BgContainer,
]

export function isSpecialId(id: string | null | undefined): id is SpecialIdValue {
  return id === SpecialId.StageMain || id === SpecialId.BgContainer
}

export function getSpecialName(id: SpecialIdValue): string {
  return id === SpecialId.StageMain ? '*主场景*' : '*背景*'
}
