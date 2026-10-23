/**
 * Markdown 编辑器浮层面板。
 *
 * 落座：`conversation.input.overlay` —— composer 卡片内顶部的一条零高绝对定位线，
 * 所以本组件渲染一个 position:absolute 的容器即可「浮在输入框上方」。
 *
 * 写回：DSH 只提供 `inputActions.setDraft(text)`（整段替换，光标会跳到末尾），
 * 没有光标插入 API，因此提供三种显式动作（替换 / 追加 / 插入），不做隐式写入。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InputActions, InputState, SessionSlotProps, SnapshotSelectorHook } from '../contract'
import { mountEditor, closestLi, isAtLineStart, type MdEditor, type EditorMode } from '../editor/vditor'
import { addDraft, listDrafts, removeDraft, type Draft } from '../drafts'
import { loadPrefs, savePrefs, loadPanelHeight, savePanelHeight, defaultPanelHeight } from '../prefs'

/** 打开面板的全局事件名（工具行按钮 → 面板）。 */
export const OPEN_EVENT = 'dshmd:open-panel'

/**
 * 收起面板后把焦点交还给输入框。
 *
 * 为什么必须显式做：DSH 只提供 `setDraft` 这一个写入 API，调用它**不会**移动焦点。
 * 面板收起后焦点落在 `document.body` 上，用户接着按回车没有任何反应 ——
 * 而「Ctrl+↓ 收起 → 直接回车发送」是最自然的手感，必须支持。
 */
function focusComposer(): void {
  const input = document.querySelector<HTMLElement>('[data-composer-input]')
  if (!input) return
  // 无条件聚焦并落一个折叠光标到末尾：
  // 这里不需要「焦点已经在里面就别抢」的聪明判断 —— 那个判断会漏掉
  // 「点 ✕ 按钮后焦点停在按钮/body 上」这条路径，反而制造 bug。
  input.focus()
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(input)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * 从编辑后的全文里剥掉「原输入框文本」，只留下新增部分。
 *
 * Vditor 的 wysiwyg/ir 会规范化 Markdown，原文往往不再是严格前缀，
 * 所以按三级退化：严格前缀 → 全文包含 → 行级公共前后缀。
 * 返回空串表示「没有新增内容」（用户可能只改了原文）。
 */
function stripOriginal(original: string, edited: string): string {
  if (!original) return edited
  if (edited === original) return ''
  if (edited.startsWith(original)) return edited.slice(original.length).replace(/^\s*\n+/, '')
  const at = edited.indexOf(original)
  if (at >= 0) return edited.slice(at + original.length).replace(/^\s*\n+/, '')

  const a = original.split('\n')
  const b = edited.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) tail++
  return b.slice(head, b.length - tail).join('\n').replace(/^\s*\n+/, '')
}

/** 面板高度下限。 */
const MIN_PANEL_H = 160

const MODE_LABEL: Record<EditorMode, string> = {
  wysiwyg: '所见即所得',
  ir: '即时渲染',
}

interface PanelProps extends SessionSlotProps {
  useInput: SnapshotSelectorHook<InputState>
  inputActions: InputActions
}

type WriteKind = 'replace' | 'append' | 'insert'

export function MdComposerPanel({ useInput, inputActions }: PanelProps) {
  const draft = useInput(s => s.draft)

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<EditorMode>(() => loadPrefs().mode)
  const [outlineOn, setOutlineOn] = useState(() => loadPrefs().outline)
  const [notice, setNotice] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>(() => listDrafts())
  // 当前高度（仅用于渲染初始值；真正的落值由 applyHeight 写进 DOM 与内存）
  const [height, setHeight] = useState(0)

  const cardRef = useRef<HTMLDivElement | null>(null)
  const editorBoxRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MdEditor | null>(null)
  // 呼出时输入框内容的快照：写回时用来判断「面板里哪些是新增内容」
  const snapshotRef = useRef('')
  // 编辑器里的实时内容：切显示模式会销毁重建 Vditor，必须靠它把当前内容带过去
  const liveRef = useRef('')
  // 上一次的 open 状态：只有「打开 → 关闭」才把焦点交还输入框，初次挂载不抢焦点
  const prevOpenRef = useRef(false)
  // 拖拽状态：拖拽期间直接写 DOM 高度，不每帧 setState（React 重渲染会让面板抖动）
  const resizingRef = useRef(false)
  const dragHeightRef = useRef(0)
  // 关闭时未提交的内容：下次呼出优先恢复，避免丢稿
  const restoreRef = useRef<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)

  // ---------------------------------------------------------------- 状态提示

  const flash = useCallback((text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(''), 3200)
  }, [])

  // ---------------------------------------------------------------- 打开 / 关闭

  const openPanel = useCallback(() => {
    if (open) return
    const snapshot = draft.trim()
    snapshotRef.current = snapshot
    liveRef.current = draft
    setOpen(true)
  }, [draft, open])

  const closePanel = useCallback(() => {
    const text = editorRef.current?.getValue() ?? ''
    // 关闭时若编辑器里有输入框尚未拿到的新内容，暂存成草稿，避免静默丢失
    if (text.trim() && text.trim() !== snapshotRef.current) {
      restoreRef.current = text
      setDrafts(addDraft(text))
      flash('内容已存为草稿（关掉页面即清空）')
    }
    setOpen(false)
  }, [flash])

  // 面板收起后把焦点交还输入框 —— 这样「Ctrl+↓ 收起 → 直接回车发送」才成立
  // 注意：只有「打开 → 关闭」才聚焦；初次挂载（open 初始为 false）不应抢焦点
  useEffect(() => {
    if (open) {
      prevOpenRef.current = true
      return
    }
    if (!prevOpenRef.current) return
    prevOpenRef.current = false
    // 等面板真正从 DOM 移除后再抢焦点，否则会被卸载过程打断
    const timer = window.setTimeout(focusComposer, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  // 组件卸载时清掉提示定时器，避免卸载后继续 setNotice
  useEffect(() => () => { window.clearTimeout(noticeTimer.current) }, [])

  /** 工具行按钮触发 */
  useEffect(() => {
    const onOpen = () => openPanel()
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [openPanel])

  // ---------------------------------------------------------------- 快捷键（捕获阶段抢先）
  // 放在捕获阶段：早于 Lexical 自己的按键处理，也早于 Vditor 的冒泡监听
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      // 输入法组字中：Esc 应该交给输入法取消候选词，而不是关掉整个面板
      if (e.isComposing) return
      // Esc：与右上角 ✕ 等效
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        closePanel()
        return
      }
      // Ctrl+↓：替换草稿并收回
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation()
        writeBack('replace')
        return
      }
      // Ctrl+→：存为草稿
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation()
        saveCurrentAsDraft()
        return
      }
      if (e.key !== 'Tab' || e.isComposing) return

      // ── Tab：让列表行在「任意光标位置」都能缩进 ──
      // Vditor 源码的判据是 `range.startOffset === 0` 才缩进，
      // 所以这里在捕获阶段先把光标挪到列表项行首，再放行让它自己处理。
      const target = e.target as HTMLElement | null
      if (!target?.closest?.('.vditor-ir, .vditor-wysiwyg')) return
      try {
        const sel = window.getSelection()
        const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
        if (range) {
          const li = closestLi(range.startContainer)
          if (li && !isAtLineStart(range)) {
            const r = document.createRange()
            r.selectNodeContents(li)
            r.collapse(true)
            sel?.removeAllRanges()
            sel?.addRange(r)
          }
        }
      } catch { /* 选区不可用时放行 */ }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closePanel])

  // ---------------------------------------------------------------- 编辑器挂载

  useEffect(() => {
    if (!open || !editorBoxRef.current) return
    // 恢复优先级：本次显式载入的草稿 > 面板里已有的实时内容（切模式时） > 呼出时的输入框原文
    const initial = restoreRef.current ?? liveRef.current ?? snapshotRef.current
    restoreRef.current = null

    const editor = mountEditor(editorBoxRef.current, {
      value: initial,
      mode,
      onInput: (text) => { liveRef.current = text },
      onReady: () => { /* 挂载完成后 focusAtEnd 会重试到成功 */ },
    })
    editorRef.current = editor
    liveRef.current = initial
    // 呼出后把光标放到文末，而不是文首
    editor.focusAtEnd()
    if (outlineOn) editor.toggleOutline(true)

    return () => {
      editorRef.current = null
      editor.destroy()
    }
    // mode 变化时重建编辑器（Vditor 不支持运行期切模式）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode])

  // ---------------------------------------------------------------- 尺寸
  //
  // 宽度：**跟随原输入框**，左/右都是 0，不需要任何测量。
  // 高度：下端固定贴合输入框上沿，向上生长；上限保证面板顶不越过
  // 「对话 / 轨迹」tab 栏——越过之后 DSH 的滚动容器会让标题行 sticky 停住，
  // 工具栏与编辑区继续上移被压住（这就是「标题行不动、控件继续向上」的根因）。
  //
  // 触发路径有两条：① 用户拖高；② 输入框自己变高（多行草稿）把面板顶上去。
  // 所以除了拖拽与窗口 resize，还必须监听输入框本身的尺寸变化。

  /**
   * 可用高度上限：面板下沿到「对话 / 轨迹」tab 栏底部的距离。
   *
   * 顶部安全线取 tab 栏底部（实测约 76px），而不是「视口顶端 + 10px」：
   * 面板顶部一旦高过 tab 栏，标题行会被 sticky 钉在 tab 栏底部，
   * 与工具栏重叠（实测重叠 22px），看起来就是标题行停住、控件继续上移。
   * 找不到 tab 栏时用 60px 兜底。
   */
  const maxHeight = useCallback((): number => {
    const card = cardRef.current
    const bottom = card?.getBoundingClientRect().bottom ?? window.innerHeight
    const tabBottoms = [...document.querySelectorAll<HTMLElement>('[role="tablist"]')]
      .map(el => el.getBoundingClientRect())
      .filter(r => r.height > 0 && r.bottom > 0 && r.bottom < window.innerHeight / 2)
      .map(r => r.bottom)
    const safeTop = tabBottoms.length > 0 ? Math.ceil(Math.max(...tabBottoms) + 6) : 60
    return Math.max(MIN_PANEL_H, Math.round(bottom - safeTop))
  }, [])

  const clampHeight = useCallback((want: number): number => {
    return Math.max(MIN_PANEL_H, Math.min(Math.round(want), maxHeight()))
  }, [maxHeight])

  /** 当前高度：用户拖过就用他拖的，否则用默认值。 */
  const resolveHeight = useCallback((): number => {
    const saved = loadPanelHeight()
    return clampHeight(saved > 0 ? saved : defaultPanelHeight())
  }, [clampHeight])

  /** 把高度写进 DOM，并记录到内存（刷新即回默认）。 */
  const applyHeight = useCallback((px: number): void => {
    const card = cardRef.current
    if (card) card.style.height = `${px}px`
    setHeight(px)
    savePanelHeight(px)
  }, [])

  /** 输入框变高时收缩面板，保证顶栏不被顶出视口（不改变用户记录的高度）。 */
  const shrinkToViewport = useCallback((): void => {
    // 拖拽期间不要插手：拖拽本身就在改高度，ResizeObserver 再收缩会打架
    if (resizingRef.current) return
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    if (rect.height <= 0) return
    const cap = maxHeight()
    if (rect.height > cap) card.style.height = `${cap}px`
  }, [maxHeight])

  // 面板打开后按「记录的高度 or 默认值」落一次高度
  useEffect(() => {
    if (!open) return
    applyHeight(resolveHeight())
    // 打开时算一次即可；后续由拖拽 / 输入框变化驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 输入框高度一变，可用空间就变
  useEffect(() => {
    if (!open) return
    const card = cardRef.current
    if (!card) return
    const composer = card.closest('[data-composer-card]')
    if (!composer || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { shrinkToViewport() })
    ro.observe(composer)
    return () => ro.disconnect()
  }, [open, shrinkToViewport])

  // 窗口尺寸变化同样会改变可用空间
  useEffect(() => {
    if (!open) return
    const onResize = () => { shrinkToViewport() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, shrinkToViewport])

  /** 拖拽把手：在底栏里，**永远可见**（面板再高也不会跑出视口）。 */
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    resizingRef.current = true
    dragHeightRef.current = 0
    handle.classList.add('dshmd-resizing')
    document.body.classList.add('dshmd-resizing-body')

    const onMove = (ev: PointerEvent) => {
      // 每次都重新量下沿：不能缓存（拖拽期间输入框可能变高）
      const card = cardRef.current
      if (!card) return
      const bottom = card.getBoundingClientRect().bottom
      const px = clampHeight(bottom - ev.clientY)
      // 拖拽期间直接写 DOM，不走 setState：
      // 每帧 setState 会让整个面板重渲染，拖起来发飘、布局偶尔错位。
      card.style.height = `${px}px`
      dragHeightRef.current = px
    }
    const stop = () => {
      resizingRef.current = false
      handle.classList.remove('dshmd-resizing')
      document.body.classList.remove('dshmd-resizing-body')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
      // 拖拽结束才把最终高度同步进 React state 与内存
      if (dragHeightRef.current > 0) {
        setHeight(dragHeightRef.current)
        savePanelHeight(dragHeightRef.current)
        dragHeightRef.current = 0
      }
    }

    // 监听挂在 window 上，**不能**用 setPointerCapture + 挂在把手自己身上：
    // 鼠标一旦移到视口之外，浏览器会立刻释放指针捕获（lostpointercapture），
    // 之后所有 pointermove 都收不到，拖拽在半路静默中断。
    // 注意：合成事件测不出这一点（会绕过捕获机制），必须用真实输入事件。
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
  }, [clampHeight])

  /**
   * 还原到默认高度。
   *
   * 这个按钮是「拖高之后还能回来」的关键：原先只有「双击把手」一条路，
   * 而把手画在面板上沿之外，拉出视口后就再也够不到 —— 用户会卡在最高高度。
   * 放在底栏（「存为草稿」左边），无论拖多高都点得到。
   */
  const resetHeight = useCallback(() => {
    applyHeight(clampHeight(defaultPanelHeight()))
    flash('已还原为默认高度')
  }, [applyHeight, clampHeight, flash])

  // ---------------------------------------------------------------- 写回

  const writeBack = useCallback((kind: WriteKind) => {
    const text = editorRef.current?.getValue() ?? ''
    if (kind === 'append') {
      // 面板内容通常已包含输入框原文，追加前先剥掉，避免重复。
      // 注意不能只判断 startsWith：Vditor 会规范化 Markdown（表格对齐、列表符号），
      // 原文常常不再是严格前缀，所以退化为「包含匹配 + 行级公共前后缀」。
      const carried = snapshotRef.current
      const payload = stripOriginal(carried, text)
      if (!payload.trim()) { flash('没有新增内容可追加'); return }
      const base = draft.trim()
      const next = base ? `${base}\n\n${payload}` : payload
      inputActions.setDraft(next)
      liveRef.current = next
      snapshotRef.current = next.trim()
      restoreRef.current = null
      setOpen(false)
      flash('已把新增内容追加到末尾')
      return
    }

    inputActions.setDraft(text)
    liveRef.current = text
    snapshotRef.current = text.trim()
    restoreRef.current = null
    if (kind === 'insert') {
      flash('已写入输入框（编辑器保持打开）')
    } else {
      setOpen(false)
      flash('已替换输入框内容')
    }
  }, [draft, inputActions, flash])

  const saveCurrentAsDraft = useCallback(() => {
    const text = editorRef.current?.getValue() ?? ''
    if (!text.trim()) { flash('内容为空，未保存'); return }
    setDrafts(addDraft(text))
    restoreRef.current = text
    flash('已存为草稿（关掉页面即清空）')
  }, [flash])

  // ---------------------------------------------------------------- 渲染

  if (!open) return null

  return (
    <div
      ref={cardRef}
      className="dshmd-panel"
      role="dialog"
      aria-modal={false}
      aria-label="Markdown 编辑器"
      style={{ height: `${height || defaultPanelHeight()}px` }}
    >
      {/* 拖拽把手在面板上沿（顺手的位置）；还原按钮在底栏，所以把手被拉出视口也不怕 */}
      <div
        className="dshmd-resize"
        onPointerDown={startResize}
        onDoubleClick={resetHeight}
        role="separator"
        aria-orientation="horizontal"
        aria-label="上下拖动调整编辑器高度（双击恢复默认）"
        title="上下拖动调整高度（双击恢复默认）"
      />

      <div className="dshmd-head">
        <span className="dshmd-title">Markdown 编辑器</span>
        <span className="dshmd-badge">{MODE_LABEL[mode]}</span>
        <span className="dshmd-spacer" />
        {notice ? <span className="dshmd-notice">{notice}</span> : null}
        <button type="button" className="dshmd-icon" onClick={() => {
          const next: EditorMode = mode === 'wysiwyg' ? 'ir' : 'wysiwyg'
          setMode(next); savePrefs({ mode: next })
        }} title="切换显示：所见即所得 / 即时渲染">切换显示</button>
        <button type="button" className="dshmd-icon" onClick={() => {
          const next = !outlineOn
          setOutlineOn(next); savePrefs({ outline: next }); editorRef.current?.toggleOutline(next)
        }} title="显示 / 隐藏大纲">大纲</button>
        <button type="button" className="dshmd-icon" onClick={closePanel} title="关闭（Esc）">✕</button>
      </div>

      <div className="dshmd-body">
        <div className="dshmd-editor" ref={editorBoxRef} />
        <aside className="dshmd-drafts">
          <div className="dshmd-drafts-head">草稿 <small>关页面即清空</small></div>
          <ul>
            {drafts.length === 0
              ? <li className="dshmd-drafts-empty">还没有草稿<br />Ctrl+→ 存一条试试</li>
              : drafts.map(d => (
                <li key={d.id}>
                  <div className="dshmd-draft-title">{d.title}</div>
                  <div className="dshmd-draft-meta">{d.chars} 字 · {new Date(d.at).toLocaleTimeString('zh-CN')}</div>
                  <div className="dshmd-draft-acts">
                    <button type="button" onClick={() => {
                      editorRef.current?.setValue(d.text)
                      editorRef.current?.focusAtEnd()
                      flash('已载入草稿')
                    }}>载入</button>
                    <button type="button" onClick={() => setDrafts(removeDraft(d.id))}>删除</button>
                  </div>
                </li>
              ))}
          </ul>
          {/*
            「存为草稿」属于草稿区（它操作的就是草稿列表），所以放在草稿栏**下面**，
            而不是底栏里 —— 操作离它作用的对象近，才不容易看错。
          */}
          <div className="dshmd-drafts-foot">
            <button type="button" className="dshmd-btn dshmd-btn-ghost" onClick={saveCurrentAsDraft} title="把当前内容存为草稿（Ctrl+→）">存为草稿</button>
          </div>
        </aside>
      </div>

      <div className="dshmd-foot">
        <div className="dshmd-foot-row">
          <button type="button" className="dshmd-btn dshmd-btn-primary" onClick={() => writeBack('replace')} title="用编辑器内容替换输入框（Ctrl+↓）">替换草稿</button>
          <button type="button" className="dshmd-btn" onClick={() => writeBack('append')} title="保留输入框现有内容，只把新增部分追加到最后">追加到末尾</button>
          <button type="button" className="dshmd-btn" onClick={() => writeBack('insert')} title="把编辑器内容写入输入框，编辑器保持打开">插入</button>
          <span className="dshmd-spacer" />
          {/* 还原在底栏：把手在上沿，拉出视口后这里是唯一还点得到的入口 */}
          <button type="button" className="dshmd-btn dshmd-btn-ghost" onClick={resetHeight} title="把编辑器还原为默认大小（拖高之后依然点得到）">还原窗口</button>
        </div>
      </div>
    </div>
  )
}
