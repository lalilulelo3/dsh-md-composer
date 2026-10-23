// 针对第四轮反馈的专项验收
//   1. 拖到极限后，顶栏 / 控件栏 / 编辑区都不被遮挡（面板不向上溢出）
//   2. 输入框变高时，面板自动收窄而不是向上溢出
//   3. 工具栏按钮有原生 title（悬停显示名称）
//   4. 表格控件栏可见（不被顶栏压住）
// 用法：node scripts/verify-overflow.mjs <token> [cdpPort] [appPort]
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const token = process.argv[2]
const PORT = Number(process.argv[3] ?? 3220)
const APP_PORT = Number(process.argv[4] ?? 3099)
if (!token) { console.error('缺 token'); process.exit(2) }
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\dsh-md-ovf-${Date.now()}`,
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
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const shot = async n => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r?.data) { fs.writeFileSync(n, Buffer.from(r.data, 'base64')); console.log('截图: ' + n) }
}

await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable'); await send('Page.enable')
await sleep(13000)

await ev(`window.dispatchEvent(new CustomEvent('dshmd:open-panel'))`)
await sleep(4500)

// ---------- 1. 拖到极限：面板不得向上溢出 ----------
await ev(`(() => {
  const panel = document.querySelector('.dshmd-panel')
  const handle = panel.querySelector('.dshmd-resize')
  const ab = panel.getBoundingClientRect().bottom
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: ab - 300, pointerId: 11 }))
  handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: -900, pointerId: 11 }))
  handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: -900, pointerId: 11 }))
})()`)
await sleep(900)
const dragged = await ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  const pr = p.getBoundingClientRect()
  const head = p.querySelector('.dshmd-head').getBoundingClientRect()
  const tb = p.querySelector('.vditor-toolbar').getBoundingClientRect()
  const ed = p.querySelector('.dshmd-editor').getBoundingClientRect()
  const hd = p.querySelector('.dshmd-resize').getBoundingClientRect()
  return {
    panelTop: Math.round(pr.top), panelH: Math.round(pr.height),
    headTop: Math.round(head.top), headBottom: Math.round(head.bottom),
    toolbarTop: Math.round(tb.top), toolbarBottom: Math.round(tb.bottom),
    editorTop: Math.round(ed.top), editorBottom: Math.round(ed.bottom),
    handleTop: Math.round(hd.top), handleBottom: Math.round(hd.bottom),
    viewportH: window.innerHeight,
    // 溢出判定
    panelOverflowsTop: pr.top < 0,
    toolbarCoveredByHead: tb.top < head.bottom - 1,
    editorCoveredByHead: ed.top < head.bottom - 1,
    handleInViewport: hd.top >= 0,
    // 可视面积：工具栏/GY
    toolbarVisible: tb.top >= 0 && tb.bottom <= window.innerHeight,
  }
})()`)
console.log('拖到极限后:', J(dragged))
check('1a 面板不向上溢出视口', dragged?.panelOverflowsTop === false, { panelTop: dragged?.panelTop })
check('1b 控件栏（工具栏）没有被顶栏压住', dragged?.toolbarCoveredByHead === false,
  { toolbarTop: dragged?.toolbarTop, headBottom: dragged?.headBottom })
check('1c 编辑区没有被顶栏压住', dragged?.editorCoveredByHead === false,
  { editorTop: dragged?.editorTop, headBottom: dragged?.headBottom })
check('1d 拖拽把手仍在视口内（还能拉回来）', dragged?.handleInViewport === true, { handleTop: dragged?.handleTop })
await shot('ovf-1-max.png')

// ---------- 2. 输入框变高：面板应收窄而非溢出 ----------
// 先复位到舒适高度
await ev(`document.querySelector('.dshmd-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
await sleep(700)
// 把输入框内容加多，撑高它
const before = await ev(`(() => {
  const card = document.querySelector('[data-composer-card]')
  const p = document.querySelector('.dshmd-panel')
  return { cardH: Math.round(card.getBoundingClientRect().height), panelTop: Math.round(p.getBoundingClientRect().top) }
})()`)
// ---------- 1e. 拖拽期间输入框变高（缓存锚点会失效的经典场景）----------
await ev(`document.querySelector('.dshmd-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
await sleep(700)
await ev(`(() => {
  const panel = document.querySelector('.dshmd-panel')
  const handle = panel.querySelector('.dshmd-resize')
  const ab = panel.getBoundingClientRect().bottom
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: ab - 200, pointerId: 21 }))
})()`)
await sleep(300)
// 拖拽进行中：把输入框撑高（此时若锚点被缓存，高度就会算错）
await ev(`(() => {
  const input = document.querySelector('[data-composer-input]')
  input.focus()
  document.execCommand('insertText', false, Array.from({length: 12}, (_, i) => '拖拽中第 ' + (i+1) + ' 行').join('\\n'))
})()`)
await sleep(900)
await ev(`(() => {
  const handle = document.querySelector('.dshmd-resize')
  handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: -900, pointerId: 21 }))
  handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: -900, pointerId: 21 }))
})()`)
await sleep(900)
const midDrag = await ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  const pr = p.getBoundingClientRect()
  const hd = p.querySelector('.dshmd-resize').getBoundingClientRect()
  const hit = document.elementFromPoint(Math.round(hd.left + hd.width / 2), Math.round(hd.top + 1))
  return {
    panelTop: Math.round(pr.top), handleTop: Math.round(hd.top),
    overflows: pr.top < 0, handleVisible: hd.top >= 0,
    hitsHandle: !!hit?.closest?.('.dshmd-resize'),
  }
})()`)
console.log('\n拖拽中撑高输入框后:', J(midDrag))
check('1e 拖拽期间输入框变高，面板仍不溢出、把手仍可抓',
  midDrag?.overflows === false && midDrag?.handleVisible === true && midDrag?.hitsHandle === true, midDrag)
await shot('ovf-1b-drag-tall.png')
await ev(`(() => { const i = document.querySelector('[data-composer-input]'); i.focus(); document.execCommand('selectAll'); document.execCommand('delete') })()`)
await sleep(1200)

await ev(`(() => {
  const input = document.querySelector('[data-composer-input]')
  const lines = Array.from({ length: 14 }, (_, i) => '多行草稿第 ' + (i + 1) + ' 行').join('\\n')
  input.focus()
  document.execCommand('insertText', false, lines)
})()`)
await sleep(2200)
const after = await ev(`(() => {
  const card = document.querySelector('[data-composer-card]')
  const p = document.querySelector('.dshmd-panel')
  const pr = p.getBoundingClientRect()
  const head = p.querySelector('.dshmd-head').getBoundingClientRect()
  const tb = p.querySelector('.vditor-toolbar').getBoundingClientRect()
  return {
    cardH: Math.round(card.getBoundingClientRect().height),
    panelTop: Math.round(pr.top), panelH: Math.round(pr.height),
    panelOverflowsTop: pr.top < 0,
    toolbarCoveredByHead: tb.top < head.bottom - 1,
    gapToComposer: Math.round(card.getBoundingClientRect().top - pr.bottom),
  }
})()`)
console.log('\n输入框变高 前:', J(before))
console.log('输入框变高 后:', J(after))
check('2a 输入框确实变高了', (after?.cardH ?? 0) > (before?.cardH ?? 0), { before: before?.cardH, after: after?.cardH })
check('2b 输入框变高后面板不向上溢出', after?.panelOverflowsTop === false, { panelTop: after?.panelTop })
check('2c 输入框变高后控件栏仍未被压住', after?.toolbarCoveredByHead === false)
check('2d 面板下端仍贴合输入框', Math.abs(after?.gapToComposer ?? 99) <= 2, { gap: after?.gapToComposer })
await shot('ovf-2-tallcomposer.png')

// 清理输入框
await ev(`(() => { const i = document.querySelector('[data-composer-input]'); i.focus(); document.execCommand('selectAll'); document.execCommand('delete') })()`)
await sleep(1200)

// ---------- 3. 工具栏按钮有原生 title ----------
const tips = await ev(`(() => {
  const btns = [...document.querySelectorAll('.dshmd-panel .vditor-toolbar__item > button')]
  return {
    total: btns.length,
    withTitle: btns.filter(b => b.getAttribute('title')).length,
    sample: btns.slice(0, 8).map(b => (b.getAttribute('data-type') || '?') + '→' + (b.getAttribute('title') || '无')),
  }
})()`)
check('3 工具栏按钮都有原生 title（悬停显示名称）', tips?.total > 0 && tips?.total === tips?.withTitle, tips)

// ---------- 4. 表格控件栏不被顶栏压住 ----------
await ev(`(async () => {
  const box = document.querySelector('.dshmd-editor')
  const v = box && box.__dshmdEditor
  v.setValue('')
  await new Promise(r => setTimeout(r, 300))
  v.setValue('| 姓名 | 年龄 |\\n| --- | --- |\\n| 张三 | 30 |\\n')
})()`)
await sleep(3000)
const td = await ev(`(() => {
  const cell = document.querySelector('.dshmd-panel table td')
  if (!cell) return null
  const r = cell.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
if (td) { await clickAt(td.x, td.y); await sleep(2000) }
const tblState = await ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  const head = p.querySelector('.dshmd-head').getBoundingClientRect()
  const toolbar = p.querySelector('.vditor-toolbar').getBoundingClientRect()
  const panels = [...p.querySelectorAll('.vditor-panel, .vditor-hint')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 60 && r.height > 10 && getComputedStyle(el).display !== 'none' })
  return {
    headBottom: Math.round(head.bottom),
    toolbarBottom: Math.round(toolbar.bottom),
    editorPaddingTop: (() => {
      const pre = [...p.querySelectorAll('pre.vditor-reset')].filter(x => x.offsetParent !== null)[0]
      return pre ? getComputedStyle(pre).paddingTop : null
    })(),
    panels: panels.map(el => {
      const r = el.getBoundingClientRect()
      // 关键：控件栏头顶上是**工具栏**，不是顶栏。
      // 只断言「没被顶栏遮」是不够的 —— 真正会压住它的正是工具栏，
      // 而工具栏比顶栏更低，所以那个断言会漏报。
      return { cls: String(el.className).slice(0, 40), top: Math.round(r.top), h: Math.round(r.height),
               buttons: el.querySelectorAll('button').length,
               coveredByHead: r.top < head.bottom,
               coveredByToolbar: r.top < toolbar.bottom,
               clearPx: Math.round(r.top - toolbar.bottom) }
    }),
  }
})()`)
console.log('\n表格控件栏:', J(tblState))
const covered = (tblState?.panels ?? []).filter(p => p.coveredByToolbar || p.coveredByHead)
check('4 表格控件栏未被工具栏/顶栏压住（这是真正压住它的那一层）',
  (tblState?.panels?.length ?? 0) > 0 && covered.length === 0,
  { covered, all: tblState?.panels, editorPaddingTop: tblState?.editorPaddingTop })
await shot('ovf-3-table.png')

check('无控制台错误', errors.length === 0, errors.slice(0, 5))
console.log('\n通过 ' + results.filter(r => r.pass).length + '/' + results.length)
ws.close(); chrome.kill(); process.exit(results.every(r => r.pass) ? 0 : 1)
