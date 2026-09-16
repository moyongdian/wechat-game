/**
 * 小程序静态校验（无需开发者工具）
 * 检查：JSON 合法性、页面四件套、tabBar/资源引用、WXML 标签闭合、事件处理函数存在性
 * 运行：node tools/check.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const errors = []
const warnings = []
const stats = { pages: 0, wxml: 0, handlers: 0, images: 0 }

function read(p) { return fs.readFileSync(p, 'utf8') }

/* ---------- 1. JSON 合法性 ---------- */
function collectJson(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') collectJson(p, out) }
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out
}

/* ---------- 2. WXML 标签闭合 ---------- */
const VOID_TAGS = new Set(['input', 'image', 'br', 'hr', 'import', 'include', 'wxs', 'canvas'])
function checkWxml(p) {
  stats.wxml++
  let s = read(p)
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  const stack = []
  // 支持跨行属性与引号内含 > 的情况
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gs
  let m
  while ((m = re.exec(s))) {
    const [, closing, name, , selfClose] = m
    if (VOID_TAGS.has(name)) continue
    if (closing) {
      if (!stack.length || stack[stack.length - 1] !== name) {
        errors.push(`${path.relative(ROOT, p)}: 标签不匹配 </${name}>（栈顶 ${stack[stack.length - 1] || '空'}）`)
      } else stack.pop()
    } else if (!selfClose) stack.push(name)
  }
  if (stack.length) errors.push(`${path.relative(ROOT, p)}: 未闭合标签 ${JSON.stringify(stack)}`)

  // 事件处理函数存在性
  const js = p.replace(/\.wxml$/, '.js')
  if (fs.existsSync(js)) {
    const src = read(js)
    const handlers = new Set()
    const hre = /\b(?:bind|catch):?([a-z]+)="([A-Za-z_$][\w$]*)"/g
    let h
    while ((h = hre.exec(s))) handlers.add(h[2])
    for (const fn of handlers) {
      stats.handlers++
      const ok = new RegExp('\\b' + fn + '\\s*[:(]').test(src)
      if (!ok) errors.push(`${path.relative(ROOT, p)}: 事件处理函数 ${fn} 未在 ${path.basename(js)} 中找到`)
    }
  }
}

/* ---------- 3. 资源引用 ---------- */
function checkAsset(ref, fromFile) {
  if (!ref) return
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:')) return
  const clean = ref.split('?')[0]
  const p = clean.startsWith('/')
    ? path.join(MP, clean.slice(1))
    : path.resolve(path.dirname(fromFile), clean)
  if (!fs.existsSync(p)) {
    errors.push(`${path.relative(ROOT, fromFile)}: 资源不存在 ${ref}`)
  } else if (clean.endsWith('.png')) stats.images++
}

function checkAssetsInWxml(p) {
  const s = read(p)
  const re = /\bsrc="([^"{}]+)"/g
  let m
  while ((m = re.exec(s))) checkAsset(m[1], p)
}

/* ---------- 主流程 ---------- */
// JSON
for (const p of collectJson(MP)) {
  try { JSON.parse(read(p)) } catch (e) {
    errors.push(`${path.relative(ROOT, p)}: JSON 解析失败 ${e.message}`)
  }
}

const app = JSON.parse(read(path.join(MP, 'app.json')))
const pages = app.pages || []
stats.pages = pages.length

// 页面四件套
for (const pg of pages) {
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    const f = path.join(MP, pg + '.' + ext)
    if (!fs.existsSync(f)) errors.push(`缺少文件: ${pg}.${ext}`)
  }
}

// tabBar（本项目未启用底部导航，故意留空）
if (app.tabBar && app.tabBar.list && app.tabBar.list.length) {
  for (const it of app.tabBar.list) {
    if (!pages.includes(it.pagePath)) errors.push(`tabBar 页面未注册: ${it.pagePath}`)
    checkAsset(it.iconPath, path.join(MP, 'app.json'))
    checkAsset(it.selectedIconPath, path.join(MP, 'app.json'))
  }
} else {
  console.log('  说明：app.json 未配置 tabBar（首页自带类微信底部导航，符合设计）')
}

// 磁盘上有多余页面目录却未注册
const pageDirs = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const full = path.join(d, e.name)
    if (fs.existsSync(path.join(full, 'index.wxml'))) pageDirs.push(path.relative(MP, full).replace(/\\/g, '/'))
    else walk(full)
  }
})(path.join(MP, 'pages'))
for (const d of pageDirs) {
  if (!pages.includes(d + '/index')) warnings.push(`页面目录 ${d} 未在 app.json 注册`)
}

// WXML
function collectWxml(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') collectWxml(p, out) }
    else if (e.name.endsWith('.wxml')) out.push(p)
  }
  return out
}
for (const p of collectWxml(MP)) { checkWxml(p); checkAssetsInWxml(p) }

// JS 中引用的图片路径（如 avatar: '/images/xxx.png'）
;(function checkJsAssets(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') checkJsAssets(p); continue }
    if (!e.name.endsWith('.js')) continue
    const src = read(p)
    const re = /['"](\/images\/[^'"]+\.(?:png|jpg|jpeg|gif|svg))['"]/g
    let m
    while ((m = re.exec(src))) checkAsset(m[1], p)
  }
})(MP)

// app.wxss 中的资源
const appWxss = path.join(MP, 'app.wxss')
if (fs.existsSync(appWxss)) {
  const s = read(appWxss)
  const re = /url\(([^)]+)\)/g
  let m
  while ((m = re.exec(s))) checkAsset(m[1].replace(/['"]/g, ''), appWxss)
}

/* ---------- 输出 ---------- */
console.log('='.repeat(64))
console.log(`页面 ${stats.pages} 个 | WXML ${stats.wxml} 个 | 事件 ${stats.handlers} 个 | 图片资源 ${stats.images} 个`)
console.log('='.repeat(64))
if (errors.length) {
  console.log(`\n❌ 错误 ${errors.length} 项：`)
  errors.forEach((e) => console.log('  - ' + e))
} else {
  console.log('\n✅ 静态校验通过：结构完整、引用有效、标签闭合、事件齐全')
}
if (warnings.length) {
  console.log(`\n⚠️  提示 ${warnings.length} 项：`)
  warnings.forEach((w) => console.log('  - ' + w))
}
process.exit(errors.length ? 1 : 0)
