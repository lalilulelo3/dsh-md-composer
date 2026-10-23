/**
 * 本插件的宿主半侧。
 *
 * 本包的宿主半侧没有业务行为：它的唯一作用是让包进入 Loader 组合图，
 * 从而使 Client 模块登记表能扫到 `dsh.client.platform === "web"` 并加载浏览器半侧。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 稳定的 Cordis 插件名。 */
export declare const name = "md-composer";
/**
 * 宿主半侧插件体：不做任何事。
 * @param _ctx - 宿主根上下文。
 */
export declare function apply(_ctx: Context): void;
