/**
 * 草稿：存在 sessionStorage，关掉页面即清空（用户明确要求的行为）。
 * 与偏好分开存放，避免「临时内容」污染「长期习惯」。
 */
export interface Draft {
    id: string;
    title: string;
    text: string;
    /** 创建时间戳（ms）。 */
    at: number;
    chars: number;
}
export declare function listDrafts(): Draft[];
/** 存一条草稿；返回新列表。 */
export declare function addDraft(text: string): Draft[];
/** 删除一条草稿；返回新列表。 */
export declare function removeDraft(id: string): Draft[];
export declare function clearDrafts(): Draft[];
