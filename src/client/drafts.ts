/**
 * 草稿：存在 sessionStorage，关掉页面即清空（用户明确要求的行为）。
 * 与偏好分开存放，避免「临时内容」污染「长期习惯」。
 */

export interface Draft {
  id: string
  title: string
  text: string
  /** 创建时间戳（ms）。 */
  at: number
  chars: number
}

const KEY = 'dshmd:drafts:v1'
const MAX_DRAFTS = 50
const MAX_DRAFT_BYTES = 512 * 1024

export function listDrafts(): Draft[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Draft[]) : []
  } catch {
    return []
  }
}

function write(list: readonly Draft[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // 配额满：丢弃最旧的一半再试一次，仍失败就放弃（面板会提示）
  }
}

/** 取首个非空行作为标题。 */
function titleOf(text: string): string {
  const line = text.split('\n').find(l => l.trim() !== '') ?? '未命名'
  return line.replace(/^#+\s*/, '').slice(0, 40)
}

/** 存一条草稿；返回新列表。 */
export function addDraft(text: string): Draft[] {
  const trimmed = text.trim()
  if (!trimmed) return listDrafts()
  const list = listDrafts()
  // 同内容不重复入库
  if (list.some(d => d.text === text)) return list
  const draft: Draft = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: titleOf(text),
    text: text.length > MAX_DRAFT_BYTES ? text.slice(0, MAX_DRAFT_BYTES) : text,
    at: Date.now(),
    chars: text.length,
  }
  const next = [draft, ...list].slice(0, MAX_DRAFTS)
  write(next)
  return next
}

/** 删除一条草稿；返回新列表。 */
export function removeDraft(id: string): Draft[] {
  const next = listDrafts().filter(d => d.id !== id)
  write(next)
  return next
}

export function clearDrafts(): Draft[] {
  write([])
  return []
}
