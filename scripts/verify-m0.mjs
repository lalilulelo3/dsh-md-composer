// M0 验收：在隔离的 DSH 实例里验证「装上 → 进入启动图 → 浏览器半侧执行 → 零错误」
//
// 用法（两步）：
//   1) 起一个隔离实例（不碰日常 profile）：
//        $env:DSH_HOME="<本仓库>/_testhome"
//        dsh plugin --profile web add "<本仓库>/plugin"
//        dsh web --port 3099 --no-open
//   2) node scripts/verify-m0.mjs <token> [port]
//
// token 在 dsh web 启动日志的 URL 里（?token=...）。
import { spawn } from 'node:child_process'

const PORT = Number(process.argv[3] ?? 3102)
const APP_PORT = Number(process.argv[4] ?? 3099)
const token = process.argv[2]
if (!token) {
  console.error('缺 token：node scripts/verify-m0.mjs <token> [cdpPort] [appPort]')
  process.exit(2)
}
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const url = `http://127.0.0.1:${APP_PORT}/?token=${token}`

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\dsh-md-m0-${Date.now()}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1400,900', url,
], { stdio: 'ignore' })

const sleep = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 50; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = l.find(t => t.type === 'page' && t.url.includes(String(APP_PORT)))
    if (target) break
  } catch { /* retry */ }
  await sleep(500)
}
if (!target) { console.error('拿不到页面 target'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
const logs = []
const errors = []
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ')
    logs.push('[' + m.params.type + '] ' + text)
    if (m.params.type === 'error') errors.push(text)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? '')
  }
  if (m.id && pend.has(m.id)) { const { resolve } = pend.get(m.id); pend.delete(m.id); resolve(m.result) }
})
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise(r => pend.set(i, { resolve: r }))
}
const ev = x => send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  .then(r => r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description?.split('\n')[0] } : r.result?.value)

await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')
await sleep(12000)

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`[${pass ? '通过' : '失败'}] ${name}`)
  if (detail !== undefined) console.log('   ' + JSON.stringify(detail))
}

// 1) 启动图里有本包
const boot = await ev(`(() => {
  const b = window.__DSH_BOOT__
  if (!b) return { found: false }
  const rows = Array.isArray(b.entries) ? b.entries : Object.values(b.entries ?? {})
  const mine = rows.filter(e => JSON.stringify(e).includes('md-composer'))
  return { found: mine.length > 0, total: rows.length, ids: mine.map(e => e.id ?? e.name) }
})()`)
check('M0-1 本插件进入客户端启动图', boot?.found === true, boot)

// 2) 浏览器半侧确实执行了。
//    证据：apply() 里注入的样式已进 <head>（由本包的 JS 创建，只有执行过才会存在）。
//    不要靠 console 日志判断 —— 日志是易变的，重构时会失效。
const applied = await ev(`({
  cssInjected: !!document.querySelector('style[data-plugin-css="dsh-md-composer/panel.css"]'),
  vditorCssInjected: !!document.querySelector('style[data-plugin-css="vditor/dist/index.css"]'),
})`)
check('M0-2 浏览器半侧 apply() 已执行（样式注入为证）',
  applied?.cssInjected === true && applied?.vditorCssInjected === true, applied)

// 3) 插槽机制在该实例里确实会渲染（以宿主自身的 attachments 插槽为参照）
const slotDom = await ev(`({
  attachmentsSlot: !!document.querySelector('[data-slot="conversation.input.attachments"]'),
  composerCard: !!document.querySelector('[data-composer-card]'),
  composerInput: !!document.querySelector('[data-composer-input]'),
})`)
check('M0-3 插槽渲染机制可用（宿主 attachments 插槽已在 DOM）',
  slotDom?.composerCard === true && slotDom?.attachmentsSlot === true, slotDom)

// 4) 零错误
check('M0-4 无控制台错误 / 未捕获异常', errors.length === 0, errors.slice(0, 5))

console.log('\n通过 ' + results.filter(r => r.pass).length + '/' + results.length)
console.log('说明：本插件占用的两个插槽是 session 作用域，需要先绑好工作区并建立会话才会渲染；')
console.log('      未绑工作区的空实例里不出现属预期行为。')
ws.close(); chrome.kill(); process.exit(results.every(r => r.pass) ? 0 : 1)
