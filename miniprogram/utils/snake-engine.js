/**
 * 贪吃蛇游戏内核（纯逻辑，不依赖 wx / Canvas）
 * 拆分为独立模块的原因：可在 Node 中直接单元测试规则正确性。
 *
 * 规则依据说明书：
 *  - §6 基础规则：初始 3 节、向右、定时移动、普通豆随机且不在蛇身上、特殊豆概率 20%-30%
 *  - §6.1 三种模式：经典（撞墙死）/ 穿墙（左右上下互通）/ 限时（60 秒）
 *  - §6 特殊豆：金豆 / 双倍豆 / 减速豆 / 红包（加速豆、缩小豆、护盾豆已按需求移除）
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
  slow:    { label: '减速豆', points: 3,  color: '#1989FA', duration: 8 },
  gold:    { label: '金豆',   points: 5,  color: '#FFD700', duration: 0 },
  double:  { label: '双倍豆', points: 1,  color: '#FFFFFF', duration: 20 },
  packet:  { label: '红包',   points: 0,  color: '#FA5151', duration: 0 }, // 分数随机 10-50
  magnet:  { label: '磁铁豆', points: 3,  color: '#111111', duration: 15 } // 吸附附近豆子 15 秒
}

const SPECIAL_KEYS = Object.keys(SPECIALS)

/** 护盾抵挡一次伤害后的无敌时长（秒） */
const INVINCIBLE_SECONDS = 3

/**
 * 分数段：达到该分数进入下一阶段
 *  - 每个阶段蛇速提升一档（STAGE_SPEED_STEP 毫秒）
 *  - 每进入一个阶段，连击倍率 +1（吃豆得分翻倍）
 */
const STAGE_THRESHOLDS = [50, 100, 200, 400]
const STAGE_SPEED_STEP = 6      // 每阶段减少的移动间隔（毫秒）
const SCORE_SPEED_STEP = 2      // 每 10 分减少的移动间隔（毫秒）
const SCORE_SPEED_UNIT = 10
const MIN_INTERVAL = 60         // 移动间隔下限
const COMBO_DOUBLE = 2          // 每阶段连击倍率倍数

/** 特殊豆出现概率（说明书建议 20%-30%） */
/** 特殊豆出现概率区间（每次生成时在区间内随机） */
const SPECIAL_RATE_MIN = 0.40
const SPECIAL_RATE_MAX = 0.50

/** 兼容旧调用：区间中值 */
const SPECIAL_RATE_MID = (SPECIAL_RATE_MIN + SPECIAL_RATE_MAX) / 2

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
    this.comboCount = 0        // 累计吃豆数（达到分数段即翻倍）
    this.alive = true
    this.state = 'ready'       // ready | running | paused | over
    this.invincible = 0        // 无敌剩余秒数（护盾触发后 3 秒）
    this.effects = {}          // { double: 剩余秒, slow: 剩余秒 }
    this.packetPopup = 0       // 红包弹窗分数（>0 时前端展示）
    this.remainSeconds = this.mode === MODES.TIMED ? this.timedSeconds : 0
    this.food = null
    this.magnetFood = null
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
  /**
   * 转向
   * 修复「按键延迟」：
   *  - 原先同一 tick 内第二次转向会被直接忽略（连按丢输入），
   *    现在允许覆盖待处理方向，使连续按键不丢失；
   *  - 反向判定改为基于「待处理方向（若有）或当前方向」，避免覆盖时产生 180° 回头。
   */
  turn(name) {
    if (!DIRS[name]) return false
    if (this.state === 'over' || !this.alive) return false
    const base = this.pendingDir ? DIRS[this.pendingDir] : this.dir
    const next = DIRS[name]
    // 反向判定：两方向相加为 0 即为 180° 回头，禁止
    if (base.x + next.x === 0 && base.y + next.y === 0) return false
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
  /**
   * 每秒推进一次：特殊豆效果与无敌倒计时对所有模式生效；
   * 限时模式额外推进总倒计时。
   */
  tickSecond() {
    if (this.state !== 'running') return
    this.tickEffects()
    if (this.invincible > 0) this.invincible = Math.max(0, this.invincible - 1)
    if (this.mode !== MODES.TIMED) return
    this.remainSeconds = Math.max(0, this.remainSeconds - 1)
    if (this.remainSeconds === 0) this.gameOver('timeout')
  }

  /**
   * 受到一次伤害，返回是否被抵挡。
   * 优先级：无敌中 > 护盾（消耗一次护盾，并触发 3 秒无敌）> 死亡
   */
  takeDamage(reason) {
    // 护盾豆已删除，仅保留无敌判定（供将来扩展使用）
    if (this.invincible > 0) return { blocked: true, by: 'invincible' }
    this.gameOver(reason)
    return { blocked: false }
  }

  /**
   * 磁铁效果：吸附半径内的豆子每 tick 向蛇头靠近一格
   * 被吸附的豆子放入 magnetFood，可被正常吃掉
   */
  applyMagnet() {
    if (!this.hasEffect('magnet')) {
      // 效果结束后，把未吃掉的吸附豆放回普通位置
      if (this.magnetFood) { this.food = this.magnetFood; this.magnetFood = null }
      return
    }
    const head = this.snake[0]
    const R = 6                                   // 吸附半径（格）
    const candidates = [this.food, this.magnetFood].filter(Boolean)
    for (const f of candidates) {
      const d = Math.abs(f.x - head.x) + Math.abs(f.y - head.y)
      if (d > R || d === 0) continue
      // 朝蛇头方向移动一格（优先走差距较大的轴）
      const dx = head.x - f.x, dy = head.y - f.y
      if (Math.abs(dx) >= Math.abs(dy)) f.x += Math.sign(dx)
      else f.y += Math.sign(dy)
    }
    // 若常规豆已靠近蛇头，标记为吸附豆（便于绘制与判定）
    if (this.food) {
      const d = Math.abs(this.food.x - head.x) + Math.abs(this.food.y - head.y)
      if (d <= R && !this.magnetFood) {
        this.magnetFood = this.food
        this.food = null
      }
    }
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

  /** 生成豆子：普通豆或随机特殊豆（概率 SPECIAL_RATE_MID） */
  spawnFood() {
    const cell = this.randomFreeCell()
    if (!cell) { this.food = null; return }
    let type = 'normal'
    const rate = SPECIAL_RATE_MIN + Math.random() * (SPECIAL_RATE_MAX - SPECIAL_RATE_MIN)
    if (this.specialFood && Math.random() < rate) {
      type = SPECIAL_KEYS[Math.floor(Math.random() * SPECIAL_KEYS.length)]
    }
    this.food = { x: cell.x, y: cell.y, type }
  }

  /* ---------------- 单步推进 ---------------- */
  tick() {
    if (this.state !== 'running' || !this.alive) return { moved: false }

    // 磁铁效果：把附近的豆子逐步吸向蛇头
    this.applyMagnet()

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
      } else {
        const r = this.takeDamage('wall')
        if (r.blocked) {
          // 被护盾/无敌抵挡：重新定向到一个可安全前进的方向，
          // 否则会持续撞墙导致蛇卡住不动
          const safe = this.safeDirection([this.dirName])
          if (safe) {
            this.dirName = safe
            this.dir = DIRS[safe]
          }
          return { moved: false, shielded: r.by, redirected: safe }
        }
        return { moved: false, dead: 'wall' }
      }
    }

    // 撞自己（蛇尾即将移动，因此允许移动到当前尾部位置）
    const eating = (f) => f && nx === f.x && ny === f.y
    const willEat = eating(this.food) || eating(this.magnetFood)
    const body = willEat ? this.snake : this.snake.slice(0, -1)
    const hitSelf = body.some((s) => s.x === nx && s.y === ny)
    if (hitSelf) {
      const r = this.takeDamage('self')
      if (r.blocked) {
        const safe = this.safeDirection([this.dirName])
        if (safe) {
          this.dirName = safe
          this.dir = DIRS[safe]
        }
        return { moved: false, shielded: r.by, redirected: safe }
      }
      return { moved: false, dead: 'self' }
    }

    // 前进
    this.snake.unshift({ x: nx, y: ny })
    let gained = 0
    let special = null

    if (willEat) {
      const target = eating(this.food) ? this.food : this.magnetFood
      const res = this.consume(target)
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
      if (type === 'magnet') this.effects.magnet = SPECIALS.magnet.duration   // 固定 15 秒，不叠加
    }

    // 双倍豆：吃豆得分翻倍
    if (this.hasEffect('double')) gained *= 2

    // 连击：每达到一个分数段，吃豆得分再翻倍
    const mul = Math.pow(COMBO_DOUBLE, this.stage())
    if (mul > 1) gained *= mul

    this.score += gained
    this.comboCount += 1
    this.spawnFood()
    return { gained, special, stage: this.stage(), multiplier: mul }
  }

  /** 当前所处分数段（0 起） */
  stage() {
    let n = 0
    for (const t of STAGE_THRESHOLDS) if (this.score >= t) n++
    return n
  }

  /** 当前连击倍率（1 倍起，每阶段翻倍） */
  multiplier() {
    return Math.pow(COMBO_DOUBLE, this.stage())
  }

  /** 当前移动间隔（含分数段加速与特殊豆效果） */
  interval() {
    const base = { slow: 280, mid: 160, fast: 110 }[this.speed] || 160
    if (this.mode === MODES.TIMED) return base   // 限时模式固定中速

    // 随分数平滑加快（封顶 40ms）+ 每个分数段再提速一档
    const scoreAccel = Math.min(40, Math.floor(this.score / SCORE_SPEED_UNIT) * SCORE_SPEED_STEP)
    let iv = base - scoreAccel - this.stage() * STAGE_SPEED_STEP
    iv = Math.max(MIN_INTERVAL, iv)
    if (this.hasEffect('slow')) iv = Math.min(380, Math.round(iv * 1.6))
    return iv
  }

  /**
   * 从候选方向中挑一个「下一步不会撞墙/撞自己」的方向
   * 用于被护盾或无敌抵挡后重新定向，避免蛇卡在原地无法移动
   */
  safeDirection(preferred) {
    const head = this.snake[0]
    const body = this.snake.slice(0, -1)   // 蛇尾会让出，可忽略
    const order = []
    // 优先候选（通常是当前方向），再依次尝试其余方向
    for (const d of (preferred || [])) if (!order.includes(d)) order.push(d)
    for (const d of ['up', 'right', 'down', 'left']) if (!order.includes(d)) order.push(d)

    for (const name of order) {
      const v = DIRS[name]
      if (!v) continue
      let nx = head.x + v.x
      let ny = head.y + v.y
      if (this.mode === MODES.WRAP) {
        nx = (nx + this.cols) % this.cols
        ny = (ny + this.rows) % this.rows
      } else if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) {
        continue                                   // 会撞墙
      }
      if (body.some((s2) => s2.x === nx && s2.y === ny)) continue   // 会撞自己
      // 不允许 180° 反向（除非无路可走时由调用方兜底）
      const cur = this.dir
      if (cur && cur.x + v.x === 0 && cur.y + v.y === 0) continue
      return name
    }
    return null
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
      stage: this.stage(), multiplier: this.multiplier(),
      invincible: this.invincible, effects: this.effects, magnetFood: this.magnetFood,
      remainSeconds: this.remainSeconds,
      overReason: this.overReason,
      packetPopup: this.packetPopup
    }
  }
}

module.exports = { SnakeGame, MODES, DIRS, SPECIALS, SPECIAL_KEYS, SPECIAL_RATE_MIN, SPECIAL_RATE_MAX, SPECIAL_RATE_MID, INVINCIBLE_SECONDS, STAGE_THRESHOLDS }
