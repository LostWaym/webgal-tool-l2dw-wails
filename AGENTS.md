# L2DW — Agent 指南

Wails v2 + Vue 3 + PixiJS 桌面应用，用于加载并展示本地 Live2D 模型（Cubism 2.1 `.moc` / Cubism 3+ `.moc3`）。

## 开发注意事项

- 在搜寻代码细节的时候，常用 grep 搜寻相关关键字来找到相关文件，而不是读取粗暴的读取所有文件，减少上下文消耗。
- 本文档只记录相关模块的大概位置，不会记录具体的落地细节，具体地方需要自寻进行探索。
- 在对话的第一轮一开始必须强制添加上 **我已阅读本项目规范，现在让我来处理你的需求**

## 技术栈

- **后端**：Go 1.23 + Wails v2.10.1（`net/http`、`embed.FS`）
- **前端**：Vue 3.2（Composition API + `<script setup>`）+ Pinia 2
- **渲染**：PixiJS 6.5 + pixi-live2d-display 0.4
- **构建**：Vite 3 + `vue-tsc` 类型检查
- **Wails dev 端口**：`5173`（Vite）/ `34115`（Wails dev server，浏览器可访问）

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
├── app.go                # Go 绑定：暴露给 JS 的方法
├── main.go               # Wails 入口 + AssetServer 中间件
├── wails.json            # Wails 项目配置
├── go.mod / go.sum       # Go 依赖
├── extres/               # 外部资源（包括live2d模型，背景图片等…）【只读】
└── frontend/
    ├── index.html        # 入口；先加载 Live2D runtime，再加载 main.ts
    ├── package.json      # 前端脚本与依赖
    ├── vite.config.ts    # Vite 配置（仅启用 @vitejs/plugin-vue）
    ├── tsconfig.json     # TS 配置（严格模式）
    ├── scripts/          # 构建辅助脚本
    ├── public/lib/       # Live2D 全局运行时（不进 npm）
    ├── wailsjs/          # Wails 自动生成的 JS/TS 绑定（不要手改）
    └── src/
        ├── main.ts       # Vue + Pinia 启动入口
        ├── App.vue       # 顶层布局（左右两栏）
        ├── style.css     # 全局样式
        ├── components/   # UI 组件
        ├── live2d/       # Live2D 加载工具
        └── stores/       # Pinia store
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
- 主要组件路径（不包含子文件夹） = "frontend/src/components"
- 相关PiniaStore = \[models.ts\]

### 改模编辑器相关

- 入口vue = ModelEditApp.vue
- 操作区vue = EditActionPanel.vue
- 主要组件路径 = "frontend/src/components/ModelEditApp"
- 相关PiniaStore = \[wmdlModelEditor.ts\]

### 通用气泡信息功能

- 入口 = "frontend/src/composables/useShortcuts.ts"
- 用法: 引入useMessage后，调用 useMessage() 然后缓存起来对象，然后按需调用对象的success，info，warning，error方法即可，填入字符串参数。比如说msg.info("测试信息")
- 触发关键词：弹消息|气泡|提示

### 通用组件

- 搜索栏 = SearchInput.vue

### 工具类

- 事件分发 = "emitter.ts", 避免从window注入方法，避免使用匿名函数，需考虑on off生命周期，尽量避免在列表项组件里使用。