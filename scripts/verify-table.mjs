// 表格专项验收：单元格配色 + 表格控件栏是否被头部遮挡 + 拖拽把手可达性
// 用法：node scripts/verify-table.mjs <token> [cdpPort] [appPort]
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const token = process.argv[2]
const PORT = Number(process.argv[3] ?? 3180)
const APP_PORT = Number(process.argv[4] ?? 3099)
if (!token) { console.error('缺 token'); process.exit(2) }
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\dsh-md-tbl-${Date.now()}`,
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
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r?.data) { fs.writeFileSync(name, Buffer.from(r.data, 'base64')); console.log('截图: ' + name) }
}

await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable'); await send('Page.enable')
await sleep(13000)

await ev(`window.dispatchEvent(new CustomEvent('dshmd:open-panel'))`)
await sleep(4500)

// 用 Vditor 实例 API 写入真表格。
// 关键：必须先清空 —— 否则表格不会位于编辑区首行，就测不到「表格在首行时
// 控件栏被面板头部遮挡」这个场景。
const wrote = await ev(`(async () => {
  const p = document.querySelector('.dshmd-panel')
  if (!p) return 'no-panel'
  const box = p.querySelector('.dshmd-editor')
  const v = box && box.__dshmdEditor
  if (!v) return 'no-editor-instance'
  v.setValue('')
  await new Promise(r => setTimeout(r, 300))
  v.setValue('| 姓名 | 年龄 |\\n| --- | --- |\\n| 张三 | 30 |\\n')
  await new Promise(r => setTimeout(r, 1200))
  const table = p.querySelector('table')
  const pre = [...p.querySelectorAll('pre.vditor-reset')].filter(x => x.offsetParent !== null)[0]
  return {
    ok: true,
    tableFound: !!table,
    // 表格是不是编辑区里的第一个块
    isFirstBlock: !!table && pre ? pre.firstElementChild === table || pre.firstElementChild?.contains(table) : null,
    tableTop: table ? Math.round(table.getBoundingClientRect().top) : null,
  }
})()`)
console.log('写入表格:', J(wrote))
await sleep(3000)

const tbl = await ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  if (!p) return { panel: false }
  const table = p.querySelector('table')
  const td = table?.querySelector('td')
  const th = table?.querySelector('th')
  const tr = table?.querySelector('tr')
  const g = el => {
    if (!el) return null
    const c = getComputedStyle(el)
    return { bg: c.backgroundColor, color: c.color }
  }
  return {
    panel: true,
    tableFound: !!table,
    tr: g(tr), td: g(td), th: g(th),
    tdText: td?.textContent ?? null,
    // 对照：编辑器正文色
    bodyColor: (() => { const pre = p.querySelector('pre.vditor-reset'); return pre ? getComputedStyle(pre).color : null })(),
  }
})()`)
console.log('\n表格配色:', J(tbl))
check('表格已渲染成 <table>', tbl?.tableFound === true, { tableFound: tbl?.tableFound, tdText: tbl?.tdText })

/** 判断两个颜色是否「可读」：用相对亮度差粗判 */
const readable = await ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  const td = p?.querySelector('table td')
  if (!td) return null
  const c = getComputedStyle(td)
  const parse = s => {
    const m = s.match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const [r, g, b, a = '1'] = m[1].split(',').map(x => parseFloat(x))
    return { r, g, b, a: parseFloat(a) }
  }
  const lum = ({ r, g, b }) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const bg = parse(c.backgroundColor)
  const fg = parse(c.color)
  if (!bg || !fg) return { bg: c.backgroundColor, fg: c.color, ratio: null }
  // 背景可能是透明的，那就往上找
  let backdrop = bg
  if (bg.a === 0) {
    let el = td
    while (el && el !== document.documentElement) {
      el = el.parentElement
      const cc = parse(getComputedStyle(el).backgroundColor)
      if (cc && cc.a > 0) { backdrop = cc; break }
    }
  }
  const L1 = lum(fg), L2 = lum(backdrop)
  const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
  return { bg: c.backgroundColor, fg: c.color, backdrop, ratio: Math.round(ratio * 100) / 100 }
})()`)
console.log('\n对比度:', J(readable))
check('单元格文字对比度 ≥ 4.5（可读）', (readable?.ratio ?? 0) >= 4.5, readable)
await shot('tbl-1.png')

// ---- 表格控件栏是否被头部遮挡 ----
console.log('\n=== 点进单元格，检查表格控件栏 ===')
const cellPt = await ev(`(() => {
  const td = document.querySelector('.dshmd-panel table td')
  if (!td) return null
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
if (cellPt) { await clickAt(cellPt.x, cellPt.y); await sleep(1800) }

const popover = await ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  if (!p) return null
  const head = p.querySelector('.dshmd-head')
  const headRect = head?.getBoundingClientRect()
  const panels = [...p.querySelectorAll('.vditor-panel, .vditor-hint')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 60 && r.height > 10 && getComputedStyle(el).display !== 'none' })
  return {
    headBottom: headRect ? Math.round(headRect.bottom) : null,
    panels: panels.map(el => {
      const r = el.getBoundingClientRect()
      return { cls: String(el.className).slice(0, 50), top: Math.round(r.top), bottom: Math.round(r.bottom),
               h: Math.round(r.height), left: Math.round(r.left), w: Math.round(r.width),
               z: getComputedStyle(el).zIndex,
               coveredByHead: headRect ? r.top < headRect.bottom : null,
               text: (el.innerText || '').slice(0, 36) }
    }),
  }
})()`)
console.log('控件栏:', J(popover))
const covered = (popover?.panels ?? []).filter(p => p.coveredByHead === true)
check('表格控件栏没有被面板头部遮挡', covered.length === 0, { covered, all: popover?.panels })
await shot('tbl-2.png')

// ---- 拖拽把手可达性 ----
console.log('\n=== 拖到最高后把手是否还能按到 ===')
await ev(`(() => {
  const panel = document.querySelector('.dshmd-panel')
  const handle = panel.querySelector('.dshmd-resize')
  const ab = panel.getBoundingClientRect().bottom
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: ab - 300, pointerId: 7 }))
  handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: -500, pointerId: 7 }))
  handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: -500, pointerId: 7 }))
})()`)
await sleep(800)
const maxState = await ev(`(() => {
  const p = document.querySelector('.dshmd-panel')
  const pr = p.getBoundingClientRect()
  const hr = p.querySelector('.dshmd-resize').getBoundingClientRect()
  // 用 elementFromPoint 验证把手顶部那一点真的能命中把手
  const probeY = Math.round(hr.top + 1)
  const probeX = Math.round(hr.left + hr.width / 2)
  const hit = document.elementFromPoint(probeX, probeY)
  return {
    panelTop: Math.round(pr.top), panelH: Math.round(pr.height),
    handleTop: Math.round(hr.top), handleBottom: Math.round(hr.bottom),
    handleFullyInViewport: hr.top >= 0,
    hitAtHandleTop: hit ? hit.tagName + '.' + String(hit.className).split(' ')[0] : null,
    hitsHandle: !!hit?.closest?.('.dshmd-resize'),
  }
})()`)
console.log('拖到最高:', J(maxState))
check('拖到最高时把手完整在视口内', maxState?.handleFullyInViewport === true, maxState)
check('拖到最高时把手仍可被命中（能拉回来）', maxState?.hitsHandle === true, maxState)
await shot('tbl-3-max.png')

check('无控制台错误', errors.length === 0, errors.slice(0, 5))
console.log('\n通过 ' + results.filter(r => r.pass).length + '/' + results.length)
ws.close(); chrome.kill(); process.exit(results.every(r => r.pass) ? 0 : 1)
