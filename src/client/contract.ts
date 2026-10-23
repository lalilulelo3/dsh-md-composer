/**
 * 本插件的客户端契约切片 + 类型层。
 *
 * 为什么不直接 import 官方类型：
 * `@deepseek-ai/dsh-client-ui-slots` 没有单独发布到 npm（只随 dsh 安装包与平台模块表提供），
 * 构建期拿不到它的 `.d.ts`。第三方 DSH 客户端插件的通行做法是：
 * 只声明自己用到的那一小块类型面。下面的形状与安装包内的声明一致
 * （对照 dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts）。
 */
import type { Context } from '@deepseek-ai/cordis'

// ------------------------------------------------------------------ store / 输入

/** Cordis 可观察快照的只读 selector 钩子。 */
export type SnapshotSelectorHook<S> = <T>(selector: (snapshot: S) => T) => T

/** 当前 Session 的输入状态（只读投影）。 */
export interface InputState {
  /** 编辑器文档的剪贴板文本投影（引用 chip 已展开）。 */
  readonly draft: string
  /** 单调递增的编辑器修订号。 */
  readonly draftRev: number
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

/** 每个 Session 的稳定公开输入动作。 */
export interface InputActions {
  /** 整段替换草稿（唯一的公开写入入口；会把光标推到末尾）。 */
  setDraft(text: string): void
  /** 进入提交。 */
  submit(): void
}

/** 一个 session 作用域插槽组件的运行期入参（本插件只用到这两个）。 */
export interface SessionSlotProps {
  useInput: SnapshotSelectorHook<InputState>
  inputActions: InputActions
}

// ------------------------------------------------------------------ 插槽

/**
 * 本插件占用的插槽 key。
 * 必须是运行时真值（官方 `SlotMap` 是声明合并，构建期拿不到），
 * 所以用 `as const` 数组同时充当运行期参数与类型来源。
 */
export const SLOT = {
  overlay: 'conversation.input.overlay',
  inputLeft: 'conversation.input.left',
} as const

export type SlotKey = (typeof SLOT)[keyof typeof SLOT]

/** list 类型插槽的注册选项。 */
export interface SlotRegisterOptions {
  name: SlotKey
  /** 自己的单元格 key：新 id 是追加，复用已占用的 id 会替换那一格。 */
  id: string
  /** 升序排序位置。 */
  order?: number
  /** 宿主投影文案处显示的名称。 */
  label?: string | (() => string)
}

/** 注册句柄：幂等 disposer。 */
export type SlotDisposer = () => void

/**
 * 组件契约：插槽组件是普通 React 函数组件，
 * 额外收到 session 作用域的标准 props（本插件用 useInput / inputActions）。
 */
export type SlotComponent = (props: SessionSlotProps) => unknown

// ------------------------------------------------------------------ Cordis 服务面

/** 本插件注入并使用的 `ctx.slots` 面。 */
export interface SlotRegistryFace {
  /**
   * 为一个插槽声明的存活期安装效果。
   * 声明已存在时回调同步执行；否则等声明提交后执行。
   * 必须用它等待 —— 不能直接 register（插槽由 ui-conversation 的条目声明）。
   */
  inject(key: SlotKey, callback: () => SlotDisposer | Iterable<SlotDisposer>): SlotDisposer
  register(options: SlotRegisterOptions, component: SlotComponent): SlotDisposer
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 由 ui-renderer 提供的插槽注册表。 */
    slots: SlotRegistryFace
  }
}

/** 客户端插件半侧的 ctx（与官方插件一致，就是 cordis 的 Context）。 */
export type ClientContext = Context
