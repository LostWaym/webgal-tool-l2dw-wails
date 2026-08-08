# L2DW — Agent 指南

Wails v2 + Vue 3 + PixiJS 桌面应用，用于加载并展示本地 Live2D 模型（Cubism 2.1 `.moc` / Cubism 3+ `.moc3`）。

## 开发注意事项

- 在搜寻代码细节的时候，常用 grep 搜寻相关关键字来找到相关文件，而不是读取粗暴的读取所有文件，减少上下文消耗。
- 本文档只记录相关模块的大概位置，不会记录具体的落地细节，具体地方需要自寻进行探索。
- 在对话的第一轮一开始必须强制添加上 **我已阅读本项目规范，现在让我来处理你的需求**

## 技术栈

- **后端**：Go 1.23 + Wails v2.10.1（`net/http`、`embed.FS`）
- **前端**：Vue 3.2（Composition API + `<script setup>`）+ Pinia 2
- **渲染**：PixiJS ^6.5.10 + pixi-live2d-display-webgal ^0.5.12
- **构建**：Vite ^3.0.7 + `vue-tsc --noEmit` 类型检查（`npm run build` 前自动执行）
- **TypeScript** ^4.6.4（严格模式）
- **Wails dev 端口**：`5173`（Vite）/ `34115`（Wails dev server，浏览器可访问）
- **Wails 启动模式**：主进程可带 `--editor` 进入"模型编辑器"窗口（标题 `L2DW - 模型编辑器`，1400×900），或附带 `--wmdl <绝对路径>` 让编辑器启动后自动加载该 wmdl 文件。

常用命令：

| 用途 | 命令 |
| --- | --- |
| 启动 dev（前端 HMR + Go 热重启） | `wails dev` |
| 构建可发布 exe | `wails build` |
| 仅构建前端 | `cd frontend && npm run build` |
| 安装前端依赖 | `cd frontend && npm install` |

## 目录结构

```
l2dw-wails/
├── app.go                       # Go 绑定：暴露给 JS 的方法（文件对话框、wmdl 读写、剪贴板等）
├── main.go                      # Wails 入口 + AssetServer 中间件；处理 --editor / --wmdl 启动参数
├── wails.json                   # Wails 项目配置
├── go.mod / go.sum              # Go 依赖
├── extres/                      # 外部资源（包括live2d模型，背景图片等…）【只读】
└── frontend/
    ├── index.html               # 入口；先加载 Live2D runtime，再加载 main.ts
    ├── package.json             # 前端脚本与依赖
    ├── vite.config.ts           # Vite 配置（仅启用 @vitejs/plugin-vue）
    ├── tsconfig.json            # TS 配置（严格模式）
    ├── scripts/                 # Wails 自动生成绑定的补丁脚本（patch-wails-models.mjs）
    ├── public/lib/              # Live2D 全局运行时（不进 npm，.gitignore 忽略）
    ├── wailsjs/                 # Wails 自动生成的 JS/TS 绑定（不要手改，.gitignore 忽略）
    └── src/
        ├── main.ts              # Vue + Pinia 启动入口；根据 AppMode() 选择挂载 App 或 ModelEditApp
        ├── App.vue              # 顶层布局（左右两栏，主窗口）
        ├── style.css            # 全局样式
        ├── components/          # UI 组件（按 App 分目录：ModelPreviewApp / ModelEditApp / common）
        ├── utils/               # 前端工具与运行时共享状态
        │   ├── consts.ts        # 默认模板（figure / transform / bg / stage）等常量
        │   ├── inst_utils.ts    # webgal-parser 封装层（外部无需看 webgal-parser）
        │   ├── wmdlUtils.ts     # wmdl JSON 解析 / 序列化 / 路径工具
        │   ├── runtimeRegistry.ts # 跨组件共享运行时引用（Pixi app / 容器 / 清理回调）
        │   └── searchUtils.ts   # 通用搜索匹配工具
        ├── assets/              # 静态资源（图标 eye.png、默认背景 default.jpg 等）
        ├── live2d/              # Live2D 加载与适配层
        │   ├── coreAdapter.ts   # 统一 Cubism 2 / Cubism 4 适配（part / motion / expression / param 增删查改）
        │   ├── L2dwContainer.ts # 自定义 PIXI 容器（含 alpha）
        │   ├── loader.ts        # 模型加载入口
        │   ├── specialIds.ts    # 主场景 / 背景容器的特殊 ID 常量
        │   └── textureUtils.ts  # 贴图工具
        └── stores/              # Pinia store
            ├── previewStore.ts  # 主窗口 store（注册名 'models'，通过 useModelStore 获取）
            ├── wmdlModelEditor.ts # 编辑器 store（注册名 'wmdlModelEditor'）
            ├── wmdlTypes.ts     # wmdl 相关数据结构定义
            └── emitter.ts       # mitt 封装的事件总线
```

## 已知问题

记录目前已知的问题，但暂不处理，通过人工避免，先保证功能跑通。

## 代码要求

### 综合信息

- PowerShell 不接受 &&。改用 ; 来分开执行
- 当用户**明确要求**测试的时候，可编写临时ts脚本，然后使用 npx tsx 脚本路径 来进行输出log进行调试测试，注意引用路径的相对关系。
- 虽然引入了 webgal-parser 库，但实际上我们通过 inst_utils.ts 对其进行了封装，所以完全不必去看任何 webgal-parser 相关的内容，只用 inst_utils.ts 里的内容即可。

### 注释限制

尽可能避免编写过长的注释，注释应当简洁干练，意图清晰。
能很简单就推断出来行为的就不要加注释，如果很难看出来的才需要加注释。

### 搜索栏准则

- 搜索栏，必须可以通过空格隔开关键字，并且是全部关键字匹配才可以。
- 如果trim后的结果是空字符串，则代表不进行搜索过滤。
- 如果没有特殊说明
  - 用来过滤列表项的则是它显示在界面上显示的标题文本。
  - 不考虑大小写

## 知识快速检索库

旨在帮助快速索引到项目里相关的知识，仅提供业务逻辑的大概位置，具体内容需自己进行推断。
可通过 grep 相关关键字来快速索引定位到具体业务逻辑选择性进行了解。
内容需尽量简短，信息密度密集。
当知识库没有命中相关知识时，需简单输出没有命中哪部分知识。例如："【检索知识库未命中: 文件浏览器 | 将自行进行相关探索】"
以协助用户尽可能地补充检索知识库。
搜索关键词指引：当用户说"文件浏览器"的时候，你可拆分成三个关键字"文件""文件浏览器""浏览器"，然后根据情况决定是否需要读取相关部分。

### 文件浏览器

- 命中关键字：文件浏览器，文件对话框
- 相关代码关键字：runPicker， FileDialog

### live2d相关

- 统一live2d访问工具类，用于统一cubism2和cubism4的模型数据增删查改: coreAdapter.ts
- wmdl 相关数据结构定义: wmdlTypes.ts
- 关键字
  - 部件: part
  - 动作: motion
  - 表情: expr, expression

### 主App （ 预览编辑器 ）

- 入口vue = App.vue
- 舞台vue = Stage.vue
- 主要组件路径 = "frontend/src/components/ModelPreviewApp"
- 相关PiniaStore = "frontend/src/stores/previewStore.ts"（注册名 `models`，通过 `useModelStore()` 获取）

### 改模编辑器相关

- 入口vue = ModelEditApp.vue（启动时通过 `--editor` 参数进入；也可附带 `--wmdl <路径>` 自动加载）
- 操作区vue = EditActionPanel.vue（页签： wmdl / 初始参数 / 部件参数 / 动作 / 表情 ...）
- 舞台vue = EditStage.vue
- 主要组件路径 = "frontend/src/components/ModelEditApp"
- 相关PiniaStore = "frontend/src/stores/wmdlModelEditor.ts"（注册名 `wmdlModelEditor`，通过 `useWmdlModelEditorStore()` 获取）
- 数据结构 = "frontend/src/stores/wmdlTypes.ts"

### 通用气泡信息功能

- 入口 = "frontend/src/composables/useMessage.ts"
- 用法: 引入useMessage后，调用 useMessage() 然后缓存起来对象，然后按需调用对象的success，info，warning，error方法即可，填入字符串参数。比如说msg.info("测试信息")
- 触发关键词：弹消息|气泡|提示

### 通用组件

- 搜索栏 = SearchInput.vue

### 工具类

- 事件分发 = "frontend/src/stores/emitter.ts"（mitt 封装）。避免从 window 注入方法，避免使用匿名函数，需考虑 on off 生命周期，尽量避免在列表项组件里使用。事件名统一在 `StageEvents` 常量中维护（避免散落字符串）。
- 运行时共享 = "frontend/src/utils/runtimeRegistry.ts"。跨组件共享 Pixi app、模型 / 特殊容器、清理回调等运行时引用。