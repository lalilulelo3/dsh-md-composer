/**
 * 工具行开关按钮（`conversation.input.left`）。
 *
 * 它和面板是两个独立的插槽条目，所以通过一个极轻的全局事件通信：
 * 按钮只负责发出「打开」意图，面板自己管理开关状态。
 * 仅在面板关闭时拦截 Ctrl+↑（其余按键一律放行，不干扰 DSH 自身）。
 */
import { useEffect } from 'react'
import { OPEN_EVENT } from './MdComposerPanel.tsx'

export function MdToggleButton() {
  // 全局快捷键：Ctrl+↑ 呼出编辑器
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key !== 'ArrowUp') return
      // 面板打开时会自己处理 Ctrl+↓/→/Esc；Ctrl+↑ 只在需要打开时有意义
      e.preventDefault()
      e.stopPropagation()
      window.dispatchEvent(new CustomEvent(OPEN_EVENT))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <button
      type="button"
      className="dshmd-toggle"
      title="用 Markdown 编辑器打开（Ctrl+↑）"
      aria-label="用 Markdown 编辑器打开"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
    >
      Md
    </button>
  )
}
