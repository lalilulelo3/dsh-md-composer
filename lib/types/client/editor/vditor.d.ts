export type EditorMode = 'wysiwyg' | 'ir';
export interface MdEditorOptions {
    /** 初始内容。 */
    value: string;
    mode: EditorMode;
    /** 内容变化回调（每次输入都会调用）。 */
    onInput(text: string): void;
    /** 卸载后调用，便于面板收起。 */
    onReady?(): void;
    /** 键盘处理：面板把它接到自己的捕获逻辑上。 */
    onSaveDraft?(): void;
}
/** 面板面向的编辑器接口。 */
export interface MdEditor {
    getValue(): string;
    setValue(text: string): void;
    /** 把光标放到文末（呼出后默认，避免从文首开始找位置）。 */
    focusAtEnd(): void;
    /** 切换大纲的显示。 */
    toggleOutline(show: boolean): void;
    /** 当前是否显示大纲。 */
    isOutlineVisible(): boolean;
    destroy(): void;
}
/**
 * 在容器里挂一个 Vditor 实例。
 * @param container - 面板里的编辑区容器。
 * @param options - 初始值、模式与回调。
 * @returns 面板使用的编辑器句柄。
 */
export declare function mountEditor(container: HTMLElement, options: MdEditorOptions): MdEditor;
/**
 * 从节点向上找列表项（LI）。
 * Tab 缩进要用：Vditor 只在「光标位于行首」时缩进，需要先把光标挪到行首。
 */
export declare function closestLi(node: Node | null): HTMLElement | null;
/** 光标是否已在该行最前面。 */
export declare function isAtLineStart(range: Range): boolean;
