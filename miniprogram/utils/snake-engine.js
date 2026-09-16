/**
 * 贪吃蛇游戏内核（纯逻辑，不依赖 wx / Canvas）
 * 拆分为独立模块的原因：可在 Node 中直接单元测试规则正确性。
 *
 * 规则依据说明书：
 *  - §6 基础规则：初始 3 节、向右、定时移动、普通豆随机且不在蛇身上、特殊豆概率 20%-30%
 *  - §6.1 三种模式：经典（撞墙死）/ 穿墙（左右上下互通）/ 限时（60 秒）
 *  - §6 特殊豆：金豆 / 双倍豆 / 减速豆 / 红包（加速豆、缩小豆、护盾豆已按需求移除）
 */

const MODES = {
  CLASSIC: 'classic',   // 经典：撞墙死、撞自己死
  WRAP: 'wrap',         // 穿墙：边界互通
  TIMED: 'timed',       // 限时：60/120/180 秒冲分
  OBSTACLE: 'obstacle', // 障碍：地图随机出现聊天障碍物
  ENDLESS: 'endless',   // 无尽：速度持续加快，无上限
  MOYU: 'moyu'          // 摸鱼：蛇自动寻豆，无需操作
}

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
  magnet:  { label: '磁铁豆', points: 3,  color: '#111111', duration: 15 }, // 吸附附近豆子 15 秒
  // ── 以下为设计文档新增：以聊天元素伪装，基础分 3 分，存在 8 秒 ──
  bomb:    { label: '炸弹豆', points: 3,  color: '#333333', duration: 0 },  // 清除周围障碍物
  file:    { label: '文件',   points: 3,  color: '#9AA0A6', duration: 8 },  // 蛇身 +2，短暂减速
  voice:   { label: '语音',   points: 3,  color: '#07C160', duration: 8 },  // 加速 3 秒
  emoji:   { label: '表情',   points: 3,  color: '#FFD700', duration: 8 },  // 随机效果
  recall:  { label: '撤回',   points: 3,  color: '#9AA0A6', duration: 8 }   // 清除全部障碍
}

/**
 * 障碍物（设计文档 §3.3）：伪装成聊天元素
 *  spawnRate 每秒生成概率；life 存活秒数
 */
const OBSTACLES = {
  noread:  { label: '已读不回', spawnRate: 0.10, life: 10, lethal: true,  points: 0 },
  typing:  { label: '正在输入', spawnRate: 0.10, life: 10, lethal: false, points: -5, moving: true },
  filetx:  { label: '文件传输', spawnRate: 0.10, life: 10, lethal: true,  points: 0, length: 3 },
  emoji:   { label: '表情包',   spawnRate: 0.10, life: 10, lethal: false, points: -10 },
  dnd:     { label: '免打扰',   spawnRate: 0.10, life: 10, lethal: false, points: 0, slowZone: true }
}
const OBSTACLE_TYPES = Object.keys(OBSTACLES)

const SPECIAL_KEYS = Object.keys(SPECIALS)

/** 护盾抵挡一次伤害后的无敌时长（秒） */
const INVINCIBLE_SECONDS = 3

/**
 * 分数段：达到该分数进入下一阶段
 *  - 每个阶段蛇速提升一档（STAGE_SPEED_STEP 毫秒）
 *  - 每进入一个阶段，连击倍率 +1（吃豆得分翻倍）
 */
const STAGE_THRESHOLDS = [20, 40, 60, 100]
const STAGE_TAIL_STEP = 100     // 第 4 阶段后，每增加 100 分进入下一个阶段
const STAGE_SPEED_STEP = 10     // 每阶段减少的移动间隔（毫秒，速度变快更明显）
const SCORE_SPEED_STEP = 2      // 每 10 分减少的移动间隔（毫秒）
const SCORE_SPEED_UNIT = 10
const MIN_INTERVAL = 60         // 移动间隔下限

/** 特殊豆出现概率（说明书建议 20%-30%） */
/** 普通豆规则：每 3 秒生成一颗，场上最多同时存在 5 颗，不会自动消失 */
const NORMAL_SPAWN_SECONDS = 3
const MAX_NORMAL_BEANS = 5
/** 特殊豆存在时长（秒），到期自动消失 */
const SPECIAL_LIFE_SECONDS = 8
/** 普通豆基础分值 */
const NORMAL_POINTS = 1

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
    this.foods = []
    this.special = null
    this.obstacles = []             // 障碍物（设计文档 §3.3）
    this.normalSpawnTimer = NORMAL_SPAWN_SECONDS
    this.growBonus = 0              // 待成长的节数（文件道具）
    this.spawnNormalBean()
    // 障碍模式 / 无尽模式 / 摸鱼模式默认开启障碍
    this.obstacleMode = (this.mode === MODES.OBSTACLE || this.mode === MODES.ENDLESS)
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
    this.spawnNormalBeanTick()      // 普通豆：每 3 秒一颗，上限 5
    this.spawnSpecialTick()         // 特殊豆：8 秒后自动消失
    this.tickObstacles()            // 障碍物：生成/移动/到期
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
   * 摸鱼模式自动寻豆：朝最近的豆子贪心前进，并避开致命方向
   * （撞墙/撞自己/致命障碍）
   */
  autoSteer() {
    const head = this.snake[0]
    const beans = this.allBeans()
    const dirs = ['up', 'right', 'down', 'left']

    const nextOf = (name) => {
      const v = DIRS[name]
      let nx = head.x + v.x, ny = head.y + v.y
      if (this.mode === MODES.WRAP) { nx = (nx + this.cols) % this.cols; ny = (ny + this.rows) % this.rows }
      return { x: nx, y: ny, wall: nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows }
    }
    const blocked = (x, y) => {
      const body = this.snake.slice(0, -1)
      if (body.some((c) => c.x === x && c.y === y)) return true
      const ob = this.obstacles.find((o) => o.x === x && o.y === y)
      return !!(ob && (OBSTACLES[ob.type] || {}).lethal)
    }
    const valid = (name) => {
      const v = DIRS[name]
      if (this.dir && this.dir.x + v.x === 0 && this.dir.y + v.y === 0) return false
      const n = nextOf(name)
      if (n.wall) return false
      return !blocked(n.x, n.y)
    }

    /** 洪水填充：从该方向出发可达的空格数（评估安全性） */
    const space = (name) => {
      const n = nextOf(name)
      if (n.wall || blocked(n.x, n.y)) return 0
      const key = (x, y) => x + ',' + y
      const seen = new Set([key(n.x, n.y)])
      const queue = [[n.x, n.y]]
      let count = 0
      while (queue.length && count < 200) {
        const [cx, cy] = queue.shift()
        count++
        for (const d of dirs) {
          const v = DIRS[d]
          let nx = cx + v.x, ny = cy + v.y
          if (this.mode === MODES.WRAP) { nx = (nx + this.cols) % this.cols; ny = (ny + this.rows) % this.rows }
          if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue
          const k = key(nx, ny)
          if (seen.has(k) || blocked(nx, ny)) continue
          seen.add(k)
          queue.push([nx, ny])
        }
      }
      return count
    }

    const candidates = dirs.filter(valid)
    if (!candidates.length) return

    // 无豆子时：选空间最大的方向；有豆子时优先靠近，但空间过小则改选安全方向
    let target = null
    if (beans.length) {
      let best = Infinity
      for (const b of beans) {
        const d = Math.abs(b.x - head.x) + Math.abs(b.y - head.y)
        if (d < best) { best = d; target = b }
      }
    }
    const dist = (name) => {
      if (!target) return 0
      const n = nextOf(name)
      return Math.abs(target.x - n.x) + Math.abs(target.y - n.y)
    }
    const spaces = {}
    for (const c of candidates) spaces[c] = space(c)
    const bodyLen = this.snake.length
    const maxSpace = Math.max(...candidates.map((c) => spaces[c]))

    // 安全方向：可达空间不小于蛇身长度（避免钻进死胡同）
    const need = Math.min(bodyLen + 2, maxSpace)
    let pool = candidates.filter((c) => spaces[c] >= need)
    if (!pool.length) pool = candidates

    // 在安全方向中，选「能缩短与目标距离」的方向；距离相同则选空间更大的
    pool.sort((a, b) => {
      const dd = dist(a) - dist(b)
      if (dd !== 0) return dd
      return spaces[b] - spaces[a]
    })
    this.pendingDir = pool[0]
  }

  /**
   * 磁铁效果：吸附半径内的豆子每 tick 向蛇头靠近一格
   * 作用于场上所有豆子（普通豆与特殊豆）
   */
  applyMagnet() {
    if (!this.hasEffect('magnet')) return
    const head = this.snake[0]
    const R = 6                                   // 吸附半径（格）
    for (const f of this.allBeans()) {
      const d = Math.abs(f.x - head.x) + Math.abs(f.y - head.y)
      if (d > R || d === 0) continue
      // 朝蛇头方向移动一格（优先走差距较大的轴）
      const dx = head.x - f.x, dy = head.y - f.y
      if (Math.abs(dx) >= Math.abs(dy)) f.x += Math.sign(dx)
      else f.y += Math.sign(dy)
    }
  }

  /* ---------------- 障碍物（设计文档 §3.3） ---------------- */

  /** 障碍物每秒推进：到期消失；「正在输入」会横向或纵向移动 */
  tickObstacles() {
    if (!this.obstacleMode) { this.obstacles = []; return }
    // 计时与移动
    for (const ob of this.obstacles) {
      ob.left -= 1
      if (OBSTACLES[ob.type] && OBSTACLES[ob.type].moving && ob.left > 0) {
        // 撞到边界或蛇身则反向
        const nx = ob.x + (ob.dx || 0)
        const ny = ob.y + (ob.dy || 0)
        const bad = nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows ||
          this.snake.some((c) => c.x === nx && c.y === ny)
        if (bad) { ob.dx = -(ob.dx || 0); ob.dy = -(ob.dy || 0) }
        else { ob.x = nx; ob.y = ny }
      }
    }
    this.obstacles = this.obstacles.filter((ob) => ob.left > 0)

    // 生成：各类型按各自概率尝试，数量随分数增加（设计文档 §五）
    const maxObstacles = 1 + Math.floor(this.score / 30)
    if (this.obstacles.length >= maxObstacles) return
    for (const type of OBSTACLE_TYPES) {
      const cfg = OBSTACLES[type]
      if (Math.random() >= cfg.spawnRate) continue
      const cell = this.randomFreeCell()
      if (!cell) return
      const ob = { x: cell.x, y: cell.y, type, left: cfg.life }
      if (cfg.moving) {
        // 随机横向或纵向移动
        if (Math.random() > 0.5) ob.dx = Math.random() > 0.5 ? 1 : -1
        else ob.dy = Math.random() > 0.5 ? 1 : -1
      }
      this.obstacles.push(ob)
      break
    }
  }

  /** 清除障碍物：炸弹豆清周围，撤回消息清全部 */
  clearObstacles(radius, origin) {
    if (!this.obstacles.length) return 0
    const before = this.obstacles.length
    if (!radius) this.obstacles = []
    else {
      this.obstacles = this.obstacles.filter((ob) => {
        const d = Math.abs(ob.x - origin.x) + Math.abs(ob.y - origin.y)
        return d > radius
      })
    }
    return before - this.obstacles.length
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

  /** 生成一颗普通豆（不超过上限） */
  spawnNormalBean() {
    if (this.foods.length >= MAX_NORMAL_BEANS) return null
    const cell = this.randomFreeCell()
    if (!cell) return null
    const bean = { x: cell.x, y: cell.y, type: 'normal' }
    this.foods.push(bean)
    return bean
  }

  /**
   * 普通豆计时：每 3 秒生成一颗，最多同时存在 5 颗。
   * 普通豆不会自动消失，只能被玩家吃掉。
   */
  spawnNormalBeanTick() {
    if (this.foods.length >= MAX_NORMAL_BEANS) {
      this.normalSpawnTimer = 1      // 满额时不累积，满员解除后 1 秒内补上
      return
    }
    this.normalSpawnTimer -= 1
    if (this.normalSpawnTimer <= 0) {
      this.spawnNormalBean()
      this.normalSpawnTimer = NORMAL_SPAWN_SECONDS
    }
  }

  /**
   * 特殊豆计时：场上至多一颗；8 秒后自动消失；
   * 消失后（或原本没有时）按 40%~50% 概率在每秒判定中尝试生成。
   */
  spawnSpecialTick() {
    if (this.special) {
      this.special.left -= 1
      if (this.special.left <= 0) this.special = null      // 8 秒到期自动消失
      return
    }
    const rate = SPECIAL_RATE_MIN + Math.random() * (SPECIAL_RATE_MAX - SPECIAL_RATE_MIN)
    if (this.specialFood && Math.random() < rate) this.spawnSpecial()
  }

  /** 生成一颗随机特殊豆（存活 8 秒） */
  spawnSpecial() {
    const cell = this.randomFreeCell()
    if (!cell) return null
    const type = SPECIAL_KEYS[Math.floor(Math.random() * SPECIAL_KEYS.length)]
    this.special = {
      x: cell.x, y: cell.y, type,
      left: SPECIAL_LIFE_SECONDS                      // 剩余存活秒数
    }
    return this.special
  }

  /** 当前场上所有可吃的豆子 */
  allBeans() {
    const list = this.foods.slice()
    if (this.special) list.push(this.special)
    return list
  }

  /** 兼容旧接口：返回一颗豆子（用于渲染/测试） */
  get food() {
    return this.foods.length ? this.foods[0] : (this.special || null)
  }

  /* ---------------- 单步推进 ---------------- */
  tick() {
    if (this.state !== 'running' || !this.alive) return { moved: false }

    // 摸鱼模式：蛇自动寻找最近的豆子
    if (this.mode === MODES.MOYU) this.autoSteer()

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

    // 障碍物碰撞（设计文档 §3.3）
    const hitOb = this.obstacles.find((ob) => ob.x === nx && ob.y === ny)
    if (hitOb) {
      const cfg = OBSTACLES[hitOb.type] || {}
      if (cfg.lethal) {
        const r0 = this.takeDamage('obstacle')
        if (!r0.blocked) return { moved: false, dead: 'obstacle', obstacle: hitOb.type }
      } else {
        // 非致命：扣分并移除该障碍（撞到后消失）
        if (cfg.points) this.score = Math.max(0, this.score + cfg.points)
        this.obstacles = this.obstacles.filter((o) => o !== hitOb)
        return { moved: false, hitObstacle: hitOb.type, penalty: cfg.points || 0 }
      }
    }
    // 免打扰：进入减速区
    const dnd = this.obstacles.find((ob) => ob.type === 'dnd' && ob.x === nx && ob.y === ny)
    if (dnd) this.effects.slow = Math.max(this.effects.slow || 0, 2)

    // 撞自己（蛇尾即将移动，因此允许移动到当前尾部位置）
    const eating = (f) => f && nx === f.x && ny === f.y
    const targetBean = this.allBeans().find(eating)
    const willEat = !!targetBean
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
      // 先从场上移除该豆子，再结算（普通豆吃掉即消失，特殊豆同理）
      if (this.special && targetBean === this.special) this.special = null
      else this.foods = this.foods.filter((b) => b !== targetBean)
      const res = this.consume(targetBean)
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
      // ── 设计文档新增道具效果 ──
      if (type === 'bomb')   this.clearObstacles(2, food)          // 炸弹豆：清除周围障碍
      if (type === 'file') { this.growBonus += 2; this.effects.slow = (this.effects.slow || 0) + 3 } // 文件：+2 节并短暂减速
      if (type === 'voice')  this.effects.speed = 3                // 语音：加速 3 秒
      if (type === 'recall') this.clearObstacles(0)                // 撤回：清除全部障碍
      if (type === 'emoji') {
        // 表情：随机效果（加分 / 减速 / 清障）
        const roll = Math.floor(Math.random() * 3)
        if (roll === 0) gained += 5
        else if (roll === 1) this.effects.slow = (this.effects.slow || 0) + 3
        else this.clearObstacles(0)
        this.emojiResult = roll
      }
    }

    // 双倍豆：吃豆得分翻倍
    if (this.hasEffect('double')) gained *= 2

    // 连击：每达到一个分数段，吃豆得分的倍数 +1
    const mul = this.multiplier()
    if (mul > 1) gained *= mul

    // 文件道具：待成长节数逐次补上
    if (this.growBonus > 0) {
      for (let i = 0; i < this.growBonus; i++) {
        const tail = this.snake[this.snake.length - 1]
        this.snake.push({ x: tail.x, y: tail.y })
      }
      this.growBonus = 0
    }
    this.score += gained
    this.comboCount += 1
    // 被吃掉的豆子从场上移除（普通豆与特殊豆均已由其来源处理）
    return { gained, special, stage: this.stage(), multiplier: mul, bean: food }
  }

  /** 当前所处分数段（0 起） */
  /**
   * 当前阶段数（0 起）
   * 阈值：20 / 40 / 60 / 100，之后每增加 100 分再进一阶：
   * 200 / 300 / 400 ...
   */
  stage() {
    let n = 0
    for (const t of STAGE_THRESHOLDS) if (this.score >= t) n++
    if (this.score >= 200) {
      n += Math.floor((this.score - 200) / STAGE_TAIL_STEP) + 1
    }
    return n
  }

  /**
   * 当前连击倍率：1 + 阶段数
   * 即 20 分后 ×2、40 分后 ×3、60 分后 ×4、100 分后 ×5，依次类推
   */
  multiplier() {
    return 1 + this.stage()
  }

  /** 当前移动间隔（含分数段加速与特殊豆效果） */
  interval() {
    const base = { slow: 280, mid: 160, fast: 110 }[this.speed] || 160
    if (this.mode === MODES.TIMED) return base   // 限时模式固定中速

    // 随分数平滑加快（封顶 40ms）+ 每个分数段再提速一档
    const scoreAccel = Math.min(40, Math.floor(this.score / SCORE_SPEED_UNIT) * SCORE_SPEED_STEP)
    let iv = base - scoreAccel - this.stage() * STAGE_SPEED_STEP
    // 摸鱼模式：蛇自己吃，速度更快（约 2 倍），但设较高下限避免太紧张
    if (this.mode === MODES.MOYU) iv = Math.max(90, Math.round(iv / 2))
    else if (this.mode === MODES.ENDLESS) iv = Math.max(45, iv)   // 无尽：下限更低
    else iv = Math.max(MIN_INTERVAL, iv)
    // 语音豆加速
    if (this.hasEffect('speed')) iv = Math.max(45, Math.round(iv / 1.8))
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
      invincible: this.invincible, effects: this.effects,
      foods: this.foods, special: this.special,
      obstacles: this.obstacles, obstacleMode: this.obstacleMode,
      remainSeconds: this.remainSeconds,
      overReason: this.overReason,
      packetPopup: this.packetPopup
    }
  }
}

module.exports = { SnakeGame, MODES, DIRS, SPECIALS, SPECIAL_KEYS, SPECIAL_RATE_MIN, SPECIAL_RATE_MAX,
  SPECIAL_RATE_MID, INVINCIBLE_SECONDS, STAGE_THRESHOLDS,
  NORMAL_SPAWN_SECONDS, MAX_NORMAL_BEANS, SPECIAL_LIFE_SECONDS,
  OBSTACLES, OBSTACLE_TYPES }
