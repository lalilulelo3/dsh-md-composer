/**
 * 构建期把资源当文本导入（esbuild 的 `loader: { '.txt': 'text', '.css': 'text' }`）。
 * 声明对应的模块类型，让类型检查通过。
 *
 * 为什么 CSS 也当文本：直接 `import './x.css'` 会被 esbuild 抽成独立的
 * `client.css`，而浏览器半侧没有任何机制加载它 —— 样式会静默丢失。
 * 当文本导入后由 JS 插进 <head>（见 prefs.ts 的 injectPanelCss）。
 */
declare module '*.txt' {
  const content: string
  export default content
}

declare module '*.css' {
  const content: string
  export default content
}
