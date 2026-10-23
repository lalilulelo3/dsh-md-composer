// 拖拽真机验收 —— **必须用真实输入事件（CDP Input.dispatchMouseEvent）**。
//
// 为什么不能用合成事件：
//   用 `element.dispatchEvent(new PointerEvent(...))` 会把事件**直接投递给目标元素**，
//   绕过浏览器的指针捕获机制。而真实拖拽的失败恰恰发生在捕获上
//   （鼠标移出视口 → `lostpointercapture` → 后续 pointermove 全丢）。
//   合成事件因此永远「通过」，会让这类 bug 完全漏检。
//
// 用法：node scripts/verify-drag-real.mjs <token> [cdpPort] [appPort]
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const token = process.argv[2]
const PORT = Number(process.argv[3] ?? 3290)
const APP_PORT = Number(process.argv[4] ?? 3099)
if (!token) { console.error('缺 token'); process.exit(2) }
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\dsh-md-dragreal-${Date.now()}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1292,890',
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

/** 真实鼠标：移动到 / 按下 / 拖动 / 松开 */
const mouseMove = (x, y, buttons) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons })
const mouseDown = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
const mouseUp = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })

const geom = () => ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  if (!p) return null
  const pr = p.getBoundingClientRect()
  const hd = p.querySelector('.dshmd-resize').getBoundingClientRect()
  const tb = p.querySelector('.vditor-toolbar').getBoundingClientRect()
  const head = p.querySelector('.dshmd-head').getBoundingClientRect()
  const hit = document.elementFromPoint(Math.round(hd.left + hd.width / 2), Math.max(0, Math.round(hd.top + 1)))
  return {
    panelTop: Math.round(pr.top), panelH: Math.round(pr.height),
    handleTop: Math.round(hd.top), handleBottom: Math.round(hd.bottom),
    toolbarTop: Math.round(tb.top), headBottom: Math.round(head.bottom),
    handleInViewport: hd.top >= 0,
    hitsHandle: !!hit?.closest?.('.dshmd-resize'),
    viewportH: window.innerHeight,
  }
})()`)

await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable'); await send('Page.enable')
await sleep(13000)

await ev(`window.dispatchEvent(new CustomEvent('dshmd:open-panel'))`)
await sleep(4500)

// ---------- 真实拖拽：一直往上拖 ----------
const start = await ev(`(() => {
  const r = document.querySelector('.dshmd-resize').getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
console.log('把手起点:', J(start))

await mouseMove(start.x, start.y, 0)
await sleep(200)
await mouseDown(start.x, start.y)
await sleep(300)
const downOk = await ev(`document.body.classList.contains('dshmd-resizing-body')`)
check('D1 真实鼠标按下能进入拖拽态', downOk === true)

// 逐步上移，覆盖「移出视口」这一步 —— 这正是原来断掉的地方
const trace = []
for (const y of [start.y - 40, start.y - 100, 60, 30, 10, 2, -50, -200]) {
  await mouseMove(start.x, y, 1)
  await sleep(260)
  const g = await geom()
  trace.push({ mouseY: y, panelTop: g?.panelTop, panelH: g?.panelH, handleTop: g?.handleTop })
}
console.log('\n拖拽轨迹:')
for (const t of trace) console.log('  ' + J(t))
await mouseUp(start.x, -200)
await sleep(400)

const atMax = await geom()
console.log('\n拖到顶:', J(atMax))
check('D2 一直往上拖后，面板不向上溢出视口', (atMax?.panelTop ?? -1) >= 0, { panelTop: atMax?.panelTop })
check('D3 拖到顶后把手仍在视口内', atMax?.handleInViewport === true, { handleTop: atMax?.handleTop })
check('D4 拖到顶后把手仍可被真实命中', atMax?.hitsHandle === true)
check('D5 拖到顶后控件栏没有被顶栏压住', (atMax?.toolbarTop ?? 0) >= (atMax?.headBottom ?? 0) - 1,
  { toolbarTop: atMax?.toolbarTop, headBottom: atMax?.headBottom })
// 每一步都必须保持不溢出（中途失联会让面板停在半空）
const anyOverflow = trace.filter(t => (t.panelTop ?? 0) < 0 || (t.handleTop ?? 0) < 0)
check('D6 拖拽全程每一步都不溢出（说明移动事件没中断）', anyOverflow.length === 0, anyOverflow)
await shot('drag-real-1-max.png')

// ---------- 还能拉回来 ----------
const back = await ev(`(() => {
  const r = document.querySelector('.dshmd-resize').getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
await mouseMove(back.x, back.y, 0)
await sleep(200)
await mouseDown(back.x, back.y)
await sleep(250)
for (const dy of [80, 180, 300]) {
  await mouseMove(back.x, back.y + dy, 1)
  await sleep(250)
}
await mouseUp(back.x, back.y + 300)
await sleep(500)
const shrunk = await geom()
console.log('\n往回拖之后:', J(shrunk))
check('D7 拖到顶后还能再拉回来（高度变小）',
  (shrunk?.panelH ?? 0) < (atMax?.panelH ?? 0), { max: atMax?.panelH, after: shrunk?.panelH })
await shot('drag-real-2-back.png')

check('D8 无控制台错误', errors.length === 0, errors.slice(0, 5))
console.log('\n通过 ' + results.filter(r => r.pass).length + '/' + results.length)
ws.close(); chrome.kill(); process.exit(results.every(r => r.pass) ? 0 : 1)
