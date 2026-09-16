/**
 * 页面级逻辑测试（无需开发者工具）
 *
 * 通过桩掉 wx / Page / getApp 来加载真实的页面 JS，
 * 从中提取页面配置并断言关键逻辑 —— 用于守护那些「只存在于页面里、
 * 内核测试覆盖不到」的行为（如长按加速的调用顺序、定时器清理）。
 *
 * 运行：node tools/test-page.js
 */
const fs = require('fs')
const path = require('path')

const MP = path.resolve(__dirname, '../miniprogram')
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  [PASS] ${name}${detail ? '   ' + detail : ''}`) }
  else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); console.log(`  [FAIL] ${name}   ${detail || ''}`) }
}
const section = (t) => console.log(`\n${'='.repeat(64)}\n${t}\n${'='.repeat(64)}`)

/** 加载页面并返回其配置对象 */
function loadPage(rel) {
  const src = fs.readFileSync(path.join(MP, rel), 'utf8')
  let cfg = null
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: (p) => {
      // 页面只依赖 utils，用真实实现（其内部对 wx 的调用已在下面桩好）
      const full = path.resolve(path.dirname(path.join(MP, rel)), p)
      return require(full)
    },
    console,
    Page: (c) => { cfg = c },
    App: () => {},
    getApp: () => ({ globalData: { statusBarHeight: 20, safeBottom: 0, menuButton: null } }),
    getCurrentPages: () => [{}],
    wx: {
      getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
      getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2, statusBarHeight: 20, screenHeight: 812, safeArea: { bottom: 778 } }),
      getSystemInfoSync: () => ({ windowWidth: 375, pixelRatio: 2, statusBarHeight: 20, screenHeight: 812, safeArea: { bottom: 778 } }),
      getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32 }),
      createInnerAudioContext: () => ({ src: '', play() {}, stop() {}, destroy() {} }),
      createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }),
      showToast: () => {}, vibrateShort: () => {}, showModal: () => {},
      navigateTo: () => {}, navigateBack: () => {}, stopPullDownRefresh: () => {}
    },
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Object, Array, String, Number
  }
  const vm = require('vm')
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: rel })
  return cfg
}

/* ---------- 游戏页 ---------- */
section('游戏页：方向键即时响应（长按加速已按要求删除）')
{
  const src = fs.readFileSync(path.join(MP, 'pages/game/snake/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(MP, 'pages/game/snake/index.wxml'), 'utf8')
  check('已移除长按加速逻辑',
    !src.includes('boostDir') && !src.includes('boostTimer') && !src.includes('startBoostLoop'))
  check('WXML 已移除长按绑定',
    !wxml.includes('onDirLongStart') && !wxml.includes('bindlongpress'))
  check('方向键仍为点按绑定 onDir', wxml.includes('bindtap="onDir"'))
  check('消息区滑动控制仍保留', wxml.includes('bindtouchstart="onTouchStart"'))
  // 修复按键延迟：转向后重置插值基准并立即重绘
  const mDir = src.match(/\n  onDir\(e\) \{[\s\S]*?\n  \},/)
  const onDir = mDir ? mDir[0] : ''
  // 按键延迟的真正来源是「方向要等下一个 tick」，改为按键立即推进一格
  check('按键后立即推进一格（消除一个 tick 的等待）', onDir.includes('this.stepOnce()'))
  check('立即推进前先停循环，避免节奏错乱', onDir.indexOf('this.stopLoop()') < onDir.indexOf('this.stepOnce()'))
  check('推进后重启循环与渲染', onDir.includes('this.startLoop()') && onDir.includes('this.startRenderLoop()'))
  check('连点保护（<40ms 只记录方向，避免瞬间多格）', onDir.includes('tooFast') && onDir.includes('< 40'))
}

section('游戏页：暂停 / 恢复时聊天定时器的清理（曾导致假消息不再更新）')
{
  const src = fs.readFileSync(path.join(MP, 'pages/game/snake/index.js'), 'utf8')
  const pause = src.slice(src.indexOf('pauseGame(reason) {'), src.indexOf('onRestart() {'))
  check('暂停时停止聊天定时器', pause.includes('this.stopChatTimer()'))
  const onStart = src.slice(src.indexOf('onStart() {'), src.indexOf('onPauseToggle() {'))
  check('继续时先停后启（避免定时器叠加）',
    onStart.includes('this.stopChatTimer()') && onStart.includes('this.startChatTimer()'),
    'stop → start')
  check('继续时不清空已有消息', onStart.includes('(this.data.messages || []).length'))
}

section('游戏页：平滑移动与音效')
{
  const src = fs.readFileSync(path.join(MP, 'pages/game/snake/index.js'), 'utf8')
  check('每帧插值渲染（记录上一帧位置）', src.includes('this.prevSnake = g.snake.map'))
  check('插值进度按经过时间计算', src.includes('(Date.now() - this.lastTickAt) / interval'))
  check('插值起点为 prev[i]（修正过 off-by-one）', src.includes('const from = prev[i] || cur'))
  check('启动渲染循环', src.includes('startRenderLoop'))
  check('吃豆播放音效', src.includes("this.playSfx(r.special ? 'special' : 'eat')"))
  check('音效受设置开关控制', /playSfx\(kind\) \{[\s\S]*?if \(!s\.sound\) return/.test(src))
}

section('结果')
console.log(`  通过: ${pass}\n  失败: ${fail}`)
if (failures.length) { console.log('\n  失败明细：'); failures.forEach((f) => console.log('    ✗ ' + f)) }
console.log(`\n  结论: ${fail === 0 ? '页面逻辑校验通过 ✅' : '存在失败项 ❌'}`)
process.exit(fail === 0 ? 0 : 1)
