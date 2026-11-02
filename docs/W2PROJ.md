# 预览项目（.w2proj）

预览编辑器的 JSON 项目文件，保存立绘、立绘组、背景与主场景、变换快照及模板等状态；字段以代码为准。资源只保存路径，不打包，外部文件变化可能影响加载结果。

## 保存内容

- **立绘列表**：顺序、类型、名称、可见性、模型或图片路径、变换、滤镜、动作、表情、眨眼、注视，以及忽略立绘组选中选项。Live2D 还保存指令模板、运行时 bounds 和子模型路径等信息。
- **立绘组**：名称、锚点、目标立绘与嵌套组，以及背景、全部立绘、主场景指令和仅编辑锚点等选项。
- **背景与主场景**：背景图片路径、各自的变换与滤镜，以及背景和主场景的指令模板。
- **变换快照**：全部快照的名称与变换数据。
- **图片立绘模板**：全局立绘模板和变换模板。

## 代码索引

- **界面与确认**：`frontend/src/components/ModelPreviewApp/Modal/PreviewProjectModal.vue`；药丸入口在 `ModelList.vue`，舞台重建在 `frontend/src/App.vue`。
- **格式、保存与加载**：`frontend/src/utils/previewProject.ts`，搜索 `PreviewProject`、`savePreviewProject`、`choosePreviewProject`、`applyPreviewProject`、`validate`。
- **资源路径**：项目路径换算使用 `frontend/src/path_utils.ts`；文件对话框与缺失文件检查在 `app.go`，搜索 `PreviewProjectFile`、`MissingPreviewProjectFiles`。
- **舞台恢复**：`frontend/src/components/ModelPreviewApp/Stage.vue`，搜索 `init`、`loadOne`；项目状态归 `frontend/src/stores/previewStore.ts`。

## 操作边界

- 保存使用另存为；加载前展示清单，确认后覆盖当前项目状态。
- 缺失资源会警告，用户可取消或继续；不保存选中项、搜索词等界面状态。
- 项目格式或加载行为变化时同步更新本索引，不在此重复维护字段清单或实现流程。
