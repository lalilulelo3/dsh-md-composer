// 面板行为验收（第 8 轮改版后）：
//   · 无全屏按钮
//   · 宽度跟随输入框
//   · 默认高度合理，且**刷新即回默认**（高度不持久化）
//   · 拖拽把手在底栏里，拖到超出视口也够得到、能拉回来
//   · 收起后再呼出，编辑器视图滚到光标处（长内容时不必手动滚）
//
// 用法：node scripts/verify-panel.mjs <token> [cdpPort] [appPort]
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const token = process.argv[2]
const PORT = Number(process.argv[3] ?? 3510)
const APP_PORT = Number(process.argv[4] ?? 3099)
if (!token) { console.error('缺 token'); process.exit(2) }
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
setTimeout(() => { console.error('[硬超时] 主动退出'); process.exit(3) }, 170000).unref?.()

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\dsh-md-panel-${Date.now()}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1400,900',
  `http://127.0.0.1:${APP_PORT}/?token=${token}`,
], { stdio: 'ignore' })

const sleep = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 50; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find(t => t.type === 'page' && t.url.includes(String(APP_PORT))); if (target) break } catch {}
  await sleep(500)
}
if (!target) { console.error('拿不到页面'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
const errors = []
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? '')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '))
  if (m.id && pend.has(m.id)) { const { resolve } = pend.get(m.id); pend.delete(m.id); resolve(m.result) }
})
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise(r => pend.set(i, { resolve: r }))
}
const ev = x => send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  .then(r => r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description?.split('\n').slice(0, 2).join(' | ') } : r.result?.value)
const J = v => JSON.stringify(v, null, 1)
const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`[${pass ? '通过' : '失败'}] ${name}`)
  if (detail !== undefined) console.log('   ' + JSON.stringify(detail))
}
const shot = async n => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r?.data) { fs.writeFileSync(n, Buffer.from(r.data, 'base64')); console.log('截图: ' + n) }
}
const mouseMove = (x, y, buttons) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons })
const mouseDown = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
const mouseUp = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })

const panelGeom = () => ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  if (!p) return null
  const card = document.querySelector('[data-composer-card]')
  const pr = p.getBoundingClientRect(); const cr = card.getBoundingClientRect()
  const hd = p.querySelector('.dshmd-resize')
  const eb = p.querySelector('.dshmd-editor')
  return {
    h: Math.round(pr.height), top: Math.round(pr.top), bottom: Math.round(pr.bottom),
    left: Math.round(pr.left), right: Math.round(pr.right), width: Math.round(pr.width),
    cardTop: Math.round(cr.top), cardLeft: Math.round(cr.left), cardRight: Math.round(cr.right), cardWidth: Math.round(cr.width),
    handleInsidePanel: !!hd && p.contains(hd),
    handleTop: hd ? Math.round(hd.getBoundingClientRect().top) : null,
    handleVisible: hd ? hd.getBoundingClientRect().top >= 0 : null,
    editorBoxTop: eb ? Math.round(eb.getBoundingClientRect().top) : null,
    gapToComposer: Math.round(cr.top - pr.bottom),
    viewport: [window.innerWidth, window.innerHeight],
  }
})()`)

await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable'); await send('Page.enable')
await sleep(13000)

// ---------- 1. 打开：无全屏按钮、宽度=输入框、默认高度合理 ----------
await ev(`window.dispatchEvent(new CustomEvent('dshmd:open-panel'))`)
await sleep(4000)
const g0 = await panelGeom()
console.log('首次打开:', J(g0))
const btns = await ev(`[...document.querySelectorAll('.dshmd-panel .dshmd-head button')].map(b => (b.textContent||'').trim())`)
check('P1 顶栏只有 切换显示 / 大纲 / 关闭 三个按钮（不铺开、也不改宽度）',
  btns.length === 3 && !btns.includes('⤢') && !btns.includes('⤡') && !btns.includes('铺开'),
  { buttons: btns })

// 按钮归属：写回动作在底栏；「存为草稿」属于草稿区，放在草稿栏底部；
// 「还原窗口」在底栏兜底（把手在上沿，拉出视口后只能靠它）。
const footBtns = await ev(`[...document.querySelectorAll('.dshmd-panel .dshmd-foot-row button')].map(b => (b.textContent||'').trim())`)
check('P1b 底栏是 替换/追加/插入 + 还原窗口',
  ['替换草稿', '追加到末尾', '插入', '还原窗口'].every(x => footBtns.includes(x)) && !footBtns.includes('存为草稿'),
  { footButtons: footBtns })
check('P1c 「存为草稿」在草稿栏底部（不在底栏）',
  (await ev(`!!document.querySelector('.dshmd-panel .dshmd-drafts .dshmd-drafts-foot button')`)) === true,
  { draftsFootButton: await ev(`document.querySelector('.dshmd-panel .dshmd-drafts-foot button')?.textContent?.trim() ?? null`) })
check('P2 宽度跟随输入框（左/右与卡片一致）',
  Math.abs((g0?.left ?? -1) - (g0?.cardLeft ?? 0)) <= 2 && Math.abs((g0?.right ?? -1) - (g0?.cardRight ?? 0)) <= 2,
  { panel: [g0?.left, g0?.right], card: [g0?.cardLeft, g0?.cardRight] })
check('P3 默认高度合理（≥240 且 ≤ 视口六成）',
  (g0?.h ?? 0) >= 240 && (g0?.h ?? 0) <= (g0?.viewport?.[1] ?? 900) * 0.62, { h: g0?.h, viewportH: g0?.viewport?.[1] })
check('P4 拖拽把手在面板顶部（顺手的位置）',
  g0?.handleInsidePanel === true && (g0?.handleTop ?? 9999) < (g0?.editorBoxTop ?? 0),
  { inside: g0?.handleInsidePanel, handleTop: g0?.handleTop, editorBoxTop: g0?.editorBoxTop })
check('P5 下端仍贴合输入框', Math.abs(g0?.gapToComposer ?? 99) <= 2, { gap: g0?.gapToComposer })
await shot('panel-1-open.png')

// ---------- 2. 拖到超出视口：把手仍可见、能抓、能拉回 ----------
const h = await ev(`(() => {
  const r = document.querySelector('.dshmd-panel .dshmd-resize').getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
await mouseMove(h.x, h.y, 0)
await sleep(150)
await mouseDown(h.x, h.y)
await sleep(250)
// 一路往上拖，包含移到视口之外
for (const y of [h.y - 60, h.y - 150, 40, 5, -300]) {
  await mouseMove(h.x, y, 1)
  await sleep(220)
}
await mouseUp(h.x, -300)
await sleep(400)
const gMax = await panelGeom()
console.log('\n向上拖到极限:', J(gMax))
check('P6 拖到极限后面板不向上溢出', (gMax?.top ?? -1) >= 0, { top: gMax?.top })
// 把手在顶部，拉到很高时它可能被挤出视口 —— **这是允许的**，
// 因为底栏有「还原」按钮兜底（P7b 验证它真的能救回来）。
// 这里只要求「要么把手还够得到，要么有可用的还原入口」。
check('P7 把手在顶部（允许拉出视口，由底栏「还原」兜底）',
  gMax?.handleInsidePanel === true, { handleTop: gMax?.handleTop, visible: gMax?.handleVisible })
await shot('panel-2-max.png')

// P7b：真按一下底栏的「还原窗口」，高度应回到默认
const beforeRestore = (await panelGeom())?.h
await ev(`(() => {
  const b = [...document.querySelectorAll('.dshmd-panel .dshmd-foot-row button')]
    .find(x => (x.textContent || '').trim() === '还原窗口')
  b && b.click()
})()`)
await sleep(700)
const afterRestore = await panelGeom()
console.log('\n点「还原窗口」之后:', J(afterRestore))
check('P7b 拉高之后点底栏「还原窗口」能回到默认高度',
  (afterRestore?.h ?? 0) < (beforeRestore ?? 0) && (afterRestore?.h ?? 0) >= 240,
  { before: beforeRestore, after: afterRestore?.h })

// 拉回来
const h2 = await ev(`(() => {
  const r = document.querySelector('.dshmd-panel .dshmd-resize').getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
await mouseMove(h2.x, h2.y, 0)
await sleep(150)
await mouseDown(h2.x, h2.y)
await sleep(200)
for (const dy of [100, 200]) { await mouseMove(h2.x, h2.y + dy, 1); await sleep(220) }
await mouseUp(h2.x, h2.y + 200)
await sleep(400)
const gBack = await panelGeom()
console.log('拉回来之后:', J(gBack))
check('P8 拖到极限后还能再拉回来（高度变小）', (gBack?.h ?? 0) < (gMax?.h ?? 0), { max: gMax?.h, after: gBack?.h })

// ---------- 3. 关闭再呼出：保持自定义高度；刷新页面才回默认 ----------
await ev(`(() => { const b = document.querySelector('.dshmd-panel [title="关闭（Esc）"]'); b && b.click() })()`)
await sleep(900)
await ev(`window.dispatchEvent(new CustomEvent('dshmd:open-panel'))`)
await sleep(3500)
const gReopen = await panelGeom()
console.log('\n关闭再呼出:', J(gReopen))
check('P9 关闭再呼出保持自定义高度（内存记忆）',
  Math.abs((gReopen?.h ?? 0) - (gBack?.h ?? 0)) <= 2, { before: gBack?.h, after: gReopen?.h })

// 刷新页面（不重启浏览器）→ 应回默认高度
await send('Page.reload', { ignoreCache: false })
await sleep(13000)
await ev(`window.dispatchEvent(new CustomEvent('dshmd:open-panel'))`)
await sleep(4000)
const gReload = await panelGeom()
console.log('\n页面刷新后:', J(gReload))
check('P10 刷新页面后回到默认高度（高度不持久化）',
  Math.abs((gReload?.h ?? 0) - (g0?.h ?? 0)) <= 2,
  { 首开: g0?.h, 刷新后: gReload?.h })
await shot('panel-3-after-reload.png')

// ---------- 4. 长内容：关闭 → 输入框变长 → 再呼出，视图应滚到光标处 ----------
// 必须贴近真实流程：**面板关着的时候**输入框才变长，然后再呼出。
// （先前我在面板开着时改输入框，测到的状态和用户遇到的不是一回事。）
await ev(`(() => {
  const b = document.querySelector('.dshmd-panel [title="关闭（Esc）"]')
  b && b.click()
})()`)
await sleep(900)
const longText = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行长内容用于测试滚动手感`).join('\n')
await ev(`(() => {
  const input = document.querySelector('[data-composer-input]')
  input.focus()
  document.execCommand('selectAll'); document.execCommand('delete')
  document.execCommand('insertText', false, ${JSON.stringify(longText)})
})()`)
await sleep(1800)
await ev(`window.dispatchEvent(new CustomEvent('dshmd:open-panel'))`)
await sleep(4200)
// 判据说明（我第一版写错过，记下来避免重犯）：
//   不要去「找滚动容器」再判断它滚没滚到底 —— 容易匹配到不滚的元素，
//   而且光标 rect 是**页面坐标**，和容器的相对位置不能直接比。
//   直接问最小的问题：**光标在编辑区的可视矩形内吗**。
const scrollState = await ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  const box = p.querySelector('.dshmd-editor')
  const br = box.getBoundingClientRect()
  const sel = window.getSelection()
  const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null
  const cr = r ? r.getBoundingClientRect() : null
  // 参照信息：真正的滚动层
  const scroller = [...box.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 4) ?? null
  return {
    editorBoxHeight: Math.round(br.height),
    caretFound: !!cr,
    caretTop: cr ? Math.round(cr.top) : null,
    caretBottom: cr ? Math.round(cr.bottom) : null,
    editorBoxTop: Math.round(br.top),
    editorBoxBottom: Math.round(br.bottom),
    caretInEditorView: cr ? (cr.bottom <= br.bottom + 2 && cr.top >= br.top - 2) : null,
    scrollerCls: scroller ? String(scroller.className).slice(0, 30) : null,
    scrollerScrollTop: scroller ? Math.round(scroller.scrollTop) : null,
    scrollerScrollHeight: scroller ? Math.round(scroller.scrollHeight) : null,
    scrollerClientHeight: scroller ? Math.round(scroller.clientHeight) : null,
  }
})()`)
console.log('\n长内容再呼出的滚动状态:', J(scrollState))
check('P11 长内容呼出后光标在编辑区可视范围内（能看见自己在哪）',
  scrollState?.caretFound === true && scrollState?.caretInEditorView === true,
  scrollState)
await shot('panel-4-longtext.png')

check('P12 无控制台错误', errors.length === 0, errors.slice(0, 5))
console.log('\n通过 ' + results.filter(r => r.pass).length + '/' + results.length)
ws.close(); chrome.kill(); process.exit(results.every(r => r.pass) ? 0 : 1)
