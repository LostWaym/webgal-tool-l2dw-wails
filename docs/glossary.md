# 项目术语与入口

本文用于快速定位概念、模块入口和职责归属；具体行为以当前代码为准。

## 维护规范

- 收录项目特有或容易混淆的概念、别名、入口和归属；不为每个功能按钮或资源实例单独建条目。
- 每条以「术语 / 别名：简短定义 + 关键入口 + 必要归属」为主；相关概念就近合并。
- 不复述字段、算法、调用流程、布局或开发历史；已有条目足以定位时不扩写。
- 新增概念或入口、职责变化、功能移除时按需更新；普通功能改动不强制新增条目。
- 通用约束归 `AGENTS.md`，工具链坑点归 `docs/development_pitfalls.md`；不重复抄录。
- 先按关键词定位，再读取相关代码；若不能帮助找到正确入口，就不应收录。

## 基础与工具

- **文件浏览器 / 文件对话框**：原生文件选择入口在 `app.go`，搜索 `runPicker`、`FileDialog`。
- **Live2D / 部件 / 动作 / 表情**：`frontend/src/live2d/coreAdapter.ts` 统一 Cubism 2 与 Cubism 4 的数据访问；代码关键词为 part、motion、expr、expression。
- **wmdl**：模型配置与数据结构分别在 `frontend/src/utils/wmdlUtils.ts`、`frontend/src/stores/wmdlTypes.ts`。
- **RTS**：通常指 rotation（旋转）、translate（位置）、scale（缩放）。
- **事件分发**：`frontend/src/stores/emitter.ts` 是 mitt 封装和 `StageEvents` 入口。
- **运行时共享**：`frontend/src/utils/runtimeRegistry.ts` 保存跨组件的 Pixi、容器、模型及清理引用。
- **指令解析**：`frontend/src/utils/inst_utils.ts` 是 webgal-parser 的项目封装入口。

## 预览编辑器

- **主 App / 预览编辑器**：`frontend/src/App.vue` 为入口，`frontend/src/components/ModelPreviewApp/Stage.vue` 为舞台；状态由 `frontend/src/stores/previewStore.ts` 管理。
- **立绘列表**：`frontend/src/components/ModelPreviewApp/ModelList.vue`，包含模型、图片立绘、立绘组和特殊场景项。
- **操作区 / 页签 / 页签内容**：`frontend/src/components/ModelPreviewApp/ModelActionPanel.vue`；页签位于操作区上方，选中后显示对应内容。
- **GRS**：预览舞台对立绘等对象的快捷键变换操作，入口为 `frontend/src/components/ModelPreviewApp/Stage.vue`。
- **立绘组 / 立绘组快捷键复制**：数据归预览 store 管理；复制分发入口为 `frontend/src/composables/useShortcuts.ts` 的 `runShortcutForFigureGroup`。
- **背景 / 历史背景**：背景入口在立绘列表；历史界面与状态控制分别为 `frontend/src/components/ModelPreviewApp/Modal/BackgroundHistoryModal.vue`、`frontend/src/composables/useBackgroundHistoryModal.ts`，历史数据归预览 store。
- **变换快照**：数据归预览 store；界面和状态控制分别在 `frontend/src/components/ModelPreviewApp/Modal/TransformSnapshotModal.vue`、`frontend/src/composables/useTransformSnapshotModal.ts`。
- **预览项目 / w2proj**：项目界面在 `frontend/src/components/ModelPreviewApp/Modal/PreviewProjectModal.vue`，序列化与加载入口在 `frontend/src/utils/previewProject.ts`；索引见 `docs/W2PROJ.md`。
- **可折叠块 / 拖动滚动参考**：预览操作区的动作、表情块支持折叠、视口滚动与鼠标竖向拖动。

## 其他编辑器

- **改模编辑器 / 模型编辑器**：`frontend/src/components/ModelEditApp/ModelEditApp.vue` 为入口；舞台和操作区在同目录的 `EditStage.vue`、`EditActionPanel.vue`；状态在 `frontend/src/stores/wmdlModelEditor.ts`。
- **演出编辑器**：`frontend/src/components/ActorEditorApp/ActorEditApp.vue` 为入口；舞台与面板是同目录的 `ActorStage.vue`、`EditPanel.vue`；与改模编辑器共用 store 定义，但按 Pinia app 实例隔离；导出状态在 `frontend/src/composables/useActorEditorState.ts`。
- **动作编辑器**：入口为 `frontend/src/components/MotionEditorApp/MotionEditApp.vue`；开发前优先查阅 `docs/MOTION_DOC.md`，格式参考见 `docs/MOTION_FORMAT.md`。

## 通用组件

- **弹消息 / 气泡 / 提示**：`frontend/src/composables/useMessage.ts` 导出 `useMessage()`，提供 success、info、warning、error。
- **搜索栏**：`frontend/src/components/common/SearchInput.vue`；搜索规则见 `AGENTS.md`。
- **轻量数值输入**：`frontend/src/components/common/NumberInput.vue`，用于展示态文本与点击编辑。
- **拖拽调参输入**：`frontend/src/components/ModelEditApp/EditRangeCard.vue`，用于带重置和标签拖拽的数值调节。
- **通用模态模式**：`frontend/src/composables/useXxxModal.ts` 管理状态，Modal 组件通过 Teleport 挂载；可参考背景历史或滤镜预设。
