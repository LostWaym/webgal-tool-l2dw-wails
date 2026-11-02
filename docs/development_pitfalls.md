# 开发坑点

本文记录本项目工具链中已确认、可复用的反直觉行为；业务术语见 `docs/glossary.md`，通用规则见 `AGENTS.md`。

## 维护规范

- 收录工具链的静默失效、版本差异、开发与构建环境差异等；不收通用编程常识或一次性开发日志。
- 每条以粗体症状或规则开头，简述触发条件与规避方法；原始报错保留以便检索。
- 只记录有代码、报错或实际验证依据的结论；未证实的推测不得写成事实。
- 按主题合并相关条目；依赖升级或代码变化后失效的条目及时修订或删除。
- 自检：下次遇到同一问题时，是否能凭条目定位或规避？

## Wails 与构建

- **Wails 生成的 TypeScript 模型可能触发 `TS1011`**：前端 `postinstall`、`predev`、`prebuild` 会调用 `frontend/scripts/patch-wails-models.mjs` 修补生成物；生成绑定后使用项目脚本，不要手改 `frontend/wailsjs/`。

## Live2D 与资源

- **本地模型资源不是普通前端静态资源**：绝对路径资源通过 `frontend/src/path_utils.ts` 的 `toFileUrl` 和后端 `/abs_files/` 路由访问；不要把磁盘路径直接当作普通网页静态路径。
- **Live2D 运行时由页面预先加载**：`frontend/index.html` 在应用入口之前加载运行时；仅安装 npm 依赖不等于运行时资源已就绪。
