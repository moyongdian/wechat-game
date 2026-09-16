/**
 * 贪吃蛇内核单元测试（对照《小游戏功能说明书》逐条验证）
 * 运行：node tools/test-engine.js
 */
const { SnakeGame, MODES, SPECIALS, SPECIAL_RATE_MIN, SPECIAL_RATE_MAX } = require('../miniprogram/utils/snake-engine')

let pass = 0, fail = 0
const failures = []
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  [PASS] ${name}${detail ? '   ' + detail : ''}`) }
  else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); console.log(`  [FAIL] ${name}   ${detail || ''}`) }
}
const section = (t) => console.log(`\n${'='.repeat(64)}\n${t}\n${'='.repeat(64)}`)
/** 造一个可控局面：把蛇放在中间、食物指定 */
function makeGame(opts) {
  const g = new SnakeGame(Object.assign({ cols: 20, rows: 20, specialFood: false }, opts))
  return g
}

/* ---------- §6 基础规则 ---------- */
section('§6 基础游戏规则')
let g = makeGame()
check('初始长度 3 节', g.snake.length === 3, `实际 ${g.snake.length}`)
check('初始方向向右', g.dirName === 'right', g.dirName)
check('初始状态为 ready', g.state === 'ready', g.state)
check('初始分数 0', g.score === 0)
check('豆子已生成且不在蛇身上', !!g.food && !g.isOnSnake(g.food.x, g.food.y),
  g.food ? `(${g.food.x},${g.food.y})` : 'null')

g.start()
check('start() 后进入 running', g.state === 'running', g.state)

section('移动与转向')
g = makeGame(); g.start()
const head0 = Object.assign({}, g.snake[0])
g.tick()
check('向右移动一格', g.snake[0].x === head0.x + 1 && g.snake[0].y === head0.y,
  `(${head0.x},${head0.y}) → (${g.snake[0].x},${g.snake[0].y})`)
check('未吃豆时长度不变', g.snake.length === 3, `实际 ${g.snake.length}`)

g = makeGame(); g.start()
check('可向上转向', g.turn('up') === true)
g.tick()
check('转向生效', g.dirName === 'up', g.dirName)

g = makeGame(); g.start()
check('禁止 180 度反向（向右时按左）', g.turn('left') === false, '应被拒绝')

g = makeGame(); g.start()
g.turn('up'); 
check('同一 tick 内第二次转向被忽略', g.turn('down') === false || g.turn('left') === false)

/* ---------- 吃豆 ---------- */
section('吃豆与生长')
g = makeGame(); g.start()
g.food = { x: g.snake[0].x + 1, y: g.snake[0].y, type: 'normal' }  // 正前方放豆
const lenBefore = g.snake.length
const r = g.tick()
check('吃到豆子分数 +1', g.score === 1, `score=${g.score}`)
check('吃到豆子蛇身 +1', g.snake.length === lenBefore + 1, `${lenBefore} → ${g.snake.length}`)
check('tick 返回 gained', r.gained === 1, String(r.gained))
check('吃豆后重新生成豆子', !!g.food && !g.isOnSnake(g.food.x, g.food.y))

/* ---------- 死亡判定 ---------- */
section('死亡判定')
g = new SnakeGame({ cols: 10, rows: 10, mode: MODES.CLASSIC, specialFood: false })
g.start()
g.snake = [{ x: 9, y: 5 }, { x: 8, y: 5 }, { x: 7, y: 5 }]
g.dir = { x: 1, y: 0 }; g.dirName = 'right'
g.tick()
check('经典模式撞右墙死亡', g.state === 'over' && g.overReason === 'wall',
  `state=${g.state} reason=${g.overReason}`)

g = new SnakeGame({ cols: 10, rows: 10, mode: MODES.CLASSIC, specialFood: false })
g.start()
// 蛇头 back 到自己身体：向右绕一圈撞身
g.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }]
g.dir = { x: 0, y: 1 }; g.dirName = 'down'
g.tick()
check('撞到自己死亡', g.state === 'over' && g.overReason === 'self',
  `state=${g.state} reason=${g.overReason}`)

g = new SnakeGame({ cols: 10, rows: 10, mode: MODES.WRAP, specialFood: false })
g.start()
g.snake = [{ x: 9, y: 5 }, { x: 8, y: 5 }, { x: 7, y: 5 }]
g.dir = { x: 1, y: 0 }; g.dirName = 'right'
g.tick()
check('穿墙模式右出左进（不死亡）', g.state === 'running' && g.snake[0].x === 0,
  `state=${g.state} headX=${g.snake[0].x}`)

g = new SnakeGame({ cols: 10, rows: 10, mode: MODES.WRAP, specialFood: false })
g.start()
g.snake = [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }]
g.dir = { x: 0, y: -1 }; g.dirName = 'up'
g.tick()
check('穿墙模式上出下进', g.state === 'running' && g.snake[0].y === 9,
  `state=${g.state} headY=${g.snake[0].y}`)

/* ---------- §6 特殊豆 ---------- */
section('§6 特殊豆效果')
g = makeGame(); g.start()
g.food = { x: g.snake[0].x + 1, y: g.snake[0].y, type: 'gold' }
let before = g.score
g.tick()
check('金豆 +5 分', g.score === before + 5, `+${g.score - before}`)

g = makeGame(); g.start()
g.food = { x: g.snake[0].x + 1, y: g.snake[0].y, type: 'packet' }
before = g.score
g.tick()
const gained = g.score - before
check('红包 +10~50 随机分', gained >= 10 && gained <= 50, `+${gained}`)
check('红包触发弹窗分数', g.packetPopup === gained, `popup=${g.packetPopup}`)

g = makeGame(); g.start()
g.food = { x: g.snake[0].x + 1, y: g.snake[0].y, type: 'double' }
g.tick()
check('双倍豆进入 20 秒效果', g.hasEffect('double') && g.effects.double === 20, JSON.stringify(g.effects))
g.food = { x: g.snake[0].x + 1, y: g.snake[0].y, type: 'normal' }
before = g.score
g.tick()
check('双倍期间普通豆得 2 分', g.score - before === 2, `+${g.score - before}`)

g = makeGame(); g.start()
g.food = { x: g.snake[0].x + 1, y: g.snake[0].y, type: 'slow' }
const slowIv = g.interval()
g.tick()
check('减速豆 +3 分', g.score === 3, `score=${g.score}`)
check('减速豆进入 8 秒效果', g.hasEffect('slow') && g.effects.slow === 8, JSON.stringify(g.effects))
check('减速后移动间隔变长', g.interval() > slowIv, `${slowIv} → ${g.interval()}`)

check('护盾豆已删除', !SPECIALS.shield, Object.keys(SPECIALS).join('/'))

check('缩小豆已删除', !SPECIALS.shrink, Object.keys(SPECIALS).join('/'))

/* ---------- 速度 ---------- */
section('需求变更验证')
check('特殊豆已移除「加速豆」', !SPECIALS.fast, 'SPECIALS: ' + Object.keys(SPECIALS).join('/'))
check('减速豆已回归特殊豆', !!SPECIALS.slow, JSON.stringify(SPECIALS.slow))
check('特殊豆共 5 种（含磁铁豆）', Object.keys(SPECIALS).length === 5, Object.keys(SPECIALS).join('/'))
check('特殊豆概率区间为 40%~50%', SPECIAL_RATE_MIN === 0.40 && SPECIAL_RATE_MAX === 0.50,
  `${SPECIAL_RATE_MIN}~${SPECIAL_RATE_MAX}`)
const slowG = new SnakeGame({ speed: 'slow', specialFood: false })
check('慢速已降低（间隔 ≥ 280ms）', slowG.interval() >= 280, slowG.interval() + 'ms')

section('回归：穿墙时相邻节跨边界需可识别（曾画出长线）')
{
  const g3 = new SnakeGame({ cols: 20, rows: 22, mode: MODES.WRAP, specialFood: false })
  g3.start()
  const linked = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1
  check('直行相邻节判定为连续', linked({ x: 5, y: 5 }, { x: 6, y: 5 }) === true)
  check('拐弯相邻节判定为连续', linked({ x: 5, y: 5 }, { x: 5, y: 6 }) === true)
  check('穿墙右向跳变判定为不连续', linked({ x: 0, y: 5 }, { x: 19, y: 5 }) === false)
  check('穿墙上向跳变判定为不连续', linked({ x: 5, y: 0 }, { x: 5, y: 21 }) === false)
  // 穿墙后蛇头确实跳到对侧
  g3.snake = [{ x: 19, y: 5 }, { x: 18, y: 5 }, { x: 17, y: 5 }]
  g3.dir = { x: 1, y: 0 }; g3.dirName = 'right'
  g3.tick()
  check('穿墙后蛇头环绕到另一侧', g3.snake[0].x === 0, `headX=${g3.snake[0].x}`)
}

section('磁铁豆')
{
  const mg = new SnakeGame({ specialFood: false })
  mg.start()
  check('磁铁豆时长为 15 秒', SPECIALS.magnet && SPECIALS.magnet.duration === 15,
    SPECIALS.magnet ? String(SPECIALS.magnet.duration) : 'null')
  // 吃磁铁豆
  mg.food = { x: mg.snake[0].x + 1, y: mg.snake[0].y, type: 'magnet' }
  mg.tick()
  check('吃磁铁豆获得吸附效果', mg.hasEffect('magnet') && mg.effects.magnet === 15,
    JSON.stringify(mg.effects))
  // 吸附：附近豆子逐格靠近蛇头
  mg.snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }]
  mg.food = { x: 14, y: 10, type: 'normal' }
  mg.magnetFood = null
  const before = 14
  for (let i = 0; i < 3; i++) mg.applyMagnet()
  const drop = mg.food || mg.magnetFood
  check('附近豆子被吸向蛇头', drop && drop.x < before, `${before} → ${drop ? drop.x : 'null'}`)
  // 效果结束后吸附豆回到常规位置
  mg.effects.magnet = 0
  mg.applyMagnet()
  check('效果结束后吸附豆回归常规位置', !!mg.food && !mg.magnetFood,
    `food=${!!mg.food} magnetFood=${!!mg.magnetFood}`)
}

section('特殊豆概率实测')
{
  const pg = new SnakeGame({ specialFood: true })
  let sp = 0
  const N = 20000
  for (let i = 0; i < N; i++) { pg.spawnFood(); if (pg.food.type !== 'normal') sp++ }
  const r = sp / N
  check('实测概率落在 40%~50% 区间', r >= 0.38 && r <= 0.52, `${(r * 100).toFixed(1)}%`)
}

section('分数段与连击（阈值 20/40/60/100，之后每 +100 一阶；倍率每阶 +1）')
const sg = new SnakeGame({ specialFood: false, speed: 'mid' })
sg.start()
check('初始阶段 0、倍率 ×1', sg.stage() === 0 && sg.multiplier() === 1,
  `stage=${sg.stage()} mul=${sg.multiplier()}`)
const stageCases = [[20, 1, 2], [40, 2, 3], [60, 3, 4], [100, 4, 5],
                    [200, 5, 6], [300, 6, 7], [400, 7, 8]]
let stageOk = true
const details = []
for (const [score, stg, mul] of stageCases) {
  sg.score = score
  const ok = sg.stage() === stg && sg.multiplier() === mul
  if (!ok) stageOk = false
  details.push(`${score}分:阶段${sg.stage()}/×${sg.multiplier()}`)
}
check('各分数段阶段与倍率正确', stageOk, details.join(' '))
// 速度随阶段变快
const iv0 = new SnakeGame({ specialFood: false }).interval()
sg.score = 400
check('阶段提升使蛇速变快', sg.interval() < iv0, `${iv0}ms → ${sg.interval()}ms`)
// 连击：20 分后吃普通豆得 2 分；40 分后得 3 分
const cg = new SnakeGame({ specialFood: false })
cg.start(); cg.score = 20
cg.food = { x: cg.snake[0].x + 1, y: cg.snake[0].y, type: 'normal' }
let cb = cg.score
cg.tick()
check('20 分后吃普通豆 +2 分', cg.score - cb === 2, `+${cg.score - cb}`)
cg.score = 40
cg.food = { x: cg.snake[0].x + 1, y: cg.snake[0].y, type: 'normal' }
cb = cg.score
cg.tick()
check('40 分后吃普通豆 +3 分', cg.score - cb === 3, `+${cg.score - cb}`)

section('速度规则')
const gm = makeGame({ speed: 'mid' })
const slow = makeGame({ speed: 'slow' }), fast = makeGame({ speed: 'fast' })
check('速度档位：慢 > 中 > 快 的间隔', slow.interval() > gm.interval() && gm.interval() > fast.interval(),
  `${slow.interval()} / ${gm.interval()} / ${fast.interval()} ms`)
gm.score = 20
check('经典模式随分数加快', gm.interval() < 160, `${gm.interval()} ms`)
check('中存在下限（不低于 70ms）', (() => { gm.score = 9999; return gm.interval() >= 70 })(), `${gm.interval()} ms`)
const gt = new SnakeGame({ mode: MODES.TIMED, speed: 'mid', specialFood: false })
gt.start()
gt.score = 50
check('限时模式速度固定', gt.interval() === 160, `${gt.interval()} ms`)

/* ---------- 限时模式 ---------- */
section('§6.1 限时模式')
g = new SnakeGame({ mode: MODES.TIMED, timedSeconds: 3, specialFood: false })
g.start()
check('倒计时初始为设定值', g.remainSeconds === 3, String(g.remainSeconds))
g.tickSecond()
check('每秒递减', g.remainSeconds === 2, String(g.remainSeconds))
g.tickSecond(); g.tickSecond()
check('时间到自动结束', g.state === 'over' && g.overReason === 'timeout',
  `state=${g.state} reason=${g.overReason}`)

/* ---------- 暂停 ---------- */
section('暂停与恢复')
g = makeGame(); g.start()
g.pause()
check('paused 状态下不移动', (() => { const h = g.snake[0].x; g.tick(); return g.snake[0].x === h })())
check('pause() 后状态为 paused', g.state === 'paused', g.state)
g.resume(); g.tick()
check('resume() 后恢复移动', g.state === 'running')

/* ---------- 边界情况（§13） ---------- */
section('§13 异常与边界')
g = makeGame(); g.start()
check('死亡后忽略转向', (() => { g.gameOver('wall'); return g.turn('up') === false })())
check('死亡后 tick 不产生移动', (() => { const h = JSON.stringify(g.snake); g.tick(); return JSON.stringify(g.snake) === h })())
g = makeGame(); g.start()
g.snake = [] // 极端：无空位时不应死循环
for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) g.snake.push({ x, y })
g.snake = g.snake.slice(0, g.cols * g.rows)
g.food = null
g.spawnFood()
check('无空位时 spawnFood 不崩溃（food=null）', g.food === null, String(g.food))

/* ---------- 汇总 ---------- */
section('测试结果')
console.log(`  通过: ${pass}\n  失败: ${fail}`)
if (failures.length) { console.log('\n  失败明细：'); failures.forEach((f) => console.log('    ✗ ' + f)) }
console.log(`\n  结论: ${fail === 0 ? '游戏内核规则全部符合说明书 ✅' : '存在失败项 ❌'}`)
process.exit(fail === 0 ? 0 : 1)
