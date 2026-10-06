# MOTION_DOC — 动作编辑器快速索引

> 用途：快速定位动作编辑器的控件与术语，减少探索成本。不记录实现细节。

**如果用户没有要求，不要修改本文档**

**本文档加载一次之后，就不需要再重新进行加载，整个会话过程中不会产生任何改变**

## 启动与入口

- 启动参数：`--motion`（进入动作编辑器）+ `--motion-wmdl <绝对路径>`（自动加载 wmdl）
- 主窗口触发：选中 Live2d 立绘按 **F3**（Stage.vue 的 onKeyDown 与 COMMON_SHORTCUT_HINTS 双处登记）
- Go 端：`app.go` 的 `OpenMotionEditor` / `AppMode` 返回 `'motion'` / `MotionWmdlPath`；窗口 1600×900
- 前端挂载：`main.ts` 按 mode 分支挂载 `MotionEditApp.vue`

## 术语 → 位置

| 术语 | 含义 | 位置 |
| --- | --- | --- |
| 预览区 | 左侧 Live2D 渲染区，固定像素宽（320~1200 可拖） | `MotionStage.vue`（薄封装 `common/Live2dPreview.vue`） |
| 轨道面板 | 右侧整体：参数行头 + 时间轴车道 | `MotionTrackPanel.vue` |
| 轨道 header / 行头 | 每行左侧的参数卡片（EditRangeCard）+ 按钮，固定列宽可拖（180~460） | `MotionTrackPanel.vue` 左列 |
| 车道 | 每行右侧的时间轴区域，双向滚动 | `MotionTrackPanel.vue` 右列 |
| 采样线 | 车道内按帧采样的折线（SVG，上下各 10% 保护带，按参数值域映射 y；帧点 y 同步跟随值） | `MotionTrackPanel.vue`，搜索栏旁「显示采样线」开关 |
| 标尺 / 刻度 | 车道顶部刻度行，可拖拽移动播放头 | `MotionTrackPanel.vue` |
| 帧点 / 关键帧点 | 车道上的蓝色圆点（关键帧） | `MotionTrackPanel.vue` |
| 播放头 / 时间轴线 | 红色竖线覆盖层，不随滚动 | `MotionTrackPanel.vue` 覆盖层 |
| 帧设置模态 | fps / 时长（帧）编辑，截帧风险确认 | `FrameSettingsModal.vue` + `useFrameSettingsModal.ts` |
| 导出模态 | 动作导出：格式（.mtn / .motion3.json）、名称、fade 时长、压缩输出 | `MotionExportModal.vue` + `useMotionExportModal.ts` |
| 渲染模态 | GIF 渲染导出：输出 fps（决定采样步长）、帧范围、尺寸（视口倍率/固定宽度）、底色、循环、色数、帧间差分 | `MotionGifRenderModal.vue` + `useMotionGifRenderModal.ts` + `utils/gifRender.ts` |
| 主 header | 顶部工具栏：播放/暂停（合并单按钮）、停止、当前帧显示（可点击开模态）、导出、渲染、保存/另存/加载 | `MotionEditApp.vue` |
| 参数预设下拉 | 搜索栏旁「预设 ▾」，按正则批量筛选参数显示（与搜索关键字共同筛选） | `MotionTrackPanel.vue` 搜索行，预设目录 `assets/motion_part_presets` |

## 交互速查

- 拖行头滑条 / 输数值 = 实时预览 + **自动建轨** + 当前帧打帧；播放中改值 → 立即打断播放
- 播放中拖播放头/时间轴线 → 暂停播放并到达拖到的帧位
- `+`/`−`（行头右上）= 增删轨道；`+` 会在当前帧插一帧
- `✕`（行头，条件显示）= 删除当前播放头帧的关键帧；**按钮出现 = 播放头正对准一帧**
- 拖车道/标尺 = 移动播放头（整数帧吸附）；双击车道 = 插帧；双击帧点 = 播放头跳到该帧；右键帧点 = 删帧
- 采样线/帧点 y = 值相对参数 [min,max] 的百分比映射（上下 10% 保护带）；拖帧/改值/缩放自动重算，播放头移动不触发
- **Ctrl + 滚轮**（车道上）= 缩放刻度密度（0.5~40 px/帧，鼠标锚点）
- 刻度密度固定（每格 ≥80px，1/2/5×10ⁿ 自动换档），不随面板宽度变化
- 车道右侧有 120px 安全距离（不参与帧映射）
- 行头显示值 = 有轨道时为当前帧采样值（随播放头刷新），无轨道为实时值
- 布局自适应：窗口缩放时时间轴吸收全部伸缩量，预览区不动
- 参数预设：格式同 part_presets 的开关版——每行 `正则=1/0`（`#` 注释，非法正则忽略），按行顺序覆盖，未匹配参数默认显示；筛选链 = 物理开关 → 预设 → 搜索；重复点同一预设取消选中；Go 绑定 `ListMotionPresetFiles` / `ReadMotionPresetFile`（目录可由 env `L2DW_MOTION_PART_PRESETS_DIR` 覆盖）

## 数据与核心文件

| 文件 | 职责 |
| --- | --- |
| `frontend/src/stores/motionEditor.ts` | 帧制数据结构 + 插值采样 + 关键帧/轨道 action + applier 桥接 |
| `frontend/src/components/MotionEditorApp/MotionEditApp.vue` | 主入口：header + 左右布局 + 播放循环（rAF 帧步进）+ 保存/加载 |
| `frontend/src/components/MotionEditorApp/MotionTrackPanel.vue` | 轨道面板全部交互与几何（帧↔像素换算、缩放、拖拽） |
| `frontend/src/components/MotionEditorApp/MotionStage.vue` | 预览区封装（注册 editRuntime） |
| `frontend/src/components/MotionEditorApp/FrameSettingsModal.vue` | 帧率/时长模态 |
| `frontend/src/components/MotionEditorApp/MotionExportModal.vue` | 导出模态（格式卡片 + fade 输入 + 保存对话框 + WriteTextFile） |
| `frontend/src/utils/motionExport.ts` | 导出格式构建：`buildMtn` / `buildMotion3Json`（纯函数，规格见 `MOTION_FORMAT.md`） |
| `frontend/src/composables/useMotionExportModal.ts` | 导出模态 reactive 单例状态（visible / format） |
| `frontend/src/components/ModelEditApp/ResizeHandle.vue` | 通用拖拽分隔条（本编辑器两处复用） |
| `frontend/src/components/ModelEditApp/EditRangeCard.vue` | 通用参数滑条卡片（行头复用） |

## 数据格式（.lanim.json）

```jsonc
{
  "version": 1,
  "name": "untitled",
  "fps": 60,               // 帧率，仅换算时间用
  "durationFrames": 180,   // 总时长（帧）
  "tracks": [
    { "paramId": "ParamEyeLOpen", "keys": [ { "frame": 0, "v": 0 }, { "frame": 60, "v": 1 } ] }
  ]
}
```

- 底层一切以**整数帧号**运算，秒只是显示换算（`frame / fps`）
- 保存/加载：打开用 `PickLanimJsonFile`（Filter `*.lanim.json`，slotMotion 目录记忆），保存用 `SaveLanimFileDialog`（Filter `*.lanim.json`，currentPath 提供默认目录/文件名）+ `SaveModelJsonFile` / `ReadTextFile`，自动补 `.lanim.json` 后缀
- 插值方式是**全局代码常量**（不存进文件）：`motionEditor.ts` 顶部 `DEFAULT_INTERP`（当前 `easeIn`，可改 linear/easeIn/easeOut/easeInOut）

## 导出（.mtn / .motion3.json）

- 入口：主 header「导出」按钮 → 导出模态；格式卡片二选一（`.motion3.json` Cubism 3+ / `.mtn` Cubism 2）
- fade 时长（ms）模态内可编辑（默认 0/1000）；「压缩输出（单行）」仅 motion3 生效
- 确认后 `SaveMotionExportFileDialog(defaultName)`（Filter `*.mtn;*.motion3.json`）选路径 + `WriteTextFile` 写入
- 生成规则：逐帧采样（`sampleTrack`）——mtn 输出值序列（全帧同值仅单值常量）；motion3 每轨道一条 `Parameter` 曲线、线性段（type 0），Meta 计数实算
- **格式规格与 lanim 映射详见 `MOTION_FORMAT.md`**；paramId 原样输出，跨 Cubism 版本喂模型时注意 ID 体系（`PARAM_X` vs `ParamX`）

## GIF 渲染

- 入口：主 header「渲染」按钮 → 渲染模态；完成后 `SaveGifFileDialog` 选路径 + `WriteBase64File` 落盘（GIF 二进制，不走 WriteTextFile）
- 输出 fps 语义 = 采样密度：步长 = `animFps / outFps`，采样帧数 = `ceil(durationFrames / 步长)`，每帧 delay = `1000 / outFps`，总时长与原动画一致（如 60fps/180帧 输出 12fps → 步长 5 → 36 帧 / 3 秒）
- 取景 = 预览视口（所见即所得，含用户平移缩放）；尺寸支持视口倍率 / 固定宽度二选一，等比输出
- 编码用 `gifenc`（非 gif.js）：全动画共享一个调色板（均匀抽至多 8 帧构建，预留 1 个透明索引位）+ 完全重复帧去重（delay 累加）+ 帧间差分（未变化像素写透明索引，dispose=1 露出上一帧；模态可关）
- 色数下拉 256/128/64/32（默认 128），越少体积越小
- 抓帧链路：`sampleLanim` → 写参数 → **逐模型 `model.update(1000/60)`**（关键！模型视觉求值只发生在 update 里，ticker 的 autoUpdate 与抓帧节奏无关，不手动 update 会抓到重复帧）→ `captureViewportFrame`（手动 render + 不透明底色重绘到离屏 canvas）
- 抓帧桥接：`MotionEditApp` watch stageRef 注册到 `useMotionGifRenderModal` 的 bridge（applyParameters / captureViewportFrame / getViewportPixelSize）；`Live2dPreview` expose `captureViewportFrame` / `getViewportPixelSize`，`MotionStage` expose `getPreview()`
- Go 绑定：`SaveGifFileDialog(defaultName)` + `WriteBase64File(path, base64)`（app.go，通用二进制落盘）

## 气泡消息

- `MotionEditApp.vue` 顶层挂了 `<MessageHost />`（common 组件），保存/加载/导出/帧设置的 `useMessage` 气泡依赖它渲染，漏挂则消息进队列但不显示

## 注意点（踩过的坑）

- 播放头覆盖层定位必须用 `lanesEl.offsetLeft`（`lanesOffsetX`）而非写死行头宽度——中间隔着 4px ResizeHandle，偏移会导致刻度与红线错位
- 播放头 z-index 必须低于行头列（heads z-4 > playhead z-2），否则红线横穿参数卡片
- 行高是固定像素（标尺 26 / 行 70），行头与车道靠 `@scroll` 的 translateY 同步，改行高要两列同步改（`RULER_H` / `ROW_H` 常量）
- `Live2dPreview` 加载时已传 `idleMotionGroup:''` + `autoInteract:false`，外部写参数不会被 motion 覆盖
- `Live2dPreview` 的重载 watch 是**模型组指纹**（`id:jsonAbsPath`）而非 deep watch——深层编辑（initParams 等）不会触发重载；`loadWmdlModels` 内有 loadSeq token 防晚到竞态；`MotionStage` 的 runtime 同步 watch 用同款指纹（不要改回 `models.length`，否则重载后 Map 指向已销毁的旧实例）
- 修改 Go 绑定后需 `wails generate module` 重新生成 wailsjs
