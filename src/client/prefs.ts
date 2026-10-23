/**
 * 面板偏好。
 *
 * 分成两类存放，因为它们的生命周期不同：
 *
 * | 偏好 | 存放 | 生命周期 |
 * |---|---|---|
 * | 显示模式 / 大纲 | `localStorage` | 长期习惯，关浏览器也保留 |
 * | 面板高度 | **模块内存** | 仅本次页面有效；刷新页面即回默认 |
 *
 * 高度为什么不持久化：高度是「这一刻顺手拖的」，不是长期偏好。
 * 之前存进 localStorage 导致一个明显问题 —— 某次随手拖矮之后，
 * 之后每次打开都还是那个矮高度，用户会以为「默认高度变低了」。
 */

export interface PanelPrefs {
  /** 显示模式：所见即所得（不显示语法符号）或即时渲染（显示）。 */
  mode: 'wysiwyg' | 'ir'
  /** 是否显示大纲侧栏。 */
  outline: boolean
}

/** 持久化部分（长期习惯）。 */
const KEY = 'dshmd:prefs:v2'

export const DEFAULT_PREFS: PanelPrefs = {
  mode: 'wysiwyg',
  outline: false,
}

/**
 * 样式注入。
 * 官方与第三方插件的约定：往 <head> 插一个带 data-plugin-css 标记的 <style>。
 * 标记里带包名与文件，便于 HMR 按包回收样式。
 *
 * 注意：本插件需要注入**三份**样式 —— Vditor 的 index.css（图标尺寸、主题变量
 * 全靠它）、Vditor 的暗色内容主题（表格配色靠它）、以及本插件自己的 panel.css。
 * 漏掉前两份都不会报错，但分别表现为「图标变成巨大字母」和「表格白底白字」。
 */
const injected = new Set<string>()

/**
 * 注入一份样式（幂等）。
 * @param tagId - 样式身份，写成 `<包名>/<文件>` 形式。
 * @param css - 样式文本。
 */
export function injectPluginCss(tagId: string, css: string): void {
  if (injected.has(tagId) || typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${tagId}"]`)) { injected.add(tagId); return }
  const style = document.createElement('style')
  style.setAttribute('data-plugin-css', tagId)
  // 模块系统会自动给物化窗口内新增的样式补 data-plugin，但显式写一遍更稳：
  // 插件停用/HMR 时按 data-plugin 回收样式，不依赖扫描时机。
  style.setAttribute('data-plugin', 'dsh-md-composer')
  style.textContent = css
  document.head.appendChild(style)
  injected.add(tagId)
}

/** 读持久偏好；任何异常都退回默认值，绝不因为坏数据让面板打不开。 */
export function loadPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>
    return {
      mode: parsed.mode === 'ir' ? 'ir' : 'wysiwyg',
      outline: parsed.outline === true,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

/** 合并写入持久偏好（读-改-写，避免覆盖别的字段）。 */
export function savePrefs(patch: Partial<PanelPrefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    // 存储不可用（隐私模式 / 配额满）时静默降级为「仅本次会话有效」
  }
}

// ---------------------------------------------------------------- 面板高度

/**
 * 面板高度（仅内存）。
 * `0` 表示「用户还没拖过」→ 用默认高度。
 *
 * 放内存而不是 storage，是为了满足：
 *   拖动后关闭再呼出 → 保持自定义高度；
 *   刷新 / 重启浏览器   → 回到默认高度。
 */
let panelHeight = 0

/** 读当前面板高度（0 = 未自定义）。 */
export function loadPanelHeight(): number {
  return panelHeight
}

/** 记录面板高度；传 0 表示复位为默认。 */
export function savePanelHeight(px: number): void {
  panelHeight = px > 0 ? Math.round(px) : 0
}

/** 默认面板高度：约 38% 视口高，且有舒适下限与上限。 */
export function defaultPanelHeight(): number {
  const byViewport = Math.round(window.innerHeight * 0.38)
  return Math.max(240, Math.min(byViewport, 420))
}
