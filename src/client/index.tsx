/**
 * 浏览器半侧入口：注册两个插槽。
 *
 * 落座说明
 *   - `conversation.input.overlay`：composer 卡片内的浮层座位（面板本体）。
 *   - `conversation.input.left`：composer 工具行左侧的紧凑控件（鼠标开关）。
 * 两个座位都由 ui-conversation 的条目声明，因此必须用 `ctx.slots.inject` 等待 ——
 * 直接 `register` 会在声明出现之前失败。
 */
import { SLOT, type ClientContext } from './contract'
import { MdComposerPanel } from './ui/MdComposerPanel'
import { MdToggleButton } from './ui/MdToggleButton'

// 注入样式。约定：本包独占 dshmd- 前缀（注入的 <style> 是全局扁平表）。
// 必须把 CSS 当「文本」导入再由 JS 插进 <head> —— 直接 import 会产出一个
// 独立的 client.css，而浏览器半侧没有任何机制去加载它（样式会静默丢失）。
//
// 三份样式，顺序不能反（后者覆盖前者）：
//   ① vditor/dist/index.css                 编辑器骨架：图标尺寸、主题变量
//   ② vditor/dist/css/content-theme/dark.css 内容区暗色主题
//      ← 漏掉它的后果：表格 tr 没有背景色，浏览器默认给单元格白底，
//        配浅灰文字就是「白底白字完全看不见」；callout 等也没有配色。
//   ③ 本插件自己的 panel.css
// 前两份都没有 url() 引用，可以安全内联、不产生任何网络请求。
import vditorCss from 'vditor/dist/index.css'
import vditorDarkTheme from 'vditor/dist/css/content-theme/dark.css'
import panelCss from './ui/panel.css'
import { injectPluginCss } from './prefs'
injectPluginCss('vditor/dist/index.css', String(vditorCss))
injectPluginCss('vditor/dist/css/content-theme/dark.css', String(vditorDarkTheme))
injectPluginCss('dsh-md-composer/panel.css', String(panelCss))

/** 必需服务：UI 插槽注册表。 */
export const inject = ['slots']

/**
 * 客户端插件体。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject(SLOT.inputLeft, () =>
    ctx.slots.register(
      { name: SLOT.inputLeft, id: 'md-composer-toggle', order: 50, label: 'Markdown 编辑器' },
      MdToggleButton as never,
    ))

  ctx.slots.inject(SLOT.overlay, () =>
    ctx.slots.register(
      { name: SLOT.overlay, id: 'md-composer-panel', order: 100, label: 'Markdown 编辑器' },
      // 组件入参由插槽按声明装配：session 作用域会带上 useInput / inputActions
      MdComposerPanel as never,
    ))
}
