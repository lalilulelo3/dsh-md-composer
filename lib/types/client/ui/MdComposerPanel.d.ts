import type { InputActions, InputState, SessionSlotProps, SnapshotSelectorHook } from '../contract';
/** 打开面板的全局事件名（工具行按钮 → 面板）。 */
export declare const OPEN_EVENT = "dshmd:open-panel";
interface PanelProps extends SessionSlotProps {
    useInput: SnapshotSelectorHook<InputState>;
    inputActions: InputActions;
}
export declare function MdComposerPanel({ useInput, inputActions }: PanelProps): import("react").JSX.Element | null;
export {};
