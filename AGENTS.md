# L2DW — Agent 指南

Wails v2 + Vue 3 + PixiJS 桌面应用，用于加载并展示本地 Live2D 模型（Cubism 2.1 `.moc` / Cubism 3+ `.moc3`）。

## 开发注意事项

- 在搜寻代码细节的时候，常用 grep 搜寻相关关键字来找到相关文件，而不是读取粗暴的读取所有文件，减少上下文消耗。
- 本文档只记录相关模块的大概位置，不会记录具体的落地细节，具体地方需要自寻进行探索。
- 在会话的第一次回答必须强制添加上 **我已阅读本项目规范，现在让我来处理你的需求** ，只需要一次即可。
- 禁止修改本文档，除非用户明确要求；术语表和坑点文档可按其维护规范主动更新。

## 文档索引与维护

- `docs/glossary.md`：项目术语、模块入口与职责归属；按任务关键词检索定位，代码为实现依据。
- `docs/development_pitfalls.md`：Wails、Vue、PixiJS、Live2D 等工具链的已确认坑点；涉及相关技术或排查异常时按主题检索。
- `docs/MOTION_DOC.md`：动作编辑器入口与开发索引；开发动作编辑器时优先阅读。
- `docs/MOTION_FORMAT.md`：Live2D 动作文件格式及 lanim 映射；涉及动作格式、导入导出时按需阅读。
- `test-guide.md`：用户明确要求测试时，参考其中的临时测试与调试规范。
- 新增或变更概念、入口、职责时，按需同步术语表；确认可复用的工具链坑点时，按需同步坑点文档。普通功能变化不强制新增条目。
- 同一信息只在所属文档维护一处，其他文档使用索引；过时条目及时修订或移除，不把未经证实的推测写成结论。
- 已注入或本会话已读取的文档优先复用上下文，不为刷新记忆重复通读；用户告知外部修改、上下文缺少具体内容或补丁冲突时，只重读必要部分。

## 技术栈

- **后端**：Go 1.23 + Wails v2.10.1（`net/http`、`embed.FS`）
- **前端**：Vue 3.2（Composition API + `<script setup>`）+ Pinia 2
- **渲染**：PixiJS ^6.5.10 + pixi-live2d-display-webgal ^0.5.12
- **构建**：Vite ^3.0.7 + `vue-tsc --noEmit` 类型检查（`npm run build` 前自动执行）
- **TypeScript** ^4.6.4（严格模式）
- **Wails dev 端口**：`5173`（Vite）/ `34115`（Wails dev server，浏览器可访问）
- **Wails 启动模式**：主进程可带 `--editor` 进入"模型编辑器"窗口（标题 `L2DW - 模型编辑器`，1400×900），或附带 `--wmdl <绝对路径>` 让编辑器启动后自动加载该 wmdl 文件；亦可带 `--actor` 进入"演出编辑器"窗口（标题 `L2DW - 演出编辑器`，1200×800），并附带 `--actor-wmdl <绝对路径>` 自动加载。

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
├── main.go                      # Wails 入口 + AssetServer 中间件；处理 --editor / --wmdl / --actor / --actor-wmdl 启动参数
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
        ├── main.ts              # Vue + Pinia 启动入口；根据 AppMode() 选择挂载 App / ModelEditApp / ActorEditApp
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
        │   ├── L2dwContainer.ts # 自定义 PIXI 容器（含 alpha，滤镜相关内容）
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

### 设计规范

- 如果是硬编码数据，则不允许有多份相同的硬编码数据存在，应尽可能将它抽到公共代码中进行服用，保证**数据出口唯一性**。
- 同上，尽可能避免有太多重复的原子逻辑散落在各个文件中，如果相似的原子逻辑实在太多，则为了避免以后修改时需要修改多处地方，则应该将它抽离到公共工具库中，保证**功能唯一入口**

### 综合信息

- PowerShell 不接受 &&。改用 ; 来分开执行
- 当用户**明确要求**测试的时候，可编写临时ts脚本，然后使用 npx tsx 脚本路径 来进行输出log进行调试测试，注意引用路径的相对关系。**具体参考同目录文件"test-guide.md"**
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

## 知识快速检索

- 在 `docs/glossary.md` 按用户术语、别名和拆分后的关键词检索，再按入口定点查代码。
- 知识库未命中时，简要提示未命中的主题，例如：【检索知识库未命中: 文件浏览器 | 将自行进行相关探索】。
- 事件分发统一使用 `frontend/src/stores/emitter.ts` 与 `StageEvents`；避免从 window 注入方法、避免匿名函数，注意 on/off 生命周期，尽量不在列表项组件里使用。
