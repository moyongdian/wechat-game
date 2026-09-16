/**
 * 贪吃蛇游戏内核（纯逻辑，不依赖 wx / Canvas）
 * 拆分为独立模块的原因：可在 Node 中直接单元测试规则正确性。
 *
 * 规则依据说明书：
 *  - §6 基础规则：初始 3 节、向右、定时移动、普通豆随机且不在蛇身上、特殊豆概率 20%-30%
 *  - §6.1 三种模式：经典（撞墙死）/ 穿墙（左右上下互通）/ 限时（60 秒）
 *  - §6 特殊豆：金豆 / 双倍豆 / 减速豆 / 护盾豆 / 缩小豆 / 红包（加速豆已按需求移除）
 */

const MODES = { CLASSIC: 'classic', WRAP: 'wrap', TIMED: 'timed' }

/** 方向定义：不可 180 度反向 */
const DIRS = {
  up:    { x: 0, y: -1 },
  down:  { x: 0, y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1, y: 0 }
}

/** 特殊豆配置（说明书 §6 特殊豆设计表） */
const SPECIALS = {
  gold:    { label: '金豆',   points: 5,  color: '#FFD700', duration: 0 },
  double:  { label: '双倍豆', points: 1,  color: '#FFFFFF', duration: 20 },
  slow:    { label: '减速豆', points: 3,  color: '#1989FA', duration: 8 },
  shield:  { label: '护盾豆', points: 3,  color: '#FFFFFF', duration: 0 },
  shrink:  { label: '缩小豆', points: 3,  color: '#FFFFFF', duration: 0 },
  packet:  { label: '红包',   points: 0,  color: '#FA5151', duration: 0 } // 分数随机 10-50
}

const SPECIAL_KEYS = Object.keys(SPECIALS)

/** 特殊豆出现概率（说明书建议 20%-30%） */
const SPECIAL_RATE_MID = 0.25

/**
 * @param {object} opts
 *   cols, rows      网格尺寸
 *   mode            classic | wrap | timed
 *   speed           基础速度档位 slow|mid|fast
 *   specialFood     是否启用特殊豆
 *   timedSeconds    限时模式总秒数
 *   foodPoints      吃普通豆得分（默认 1）
 */
class SnakeGame {
  constructor(opts) {
    opts = opts || {}
    this.cols = opts.cols || 20
    this.rows = opts.rows || 24
    this.mode = opts.mode || MODES.CLASSIC
    this.speed = opts.speed || 'mid'
    this.specialFood = opts.specialFood !== false
    this.timedSeconds = opts.timedSeconds || 60
    this.foodPoints = opts.foodPoints || 1
    this.reset()
  }

  /* ---------------- 生命周期 ---------------- */
  reset() {
    const midY = Math.floor(this.rows / 2)
    this.snake = [
      { x: 2, y: midY },  // 蛇头
      { x: 1, y: midY },
      { x: 0, y: midY }
    ]
    this.dir = DIRS.right
    this.dirName = 'right'
    this.pendingDir = null     // 每 tick 只接受一次转向
    this.score = 0
    this.alive = true
    this.state = 'ready'       // ready | running | paused | over
    this.shield = 0            // 护盾次数
    this.effects = {}          // { double: 剩余秒, slow: ..., fast: ... }
    this.packetPopup = 0       // 红包弹窗分数（>0 时前端展示）
    this.remainSeconds = this.mode === MODES.TIMED ? this.timedSeconds : 0
    this.food = null
    this.spawnFood()
    return this
  }

  start() {
    if (this.state === 'ready' || this.state === 'paused') this.state = 'running'
    return this
  }

  pause() {
    if (this.state === 'running') this.state = 'paused'
    return this
  }

  resume() {
    if (this.state === 'paused') this.state = 'running'
    return this
  }

  /* ---------------- 转向（限制 180 度反向） ---------------- */
  turn(name) {
    if (!DIRS[name]) return false
    if (this.state === 'over' || !this.alive) return false
    const cur = this.dir
    const next = DIRS[name]
    // 反向判定：当前方向与目标方向相加为 0
    if (cur.x + next.x === 0 && cur.y + next.y === 0) return false
    // 同一 tick 内只接受一次转向，避免快速连按导致自杀
    if (this.pendingDir) return false
    this.pendingDir = name
    return true
  }

  /* ---------------- 特殊豆效果时长（秒） ---------------- */
  tickEffects() {
    Object.keys(this.effects).forEach((k) => {
      this.effects[k] = Math.max(0, this.effects[k] - 1)
      if (this.effects[k] === 0) delete this.effects[k]
    })
  }

  hasEffect(name) {
    return !!this.effects[name]
  }

  /** 限时模式倒计时（每秒调用一次） */
  tickSecond() {
    if (this.mode !== MODES.TIMED || this.state !== 'running') return
    this.remainSeconds = Math.max(0, this.remainSeconds - 1)
    this.tickEffects()
    if (this.remainSeconds === 0) this.gameOver('timeout')
  }

  /* ---------------- 生成豆子 ---------------- */
  isOnSnake(x, y) {
    return this.snake.some((s) => s.x === x && s.y === y)
  }

  randomFreeCell() {
    const free = []
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (!this.isOnSnake(x, y)) free.push({ x, y })
      }
    }
    if (!free.length) return null
    return free[Math.floor(Math.random() * free.length)]
  }

  spawnFood() {
    const cell = this.randomFreeCell()
    if (!cell) { this.food = null; return }
    let type = 'normal'
    if (this.specialFood && Math.random() < SPECIAL_RATE_MID) {
      // 穿墙模式中护盾主要用于免疫撞自己，仍可出现
      type = SPECIAL_KEYS[Math.floor(Math.random() * SPECIAL_KEYS.length)]
    }
    this.food = { x: cell.x, y: cell.y, type }
  }

  /* ---------------- 单步推进 ---------------- */
  tick() {
    if (this.state !== 'running' || !this.alive) return { moved: false }

    // 应用待处理转向
    if (this.pendingDir) {
      this.dirName = this.pendingDir
      this.dir = DIRS[this.pendingDir]
      this.pendingDir = null
    }

    const head = this.snake[0]
    let nx = head.x + this.dir.x
    let ny = head.y + this.dir.y

    // 边界处理
    const hitWall = nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows
    if (hitWall) {
      if (this.mode === MODES.WRAP) {
        nx = (nx + this.cols) % this.cols
        ny = (ny + this.rows) % this.rows
      } else if (this.shield > 0) {
        this.shield -= 1
        // 护盾抵消一次撞墙：原地掉头（反向），避免立刻再次撞墙
        const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' }[this.dirName]
        this.dirName = opposite
        this.dir = DIRS[opposite]
        return { moved: false, shielded: 'wall' }
      } else {
        this.gameOver('wall')
        return { moved: false, dead: 'wall' }
      }
    }

    // 撞自己（蛇尾即将移动，因此允许移动到当前尾部位置）
    const willEat = this.food && nx === this.food.x && ny === this.food.y
    const body = willEat ? this.snake : this.snake.slice(0, -1)
    const hitSelf = body.some((s) => s.x === nx && s.y === ny)
    if (hitSelf) {
      if (this.shield > 0) {
        this.shield -= 1
        return { moved: false, shielded: 'self' }
      }
      this.gameOver('self')
      return { moved: false, dead: 'self' }
    }

    // 前进
    this.snake.unshift({ x: nx, y: ny })
    let gained = 0
    let special = null

    if (willEat) {
      const food = this.food
      const res = this.consume(food)
      gained = res.gained
      special = res.special
    } else {
      this.snake.pop()
    }

    return { moved: true, gained, special, score: this.score }
  }

  /** 吃豆结算 */
  consume(food) {
    const type = food.type || 'normal'
    let gained = this.foodPoints
    let special = null

    if (type === 'normal') {
      gained = this.foodPoints
    } else {
      const cfg = SPECIALS[type]
      special = type
      if (type === 'packet') {
        gained = 10 + Math.floor(Math.random() * 41) // 10-50
        this.packetPopup = gained
      } else {
        gained = cfg.points
      }
      // 效果类
      if (type === 'double') this.effects.double = (this.effects.double || 0) + SPECIALS.double.duration
      if (type === 'slow')   this.effects.slow   = (this.effects.slow   || 0) + SPECIALS.slow.duration
      if (type === 'shield') this.shield += 1
      if (type === 'shrink') {
        // 缩短 2 节，最低保留 3 节
        const target = Math.max(3, this.snake.length - 2)
        this.snake = this.snake.slice(0, target)
      }
    }

    // 双倍豆：吃豆得分翻倍
    if (this.hasEffect('double')) gained *= 2

    this.score += gained
    this.spawnFood()
    return { gained, special }
  }

  /** 当前移动间隔（含效果影响） */
  interval() {
    const base = { slow: 280, mid: 160, fast: 110 }[this.speed] || 160
    if (this.mode === MODES.TIMED) {
      // 限时模式固定中速
      return base
    }
    let iv = Math.max(70, base - Math.floor(this.score / 5) * 12)
    if (this.hasEffect('slow')) iv = Math.min(360, Math.round(iv * 1.6))
    return iv
  }

  gameOver(reason) {
    this.alive = false
    this.state = 'over'
    this.overReason = reason
    return this
  }

  /** 供渲染层读取的快照 */
  snapshot() {
    return {
      cols: this.cols, rows: this.rows,
      snake: this.snake, food: this.food,
      score: this.score, state: this.state, alive: this.alive,
      shield: this.shield, effects: this.effects,
      remainSeconds: this.remainSeconds,
      overReason: this.overReason,
      packetPopup: this.packetPopup
    }
  }
}

module.exports = { SnakeGame, MODES, DIRS, SPECIALS, SPECIAL_KEYS, SPECIAL_RATE_MID }
