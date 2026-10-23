/**
 * 编辑器内核适配层。
 *
 * 把 Vditor 的差异隔离在本文件里，面板只面向 `MdEditor` 接口。
 * 离线要点（已在 mockup 阶段实测验证）：
 *   Vditor 启动时会去取三样东西，每样都有同一个守卫
 *   `if (document.getElementById(id)) return` —— 只要提前把带对应 id 的
 *   <script> 放进 DOM，它就完全不发网络请求：
 *     ① Lute 解析器      id = vditorLuteScript          （异步，取不到则不解析）
 *     ② 语言包 zh_CN.js  id = vditorI18nScriptzh_CN     （异步，取不到则 init() 永不执行！）
 *     ③ 图标 ant.js      id = vditorIconScript          （同步 XHR，失败会中断初始化）
 * 三份源码在构建期当文本打进 bundle，不需要任何外部文件。
 */
import Vditor from 'vditor'
import luteSource from '../assets/lute.txt'
import iconSource from '../assets/icons.txt'
import i18nSource from '../assets/i18n-zh_CN.txt'

export type EditorMode = 'wysiwyg' | 'ir'

export interface MdEditorOptions {
  /** 初始内容。 */
  value: string
  mode: EditorMode
  /** 内容变化回调（每次输入都会调用）。 */
  onInput(text: string): void
  /** 卸载后调用，便于面板收起。 */
  onReady?(): void
  /** 键盘处理：面板把它接到自己的捕获逻辑上。 */
  onSaveDraft?(): void
}

/** 面板面向的编辑器接口。 */
export interface MdEditor {
  getValue(): string
  setValue(text: string): void
  /** 把光标放到文末（呼出后默认，避免从文首开始找位置）。 */
  focusAtEnd(): void
  /** 切换大纲的显示。 */
  toggleOutline(show: boolean): void
  /** 当前是否显示大纲。 */
  isOutlineVisible(): boolean
  destroy(): void
}

/** 三份资源只需注入一次。 */
let guardsInstalled = false
function installOfflineGuards(): void {
  if (guardsInstalled) return
  guardsInstalled = true

  const install = (id: string, code: string): void => {
    if (document.getElementById(id)) return
    const el = document.createElement('script')
    el.id = id
    el.type = 'text/javascript'
    el.text = code
    document.head.appendChild(el)
    // 立即执行一次：让全局对象 / 图标符号真正可用（守卫只负责「不再去网上取」）
    // eslint-disable-next-line no-new-func
    new Function(code)()
  }

  install('vditorLuteScript', String(luteSource))
  install('vditorIconScript', String(iconSource))
  install('vditorI18nScriptzh_CN', String(i18nSource))
}

/** 工具栏：只保留格式相关按钮，并精简「更多」菜单。 */
const TOOLBAR: Array<string | Record<string, unknown>> = [
  'headings', 'bold', 'italic', 'strike', '|',
  'list', 'ordered-list', 'check', '|',
  'quote', 'code', 'inline-code', '|',
  'link', 'table', '|',
  'undo', 'redo',
  {
    name: 'more', tip: '更多', tipPosition: 'ne',
    // 必须显式传对象：内置的 'more' 项没有子项定义，字符串写法裁不掉内容
    toolbar: [{ name: 'info', tip: '关于' }],
  },
]

/** 工具栏按钮的中文悬停名称（Vditor 自带的 i18n tip 只覆盖一部分）。 */
const TOOLBAR_TIPS: Record<string, string> = {
  headings: '标题', bold: '加粗', italic: '斜体', strike: '删除线', link: '链接',
  list: '无序列表', 'ordered-list': '有序列表', check: '任务列表',
  outdent: '减少缩进', indent: '增加缩进', quote: '引用', line: '分隔线',
  code: '代码块', 'inline-code': '行内代码', table: '表格',
  undo: '撤销', redo: '重做', more: '更多', info: '关于', outline: '大纲',
  fullscreen: '全屏', 'edit-mode': '切换编辑模式', emoji: '表情',
  upload: '上传图片', record: '录音',
}

/**
 * 给工具栏按钮补上悬停名称。
 * 用浏览器原生 `title`（而不是 Vditor 的 CSS 气泡）：原生 tooltip 不受
 * 面板 overflow / 层叠关系影响，稳定可靠。
 */
function fillToolbarTips(container: HTMLElement): void {
  for (const item of container.querySelectorAll<HTMLElement>('.vditor-toolbar__item')) {
    const btn = item.querySelector(':scope > button')
    if (!btn) continue
    const type = btn.getAttribute('data-type') ?? ''
    // 子菜单项没有 data-type，退回 aria-label / 文本
    const label = TOOLBAR_TIPS[type] || (btn.getAttribute('aria-label') ?? '') || (btn.textContent ?? '').trim()
    if (!label) continue
    if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', label)
    if (!btn.getAttribute('title')) btn.setAttribute('title', label)
  }
}

/**
 * 让编辑区顶部留出足够的净空，容得下表格控件栏。
 *
 * 表格控件栏（居中 / 插入行列那一排）绝对定位浮在**表格上方**，
 * 编辑区默认顶部内边距只有 12px，表格贴在编辑区顶部时控件栏会被工具栏压住。
 *
 * **判断依据必须是「光标是否真的在表格里」**，不能用
 * `.vditor-panel--none 面板是否可见`：Vditor 的块操作栏
 * （上移 / 下移 / 删除块）也是这个类，输入换行时会在空段落上出现/消失，
 * 用它判断会让编辑区 padding 在 12px 与 54px 之间反复切换，
 * 表现就是「换一行，所有内容向上/向下跳一行」。
 *
 * 普通文本（光标不在表格里）还原默认内边距，不白白多出一大截上边距。
 */
/** 控件栏与表格之间再留一点呼吸空间。 */
const TABLE_BAR_GAP = 10
/** 量不到控件栏时的保守兜底（约一条控件栏的最大高度）。 */
const TABLE_BAR_FALLBACK = 44

/** 每个编辑容器的净空观察器，销毁时一起停掉。 */
const clearances = new WeakMap<HTMLElement, MutationObserver>()

function applyTablePanelClearance(container: HTMLElement): void {
  const pre = [...container.querySelectorAll('pre.vditor-reset')]
    .find(p => (p as HTMLElement).offsetParent !== null) as HTMLElement | undefined
  if (!pre) return

  const selection = window.getSelection()
  const anchor = selection?.anchorNode ?? null
  const anchorEl = anchor
    ? (anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement)
    : null
  const inTable = !!anchorEl?.closest('table')

  if (!inTable) {
    // 没有表格：还原默认内边距，避免普通文本文档平白多出一大截上边距
    if (pre.style.paddingTop) pre.style.paddingTop = ''
    return
  }

  const needed = TABLE_BAR_FALLBACK + TABLE_BAR_GAP
  const current = parseFloat(getComputedStyle(pre).paddingTop) || 0
  // 只在需要变大时写，避免观察回调里改样式引发无谓重排
  if (needed > current) pre.style.paddingTop = `${needed}px`
}

/**
 * 在容器里挂一个 Vditor 实例。
 * @param container - 面板里的编辑区容器。
 * @param options - 初始值、模式与回调。
 * @returns 面板使用的编辑器句柄。
 */
export function mountEditor(container: HTMLElement, options: MdEditorOptions): MdEditor {
  installOfflineGuards()

  let current = options.value
  let instance: Vditor | null = null

  const vditor = new Vditor(container, {
    value: options.value,
    mode: options.mode,
    // 资源全部内联，cdn 只用于主题路径这类可选项；给空串避免任何外链
    cdn: '',
    theme: 'dark',
    lang: 'zh_CN',
    cache: { enable: false },
    toolbar: TOOLBAR as never,
    toolbarConfig: { hide: false, pin: false },
    counter: { enable: true, type: 'markdown' },
    preview: {
      delay: 120,
      theme: { current: 'dark', path: '' },
      hljs: { lineNumber: false, style: 'github-dark' },
      math: { engine: 'KaTeX', inlineDigit: true },
    },
    resize: { enable: false },
    // 默认关闭：enable:true 会让 220px 的大纲一上来就铺在正文上
    outline: { enable: false, position: 'left' },
    input: (text: string) => {
      current = text
      options.onInput(text)
    },
    after: () => {
      instance = vditor
      // 去掉源码/预览工具条（Desktop / Tablet / 微信 / 知乎那一排）
      container.querySelector('.vditor-preview__action')?.remove()
      // 补工具栏悬停名称（原生 title，不受面板层叠影响）
      fillToolbarTips(container)
      // Vditor 的字数统计（工具栏右侧）自带 CSS 气泡，会超出编辑区顶部被裁；
      // 禁用 CSS 气泡（见 panel.css），改用原生 title。
      const counter = container.querySelector<HTMLElement>('.vditor-counter')
      if (counter && !counter.getAttribute('title')) counter.setAttribute('title', '字数统计')
      // 给表格控件栏留出顶部净空（仅当光标在表格里时生效）
      applyTablePanelClearance(container)
      // 表格控件栏是按需显隐的（切换模式 / 重渲染时会重建），所以持续观察并补算。
      // 用 rAF 合并一帧内的多次变动：普通输入也会频繁触发 subtree/attributes，
      // 每次回调都做 querySelectorAll + getComputedStyle + getBoundingClientRect 成本太高。
      let pendingFrame = 0
      const mo = new MutationObserver(() => {
        if (pendingFrame) return
        pendingFrame = requestAnimationFrame(() => {
          pendingFrame = 0
          applyTablePanelClearance(container)
        })
      })
      mo.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
      clearances.set(container, mo)
      // 暴露实例：自动化验收需要用它写入内容（不参与任何业务逻辑）
      ;(container as unknown as { __dshmdEditor?: Vditor }).__dshmdEditor = vditor
      options.onReady?.()
    },
  })

  return {
    getValue: () => {
      try { return vditor.getValue() } catch { return current }
    },
    setValue: (text: string) => {
      current = text
      try { vditor.setValue(text) } catch { /* 未就绪时靠 current 兜底 */ }
    },
    focusAtEnd: () => focusAtEnd(container, () => vditor),
    toggleOutline: (show: boolean) => {
      // 注意：outline 挂在内部实例上（vditor.vditor.outline），外层是 undefined
      const inner = (vditor as unknown as { vditor?: { outline?: { toggle?: (v: unknown, s: boolean, f: boolean) => void } } }).vditor
      inner?.outline?.toggle?.(inner, show, false)
    },
    isOutlineVisible: () => {
      const el = container.querySelector('.vditor-outline') as HTMLElement | null
      return !!el && getComputedStyle(el).display !== 'none'
    },
    destroy: () => {
      // 先停掉净空观察器，再销毁实例：否则销毁过程中的 DOM 变动会触发回调
      clearances.get(container)?.disconnect()
      clearances.delete(container)
      try { vditor.destroy() } catch { /* 已销毁 */ }
      instance = null
    },
  }
}

/**
 * 把光标放到编辑器末尾。
 * 三条实测结论（缺一条就不 work）：
 *   ① 页面里有两个 <pre class="vditor-reset">（ir 与 wysiwyg 各一个，隐藏那个是空的），
 *      必须挑可见的那个，否则光标永远放不到末尾；
 *   ② 先 focus() 再设 Range，反过来会被 focus 的光标重定位冲掉；
 *   ③ 不要依赖 children（渲染未稳时是空集合），沿 lastChild 下钻最稳；Vditor 是异步渲染，要重试。
 */
function focusAtEnd(container: HTMLElement, getVditor: () => Vditor, retries = 25, interval = 90): void {
  const contentRoot = (): HTMLElement | null => {
    const pres = [...container.querySelectorAll('pre.vditor-reset')] as HTMLElement[]
    if (pres.length === 0) return null
    return pres.find(p => p.offsetParent !== null) ?? pres[pres.length - 1] ?? null
  }
  const deepestLast = (el: Node): Node => {
    let node: Node = el
    let guard = 0
    while (node.lastChild && guard++ < 200) node = node.lastChild
    return node
  }

  const attempt = (): boolean => {
    const host = contentRoot()
    if (!host) return false
    try {
      getVditor().focus()
      const deep = deepestLast(host)
      const range = document.createRange()
      if (deep.nodeType === Node.TEXT_NODE) {
        range.setStart(deep, (deep as Text).length)
      } else {
        range.selectNodeContents(deep)
        range.collapse(false)
      }
      range.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)

      const s2 = window.getSelection()
      const r2 = s2 && s2.rangeCount > 0 ? s2.getRangeAt(0) : null
      if (!r2) return false
      // 失败特征：光标停在容器自身的 offset 0（文首）
      if (r2.startContainer === host && r2.startOffset === 0) return false
      const tail = document.createRange()
      tail.selectNodeContents(host)
      tail.setStart(r2.endContainer, r2.endOffset)
      if (tail.toString().replace(/[\s\u200b\ufeff]/g, '') !== '') return false
      // 光标到位了还不够 —— 必须让视图也滚过去。
      // 否则「输入框变高把面板压矮 → 再呼出」时，光标虽在末尾，
      // 用户看到的却还是最上面那一段，得手动滚下去。
      scrollCaretIntoView(container, r2)
      return true
    } catch {
      return false
    }
  }

  if (attempt()) return
  let n = 0
  const timer = window.setInterval(() => {
    n++
    if (attempt() || n >= retries) window.clearInterval(timer)
  }, interval)
}

/**
 * 把光标位置滚进可视区。
 *
 * `Range` 没有原生 `scrollIntoView`，所以插一个折叠的 `<span>` 当锚点，
 * 滚完立刻移除。
 *
 * 遍历**所有**可滚动的祖先（不预设是哪一层）—— 实测滚动条可能出现在
 * 内容根、其上层的 `.vditor-*` 包装、甚至面板的 body 上，写死一层就会漏。
 * 对每一层都做「光标进入可视区」的修正，滚不动的那层自然不动。
 *
 * @param container - 编辑区容器（限定查找范围，并作为遍历上界）。
 * @param range - 当前光标 range。
 */
function scrollCaretIntoView(container: HTMLElement, range: Range): void {
  let anchor: HTMLElement | null = null
  try {
    anchor = document.createElement('span')
    anchor.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;'
    const target = range.cloneRange()
    target.collapse(true)
    target.insertNode(anchor)

    let el: HTMLElement | null = anchor.parentElement
    while (el && el !== container.parentElement) {
      const cs = getComputedStyle(el)
      const canScrollY = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1
      const canScrollX = /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1
      if (canScrollY || canScrollX) {
        const er = el.getBoundingClientRect()
        const ar = anchor.getBoundingClientRect()
        if (canScrollY) {
          // 目标：光标落在可视区下沿往上 1/4 处，下面留出继续书写的空间
          const want = er.top + er.height * 0.75
          const delta = ar.bottom > er.bottom ? ar.bottom - want : (ar.top < er.top ? ar.top - want : 0)
          if (delta) el.scrollTop += Math.round(delta)
        }
        if (canScrollX) {
          const deltaX = ar.right > er.right ? ar.right - er.right + 8 : (ar.left < er.left ? ar.left - er.left - 8 : 0)
          if (deltaX) el.scrollLeft += Math.round(deltaX)
        }
      }
      el = el.parentElement
    }
  } catch {
    // 插入锚点失败（选区被冻结等）就算了，不因为滚动影响光标本身
  } finally {
    anchor?.remove()
  }
}

/**
 * 从节点向上找列表项（LI）。
 * Tab 缩进要用：Vditor 只在「光标位于行首」时缩进，需要先把光标挪到行首。
 */
export function closestLi(node: Node | null): HTMLElement | null {
  let el: Node | null = node
  while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode
  let cur = el as HTMLElement | null
  while (cur) {
    if (cur.tagName === 'LI') return cur
    cur = cur.parentElement
  }
  return null
}

/** 光标是否已在该行最前面。 */
export function isAtLineStart(range: Range): boolean {
  const { startContainer, startOffset } = range
  if (startOffset !== 0) return false
  if (startContainer.nodeType === Node.ELEMENT_NODE) return true
  let prev = startContainer.previousSibling
  while (prev) {
    if ((prev.textContent ?? '').replace(/[\s\u200b\ufeff]/g, '') !== '') return false
    prev = prev.previousSibling
  }
  return true
}
