# 开发坑点

本文记录本项目工具链中已确认、可复用的反直觉行为；业务术语见 `docs/glossary.md`，通用规则见 `AGENTS.md`。

## 维护规范

- 收录工具链的静默失效、版本差异、开发与构建环境差异等；不收通用编程常识或一次性开发日志。
- 每条以粗体症状或规则开头，简述触发条件与规避方法；原始报错保留以便检索。
- 只记录有代码、报错或实际验证依据的结论；未证实的推测不得写成事实。
- 按主题合并相关条目；依赖升级或代码变化后失效的条目及时修订或删除。
- 自检：下次遇到同一问题时，是否能凭条目定位或规避？

## Wails 与构建

- **Wails 生成的 TypeScript 模型可能触发 `TS1011` 或 Vite `Unexpected "]"`**：前端 `postinstall`、`predev`、`prebuild` 会调用 `frontend/scripts/patch-wails-models.mjs` 修补生成物；开发期间绑定可能再次生成，业务代码避免运行时导入 `wailsjs/go/models`。生成绑定后使用项目脚本，不要手改 `frontend/wailsjs/`。

## Live2D 与资源

- **Cubism 2 动作时钟是全局入口**：运行时的动作队列读取 `UtSystem.getUserTimeMSec()`，仅缩放模型更新时间不能改变动作播放速度。独立预览变速应通过 `frontend/src/live2d/previewPlaybackClock.ts` 在同步队列调用期间临时提供模型时钟，并保证立即恢复，避免影响其他模型。
- **直接写入的 Live2D 参数可能在变形前被覆盖**：Cubism 2 / 4 的自动眨眼、呼吸和物理在参数更新后运行。预览固定姿势时，可在实例的 `afterMotionUpdate` 写入供物理读取，并于 `beforeModelUpdate` 恢复需要固定的参数；共用预览入口为 `Live2dPreview.vue` 的 `fixedPose`。

- **Pixi 高 DPI 下 `renderer.width/height` 不是场景逻辑尺寸**：它们包含 `resolution` 倍率；居中与 resize 位置换算使用 `app.screen.width/height`，否则非 100% 缩放下会偏移。共用入口为 `frontend/src/live2d/viewport.ts`，变更 DPR 时也同步 Pixi 6 的 `InteractionManager.resolution`；截图导出读取实际像素时仍应保留 `renderer.width/height`。
- **Pixi 6 滤镜不会自动继承画布 DPR，可能导致 Live2D 缩小后额外模糊**：`Filter.resolution` 默认是 1；只提高画布分辨率仍会在离屏滤镜链中丢失细节。共用入口 `frontend/src/live2d/viewport.ts` 在绘制前遍历场景树的公开 `filters`，同步为当前 `renderer.resolution`，同时覆盖场景、包装容器和 Live2D 自带的 AlphaFilter。同步不能依赖 resize，否则异步加载模型或新增滤镜会漏掉；也不乘视口缩放，不删除透明度滤镜。`AlphaFilter(1)` 的参数是透明度，不是分辨率；Blur / Bloom 等复合滤镜需检查内部 pass 的分辨率语义，不能盲目改写内部降采样倍率。
- **本地模型资源不是普通前端静态资源**：绝对路径资源通过 `frontend/src/path_utils.ts` 的 `toFileUrl` 和后端 `/abs_files/` 路由访问；不要把磁盘路径直接当作普通网页静态路径。
- **Live2D 运行时由页面预先加载**：`frontend/index.html` 在应用入口之前加载运行时；仅安装 npm 依赖不等于运行时资源已就绪。

## 前端与交互验证

- **纯 Vite 浏览器实机验证 Wails UI**：启动 `npm run dev` 后用临时 HTML 入口在挂载前 mock `window.go.main.App`（返回 Promise 且支持设置读写回显），即可在浏览器实机测布局、主题与交互；依赖直接 `import 'vue'`，勿引用 `.vite/deps` 缓存路径，用完删除临时入口（不替代原生对话框与真实模型加载）。
- **Pixi 对象接入 Vue 响应式**：需驱动模板的 Pixi 实例用 `shallowRef` 避免深度代理；涉及内置默认底图时，不可仅凭 Sprite 存在与否判断用户是否已加载背景。
- **行内悬停菜单与拖拽清理**：悬停操作组应预留固定占位并以透明/位移过渡，避免展开时挤动名称导致双击误触；全局拖拽监听除 `pointerup` 外，还需在 `blur` 与 `onBeforeUnmount` 时清理并恢复 `cursor` / `userSelect`。
