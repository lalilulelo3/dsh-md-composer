# Changelog

## 0.2.0 — 2026-10-23

首个对外发布版本，基于 0.1.0 的 11 轮反馈迭代与 0.2.1-rc.2 实机适配。

### 修复

- **切换「显示模式」丢失未写回内容**：编辑器重建时优先携带 `liveRef` 中的实时内容，而不是呼出时的快照。
- **刷新后草稿列表为空**：初始 state 从 `sessionStorage` 读取；刷新页面草稿仍可见。
- **大纲偏好不恢复**：初始值改为 `loadPrefs().outline`。
- **面板初次挂载就抢焦点**：只在「打开 → 关闭」时把焦点交还输入框。
- **输入法组字时按 Esc 关闭面板**：keydown 开头判断 `e.isComposing`。
- **「追加」重复整篇**：三级退化剥离（严格前缀 → 全文包含 → 行级公共前后缀），兼容 Vditor 的 Markdown 规范化。
- **换行时正文上下跳一行**：表格净空判断改为「光标是否在表格内」；不再把 Vditor 的块操作栏误判成表格控件栏。
- **字数 / 工具栏提示被遮挡**：禁用 Vditor 的 CSS 气泡，统一使用浏览器原生 `title`（字数统计补 `title="字数统计"`）。
- **拖拽高度抖动 / 标题行与工具栏重叠**：去掉标题行的 `position: sticky`；高度上限改为「面板下沿 − 对话/轨迹 tab 栏底部 − 6px」；拖拽期间直接写 DOM 高度，不每帧 `setState`，拖拽结束再同步 state。
- **块操作栏干扰**：隐藏 Vditor 在空段落上浮出的「上移 / 下移 / 删除块」操作栏（`:has(button[data-type="up"])`）。

### 变更

- 客户端 bundle 默认 minify（`MINIFY=0` 可关闭），4.48 MB → 4.10 MB。
- 样式显式标记 `data-plugin="dsh-md-composer"`，便于插件停用/HMR 时回收。
- 移除未使用的表格净空动态测量与 `BASE_PADDING_TOP`；`noticeTimer` 卸载时清理。
- 重写 README：安装方式（npm / 本地目录）、desktop profile、离线边界、`sessionStorage` 语义、已知限制。
- `prepublishOnly` 执行 typecheck + build；发布源固定 `registry.npmjs.org`。

### 兼容性

- 目标宿主：DSH **0.2.1-rc.2**（实测通过）。
- 依赖契约：`conversation.input.overlay` / `conversation.input.left`（list, session）、`useInput` / `inputActions.setDraft`。
- **不要**给本包添加 `engines.dsh` 或 `@deepseek-ai/dsh-*` 的 peerDependencies：0.2.x 启动器会据此做兼容性检查，版本范围不符时会静默跳过插件。

## 0.1.0 — 2026-09-20

- 初版：面板落座、Vditor 接入、三种写回、草稿、快捷键、拖拽高度。
