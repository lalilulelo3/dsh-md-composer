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
    mode: 'wysiwyg' | 'ir';
    /** 是否显示大纲侧栏。 */
    outline: boolean;
}
export declare const DEFAULT_PREFS: PanelPrefs;
/**
 * 注入一份样式（幂等）。
 * @param tagId - 样式身份，写成 `<包名>/<文件>` 形式。
 * @param css - 样式文本。
 */
export declare function injectPluginCss(tagId: string, css: string): void;
/** 读持久偏好；任何异常都退回默认值，绝不因为坏数据让面板打不开。 */
export declare function loadPrefs(): PanelPrefs;
/** 合并写入持久偏好（读-改-写，避免覆盖别的字段）。 */
export declare function savePrefs(patch: Partial<PanelPrefs>): void;
/** 读当前面板高度（0 = 未自定义）。 */
export declare function loadPanelHeight(): number;
/** 记录面板高度；传 0 表示复位为默认。 */
export declare function savePanelHeight(px: number): void;
/** 默认面板高度：约 38% 视口高，且有舒适下限与上限。 */
export declare function defaultPanelHeight(): number;
