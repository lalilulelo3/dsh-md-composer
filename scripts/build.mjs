// 构建脚本：产出官方约定的客户端 bundle 契约
//   window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { ... return module.exports } })
// 宿主半侧：普通 ESM（空 apply 即可，只用于进入 Loader 图）
import { build } from 'esbuild'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, '')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const outdir = join(root, 'lib')

// 平台共享模块表（必须 external，不能打进 bundle）
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

// ---------- 宿主半侧 ----------
await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(outdir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: [...PLATFORM_MODULES, '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-agent'],
  logLevel: 'warning',
})

// ---------- 客户端半侧 ----------
// .txt 当文本导入（Lute / 图标 / i18n 三份离线资源）
const CLIENT_BANNER = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(pkg.name)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`
const CLIENT_FOOTER = `
		return module.exports;
	}
});
`

const result = await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  outfile: join(outdir, 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'chrome110',
  jsx: 'automatic',
  // React 必须走平台模块表；其余（vditor 等）打进 bundle。
  // .css 当文本读入，交给 JS 插 <head>（否则会产出谁也不加载的 client.css）。
  external: PLATFORM_MODULES,
  loader: { '.txt': 'text', '.css': 'text' },
  banner: { js: CLIENT_BANNER },
  footer: { js: CLIENT_FOOTER },
  // 发布产物压缩：Lute 的字符串压不动，但 Vditor 与业务代码能压掉一部分。
  // 调试时可用 `MINIFY=0 node scripts/build.mjs` 关闭。
  minify: process.env.MINIFY !== '0',
  sourcemap: false,
  logLevel: 'warning',
  metafile: true,
})

const clientPath = join(outdir, 'client.js')
const size = readFileSync(clientPath).length
const head = readFileSync(clientPath, 'utf8').slice(0, 200)
if (!head.includes('__ModuleLoader__.load')) {
  throw new Error('客户端 bundle 没有正确的自注册包装，检查 banner/footer')
}
console.log(`index.js  -> 宿主半侧`)
console.log(`client.js -> ${(size / 1024).toFixed(1)} KB (自注册懒式 CJS)`)
if (!existsSync(join(root, 'lib/index.js'))) throw new Error('宿主半侧产物缺失')

// ---------- 类型声明（package.json 的 exports 指向 lib/types）----------
// 直接调用本地 tsc：Windows 上 execFileSync 无法直接执行 .cmd（spawnSync EINVAL）
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const tscTsserver = join(root, 'node_modules', 'typescript', 'lib', 'tsc.js')
const tscEntry = existsSync(tscTsserver) ? tscTsserver : tscBin
try {
  execFileSync(process.execPath, [tscEntry, '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' })
  console.log('lib/types/**/*.d.ts -> 类型声明')
} catch (e) {
  throw new Error('类型声明生成失败（' + tscEntry + ' -p tsconfig.build.json）：' + e.message)
}
