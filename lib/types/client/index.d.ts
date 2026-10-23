/**
 * 浏览器半侧入口：注册两个插槽。
 *
 * 落座说明
 *   - `conversation.input.overlay`：composer 卡片内的浮层座位（面板本体）。
 *   - `conversation.input.left`：composer 工具行左侧的紧凑控件（鼠标开关）。
 * 两个座位都由 ui-conversation 的条目声明，因此必须用 `ctx.slots.inject` 等待 ——
 * 直接 `register` 会在声明出现之前失败。
 */
import { type ClientContext } from './contract';
/** 必需服务：UI 插槽注册表。 */
export declare const inject: string[];
/**
 * 客户端插件体。
 * @param ctx - 客户端根上下文。
 */
export declare function apply(ctx: ClientContext): void;
