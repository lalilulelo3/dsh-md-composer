# dsh-md-composer

> DSH Web 的 **Markdown 编辑器插件**：在输入框上方浮出一个正经的 Markdown 编辑器，写完一键写回。
> 基于 [Vditor](https://github.com/Vanessa219/vditor)，解析器 / 图标 / 中文语言包全部内联。

DSH 的输入框是 Lexical 的 `contenteditable`，写长文档很吃力：没有预览、没有工具栏、改标题要手敲 `##`。
这个插件给它配一个「外接编辑器」：`Ctrl+↑` 呼出，`Ctrl+↓` 写回，收起后直接回车发送。

---

## 特性

| | 说明 |
|---|---|
| **所见即所得** | 基于 Vditor，默认 `wysiwyg`（隐藏 `**` 等标记），可切「即时渲染（ir）」 |
| **工具栏** | 标题 / 加粗 / 斜体 / 列表 / 引用 / 代码 / 链接 / 表格 / 撤销重做，悬停有原生中文提示 |
| **三种写回** | 替换草稿 · 追加到末尾（按行剥离原文，避免重复）· 插入（写入但不关面板）；只有显式动作，不隐式改草稿 |
| **草稿** | 草稿栏 + `Ctrl+→` 存稿；存 `sessionStorage`，**刷新页面保留，关掉标签页清空** |
| **大纲** | 占位式侧栏（挤压正文而非覆盖），默认关闭，开关持久化 |
| **高度可调** | 拖上沿把手；双击把手或点底栏「还原窗口」回默认；高度只存内存，刷新回默认 |
| **离线** | Lute 解析器、图标符号、`zh_CN` 语言包全部内联，不发网络请求（详见「已知限制」） |
| **可干净卸载** | 只走官方插槽 `conversation.input.overlay` / `conversation.input.left`，不改 DSH 本体 |

---

## 安装

**发布后（npm）：**

```powershell
dsh plugin --profile desktop add dsh-md-composer
```

**本地目录 / 未发布时：**

```powershell
dsh plugin --profile desktop add "C:\path\to\dsh-md-composer"
```

> - 桌面版 CLI 通常在 `<安装目录>\resources\runtime\cli\bin\dsh.cmd`；
> - 装的是你**日常实际使用**的 profile（桌面版一般是 `desktop`，不是 `web`）；
> - **必须重启 DeepSeek Harness**（客户端插件只在启动时扫描），重启后浏览器 `Ctrl+Shift+R` 强刷一次。

装好后输入框工具行会多出一个 **`Md`** 按钮，或直接按 **`Ctrl+↑`**。

---

## 用法

| 操作 | 快捷键 / 位置 |
|---|---|
| 呼出编辑器 | 工具行 `Md`，或 `Ctrl+↑` |
| 替换草稿并收起 | `Ctrl+↓`，或底栏「替换草稿」 |
| 存为草稿 | 草稿栏底部「存为草稿」，或 `Ctrl+→` |
| 收起（未提交内容存为草稿） | `Esc`，或右上角 `✕` |
| 调整高度 | 拖动编辑器上沿的把手；双击把手还原 |
| 还原窗口 | 底栏「还原窗口」（拖得再高也点得到） |
| 切换显示模式 | 顶栏「切换显示」：所见即所得 / 即时渲染 |
| 列表缩进 | 列表行内任意位置按 `Tab` / `Shift+Tab` |

### 行为约定

- 草稿存 `sessionStorage`：**刷新页面保留，关掉标签页清空**（不是「关页面就清空」）
- 面板高度只记在内存里：关闭再呼出记得住，**刷新页面回默认**
- 显示模式与大纲开关存 `localStorage`，长期保留
- 收起面板后焦点自动回到输入框，所以「`Ctrl+↓` → 回车」可以直接发送
- 面板顶部不会越过「对话 / 轨迹」tab 栏；拖到最高时整体停在分割线下方

---

## 已知限制

1. **离线只覆盖 Lute / 图标 / 中文包**。Vditor 的代码高亮（highlight.js）与 KaTeX 资源没有内联：
   编辑区普通输入不会触发，但代码块高亮 / 公式预览在部分路径下可能请求 `/dist/...`（404，不影响正文）。
   如果你的环境完全断网且需要代码高亮，可以自行把这两份资源按同样的「守卫」方式内联。
2. 客户端 bundle 约 **4.1 MB**（内含 3.5 MB Lute 解析器）。DSH 启动时即加载该文件，首次打开页面会比无插件时多一点解析时间。
3. 中文输入法在**表格单元格**内的组字行为只在 Windows + Chromium 下人工验证过；DSH/Vditor 升级后建议复测。
4. 深度依赖 DSH 的客户端插槽契约；DSH 大版本升级后可能需要跟进。
5. 面板宽度跟随输入框、最大高度受「对话/轨迹」tab 栏限制，这是有意设计（避免遮挡对话区）。

---

## 开发

```powershell
npm install
npm run typecheck
npm run build        # 产出 lib/index.js、lib/client.js、lib/types/**
```

验收脚本需要「运行中的 DSH 实例 + token + CDP 端口」，用法见各脚本头部注释：

```powershell
node scripts/verify-m0.mjs <token> [cdpPort] [appPort]
node scripts/verify-panel.mjs <token> [cdpPort] [appPort]
node scripts/verify-overflow.mjs <token> [cdpPort] [appPort]
node scripts/verify-table.mjs <token> [cdpPort] [appPort]
node scripts/verify-drag-real.mjs <token> [cdpPort] [appPort]
```

> 拖拽类验收必须用 CDP 的 `Input.dispatchMouseEvent`（真实鼠标事件）；`dispatchEvent` 会绕过指针捕获机制，测不出真实失败路径。

---

## 许可

MIT
