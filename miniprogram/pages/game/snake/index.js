/**
 * 游戏页：聊天贪吃蛇（说明书 §5 / §6 / §8 / §9）
 * 视觉伪装成聊天窗口：顶部聊天栏 + 消息区（游戏画布）+ 底部操作栏（十字方向键）
 */
const { SnakeGame, MODES } = require('../../../utils/snake-engine')
const settings = require('../../../utils/settings')
const fake = require('../../../utils/fake')
const jokes = require('../../../utils/jokes')
const util = require('../../../utils/util')

const COLS = 20
const ROWS = 22

/** 聊天头像（原创几何头像，避免使用官方素材） */
const AVATAR_OTHER = '/images/avatar-snake.png'   // 对方（聊天对象）
const AVATAR_ME = '/images/avatar-me.png'         // 自己

Page({
  data: {
    statusBarHeight: 20,
    navHeight: 44,
    safeBottom: 0,
    chatName: '贪吃蛇',
    score: 0,
    best: 0,
    mode: 'classic',
    modeLabel: '经典',
    running: false,
    paused: false,
    over: false,
    bossMode: false,          // 老板键伪装中
    showSettings: false,
    remainSeconds: 0,
    effectText: '',
    bubbles: [],              // 装饰性聊天气泡
    bgStyle: 'background: #EDEDED',
    // 结算弹窗（伪装为“消息发送失败”）
    result: { show: false, title: '', content: '' },
    // 红包飘字
    packetText: '',
    packetBanner: false,   // 「红包来啦」提示
    beanCount: 0,          // 场上普通豆数量
    toastText: ''
  },

  /* ================= 生命周期 ================= */
  onLoad() {
    const app = getApp()
    this.initAudio()
    const s = settings.get()
    const modeLabel = { classic: '经典', wrap: '穿墙', timed: '限时' }[s.mode] || '经典'

    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      safeBottom: app.globalData.safeBottom,
      chatName: settings.normalizeChatName(s.chatName),
      mode: s.mode,
      modeLabel
    })

    const mb = app.globalData.menuButton
    if (mb && mb.top) {
      const h = (mb.top - app.globalData.statusBarHeight) * 2 + mb.height
      if (h > 0) this.setData({ navHeight: h })
    }

    this.initCanvas()
  },

  onReady() { this.buildBubbles() },

  onShow() {
    const app = getApp()
    // 设置页里点了「重新开始本局」
    if (app.globalData.restartOnReturn) {
      app.globalData.restartOnReturn = false
      this.createGame()
      this.onStart()
      return
    }
    // 从设置页返回：同步名称与设置
    const s = settings.get()
    this.setData({
      chatName: settings.normalizeChatName(s.chatName),
      mode: s.mode,
      modeLabel: { classic: '经典', wrap: '穿墙', timed: '限时' }[s.mode] || '经典',
      bgStyle: s.background && s.background !== 'default'
        ? `background-image: url(${s.background}); background-size: cover;`
        : 'background: #EDEDED'
    })
    if (this.game && this.game.state === 'paused') this.setData({ paused: true })
  },

  onHide() { this.pauseGame('hide') },   // 切后台自动暂停（说明书 §8.2）
  onUnload() {
    this.stopLoop()
    this.stopChatTimer()
    try { this.audioEat && this.audioEat.destroy() } catch (e) {}
    try { this.audioSpecial && this.audioSpecial.destroy() } catch (e) {}
    if (this.packetTimer) clearTimeout(this.packetTimer)
    if (this.bannerTimer) clearTimeout(this.bannerTimer)
  },

  /* ================= Canvas 初始化 ================= */
  initCanvas() {
    const query = wx.createSelectorQuery()
    query.select('#gameCanvas').fields({ node: true, size: true })
    query.select('#foodCanvas').fields({ node: true, size: true })
    query.exec((res) => {
      if (!res || !res[0] || !res[0].node || !res[1] || !res[1].node) {
        setTimeout(() => this.initCanvas(), 120)     // 极端情况延迟重试
        return
      }
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2
      const setup = (item) => {
        const canvas = item.node
        const width = item.width
        const height = item.height
        canvas.width = width * dpr
        canvas.height = height * dpr
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)
        return { canvas, ctx, width, height }
      }
      const main = setup(res[0])
      const food = setup(res[1])

      this.canvas = main.canvas
      this.ctx = main.ctx
      this.foodCanvas = food.canvas
      this.foodCtx = food.ctx
      this.dpr = dpr
      // 让网格精确填满消息区内框：墙的位置即界面边框位置
      this.cellsX = COLS
      this.cellsY = Math.max(8, Math.round(COLS * (main.height / main.width)))
      this.vw = main.width
      this.vh = main.height
      this.cell = main.width / COLS

      this.createGame()
      this.draw()
    })
  },

  createGame() {
    const s = settings.get()
    this.game = new SnakeGame({
      cols: this.cellsX || COLS,
      rows: this.cellsY || ROWS,
      mode: s.mode,
      speed: s.speed,
      specialFood: s.specialFood,
      timedSeconds: s.timedSeconds
    })
    this.packetOnField = false
    this.setData({
      packetBanner: false,
      score: 0,
      multiplier: 1,
      best: settings.getBest(s.mode),
      remainSeconds: this.game.remainSeconds,
      over: false, paused: false, running: false
    })
  },

  /* ================= 游戏循环 ================= */
  startLoop() {
    this.stopLoop()
    const step = () => {
      if (!this.game || this.game.state !== 'running') return
      this.stepOnce()
      this.timer = setTimeout(step, this.game.interval())
    }
    this.timer = setTimeout(step, this.game.interval())

    // 秒级计时：特殊豆效果、无敌倒计时（所有模式）；限时模式另有总倒计时
    this.secondTimer = setInterval(() => {
      if (!this.game || this.game.state !== 'running') return
      this.game.tickSecond()
      this.setData({
        remainSeconds: this.game.remainSeconds,
        effectText: this.effectText(),
        beanCount: (this.game.foods || []).length
      })
      if (this.game.state === 'over') this.onGameOver()
    }, 1000)
  },

  /**
   * 监听红包豆出现：场上从「无红包豆」变为「有红包豆」时弹出「红包来啦」
   * （需求：红包豆一出现就提示，而不是吃掉才提示）
   */
  watchPacketSpawn() {
    const g = this.game
    if (!g) return
    const hasPacket = g.allBeans().some((b) => b.type === 'packet')
    if (hasPacket && !this.packetOnField) {
      this.setData({ packetBanner: true })
      if (this.bannerTimer) clearTimeout(this.bannerTimer)
      this.bannerTimer = setTimeout(() => this.setData({ packetBanner: false }), 1800)
    }
    this.packetOnField = hasPacket
  },

  /** 两点间曼哈顿距离（用于插值时长：直行 1，对角 2） */
  distBetween(a, b) {
    if (!a || !b) return 1
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  },

  /** 初始化音效（本地 wav，无需网络） */
  initAudio() {
    try {
      this.audioEat = wx.createInnerAudioContext()
      this.audioEat.src = '/audio/eat.wav'
      this.audioSpecial = wx.createInnerAudioContext()
      this.audioSpecial.src = '/audio/special.wav'
    } catch (e) { this.audioEat = this.audioSpecial = null }
  },

  /** 播放音效（受设置中的「音效」开关控制） */
  playSfx(kind) {
    const s = settings.get()
    if (!s.sound) return
    const ctx = kind === 'special' ? this.audioSpecial : this.audioEat
    if (!ctx) return
    try { ctx.stop(); ctx.play() } catch (e) {}
  },

  /** 启动渲染循环：每帧按 tick 进度插值重绘 → 视觉上连续移动 */
  startRenderLoop() {
    this.stopRenderLoop()
    const raf = this.canvas && this.canvas.requestAnimationFrame
      ? (cb) => this.canvas.requestAnimationFrame(cb)
      : (cb) => setTimeout(cb, 16)
    const frame = () => {
      this.draw()
      this.drawFoodLayer()
      this.renderRaf = raf(frame)
    }
    this.renderRaf = raf(frame)
  },

  stopRenderLoop() {
    if (!this.renderRaf) return
    const cancel = this.canvas && this.canvas.cancelAnimationFrame
    if (cancel) { try { cancel(this.renderRaf) } catch (e) {} }
    this.renderRaf = null
  },

  stopLoop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.secondTimer) { clearInterval(this.secondTimer); this.secondTimer = null }
    this.stopRenderLoop()
  },

  stepOnce() {
    const g = this.game
    // 记录本帧起始状态，供渲染插值使用（平滑移动的关键）
    this.prevSnake = g.snake.map((s2) => ({ x: s2.x, y: s2.y }))
    this.lastTickAt = Date.now()
    const r = g.tick()
    // 立即转向会让相邻两节变为对角关系（位移 2 格），
    // 渲染时按位移长度分配时长，避免斜切穿过墙角
    this.moveDist = this.distBetween(this.prevSnake && this.prevSnake[0], g.snake[0])
    if (r.dead) { this.onGameOver(); return }

    if (r.shielded) {
      const s = settings.get()
      util.vibrate(s.vibrate)
      this.showToast(r.shielded === 'invincible' ? '无敌状态' : '被抵挡')
    }
    if (r.gained) {
      const s = settings.get()
      util.vibrate(s.vibrate)
      this.playSfx(r.special ? 'special' : 'eat')
      if (r.special) {
        const label = { gold: '金豆 +5', double: '双倍得分 20s', pace: '减速 8s',
                        magnet: '磁铁 15s', packet: '红包 +' + r.gained }[r.special]
        this.showToast(label)
      }
      this.setData({ score: g.score, multiplier: g.multiplier(), effectText: this.effectText() })
    }
    // 红包弹窗分数（说明书：获取时屏幕弹出红色的分数）
    // 红包豆「出现」即提示（不是吃掉才提示）
    this.watchPacketSpawn()

    // 吃掉红包豆：显示加大的得分数字，停留更久
    if (g.packetPopup) {
      const txt = '+' + g.packetPopup
      g.packetPopup = 0
      this.setData({ packetText: txt })
      if (this.packetTimer) clearTimeout(this.packetTimer)
    if (this.bannerTimer) clearTimeout(this.bannerTimer)
      this.packetTimer = setTimeout(() => this.setData({ packetText: '' }), 2600)
    }
    this.draw()
  },

  effectText() {
    const g = this.game
    const parts = []
    if (g.hasEffect('double')) parts.push('×2 ' + g.effects.double + 's')
    if (g.hasEffect('slow')) parts.push('减速 ' + g.effects.slow + 's')
    return parts.join(' · ')
  },

  onGameOver() {
    this.stopLoop()
    const g = this.game
    const s = settings.get()
    const isNewBest = settings.setBest(g.mode, g.score)

    this.setData({
      over: true, running: false, paused: false,
      best: settings.getBest(g.mode),
      result: {
        show: true,
        title: fake.pick(fake.FAIL_TITLES),   // 伪装成“消息发送失败”
        content: `本局得分：${g.score}　最高分：${settings.getBest(g.mode)}\n模式：${this.data.modeLabel}` +
                 (isNewBest ? '　🎉 新纪录' : '')
      }
    })
    this.draw()
  },

  /* ================= 绘制 ================= */
  draw() {
    const ctx = this.ctx
    if (!ctx || !this.game) return
    const g = this.game
    const cell = this.cell

    // 只清空画布（保持透明）
    // 注意：蛇层位于最上层（z-index 4），若在此填充不透明底色，
    // 会把下面的豆子层与聊天层全部遮住。背景由消息区容器的 CSS
    // （.msg-area 的 bgStyle）提供，画布必须保持透明。
    ctx.clearRect(0, 0, this.vw, this.vh)

    // 网格填满内框，无居中留白 → 墙体即为界面边框
    const ox = 0
    const oy = 0

    // 墙体：与界面边框同色同宽（界面边框 2rpx）
    // 墙宽与界面边框一致：2rpx ≈ 1px（ctx 已按 dpr 缩放，无需再乘）
    ctx.strokeStyle = '#D6D6D6'
    ctx.lineWidth = 1
    ctx.strokeRect(ox, oy, cell * this.cellsX, cell * this.cellsY)


    // 蛇：粗圆头线段连接各节中心 → 无缝隙
    // 平滑移动：在上一 tick 位置与当前位置之间按进度插值，
    // 使 100~280ms 的网格跳变看起来是连续滑动而非一格一格跳。
    const n = g.snake.length
    const inv = (g.invincible || 0) > 0
    const pulse = inv ? 1 + 0.04 * Math.sin(Date.now() / 130) : 1
    const interval = g.interval()
    const t = (this.lastTickAt && this.prevSnake ? (Date.now() - this.lastTickAt) / interval : 1)
    const p = Math.max(0, Math.min(1, t))      // 插值进度 0~1

    const prev = this.prevSnake || []
    // 各节渲染坐标：从「上一位置」滑动到「当前位置」
    // 每节从「上一 tick 的自身位置」滑动到「当前自身位置」：
    // 对第 i 节而言，当前自身位置 = 上一 tick 第 i-1 节的位置，
    // 因此起点应为 prev[i]，而不是 prev[i+1]（否则蛇头起点会错一格）
    const pos = (i) => {
      const cur = g.snake[i]
      const from = prev[i] || cur
      const dx = cur.x - from.x
      const dy = cur.y - from.y
      const manhattan = Math.abs(dx) + Math.abs(dy)
      // 跨边界（穿墙，位移 > 2）不插值，避免出现长线
      if (manhattan > 2) {
        return { x: ox + cur.x * cell + cell / 2, y: oy + cur.y * cell + cell / 2 }
      }
      // 对角位移(2)需要在同样时间内走更远，这里按位移长度分摊进度：
      // 先走完较长的轴，再走另一轴，避免斜切穿过墙角
      let fx = from.x, fy = from.y
      if (manhattan <= 1) {
        fx = from.x + dx * p
        fy = from.y + dy * p
      } else {
        const t = Math.min(1, p * manhattan)      // 0~1 走完整段
        // 分两段：先走 x 再走 y（或按缺口大小决定顺序）
        const half = 0.5
        if (t <= half) {
          const k = t / half
          fx = from.x + dx * k
          fy = from.y
        } else {
          const k = (t - half) / half
          fx = from.x + dx
          fy = from.y + dy * k
        }
      }
      return { x: ox + fx * cell + cell / 2, y: oy + fy * cell + cell / 2 }
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const strokes = [
      { w: cell * 0.94, color: inv ? 'rgba(34, 211, 238, 0.55)' : '#05A050' },
      { w: cell * 0.78, color: inv ? '#22D3EE' : '#07C160' }
    ]
    for (const st of strokes) {
      ctx.lineWidth = st.w * pulse
      ctx.strokeStyle = st.color
      ctx.beginPath()
      for (let i = 0; i < n - 1; i++) {
        // 相邻节是否连续（未跨边界），跨边界则断开
        const a0 = g.snake[i], b0 = g.snake[i + 1]
        if (Math.abs(a0.x - b0.x) > 1 || Math.abs(a0.y - b0.y) > 1) continue
        const a = pos(i), b = pos(i + 1)
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
      ctx.stroke()
    }

    // 各节圆点（保证断开处与单节时可见）
    ctx.fillStyle = inv ? '#22D3EE' : '#07C160'
    for (let i = 1; i < n; i++) {
      const a = pos(i)
      ctx.beginPath()
      ctx.arc(a.x, a.y, cell * 0.39 * pulse, 0, Math.PI * 2)
      ctx.fill()
    }

    // 蛇头
    const head = pos(0)
    ctx.beginPath()
    ctx.arc(head.x, head.y, cell * 0.44 * pulse, 0, Math.PI * 2)
    ctx.fillStyle = inv ? '#22D3EE' : '#06AD56'
    ctx.fill()


    // 无敌光环
    if (inv) {
      ctx.beginPath()
      ctx.arc(ox + g.snake[0].x * cell + cell / 2, oy + g.snake[0].y * cell + cell / 2,
        cell * 0.8, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.75)'
      ctx.lineWidth = Math.max(1.5, cell * 0.08)
      ctx.stroke()
    }
  },

  /** 画一颗豆子（黑色本体 + 白描边 + 类型色外圈） */
  /**
   * 画豆子：各类特殊豆在「形状 / 大小 / 颜色」上明显区分
   *  - 普通豆：黑色小圆
   *  - 金豆：金色圆（大）+ 深金描边
   *  - 双倍豆：白色方块 + 「×2」
   *  - 减速豆：蓝色圆（中）
   *  - 缩小豆：白色小圆（最小）
   *  - 红包：红色圆角矩形（最大）+ 金边与金色封口
   */
  /** 豆子层：单独画布绘制，确保显示在聊天消息之上 */
  drawFoodLayer() {
    const ctx = this.foodCtx
    if (!ctx || !this.game) return
    const cell = this.cell
    ctx.clearRect(0, 0, this.vw, this.vh)
    const ox = 0, oy = 0
    const g = this.game
    const beans = (g.foods || []).slice()
    if (g.special) beans.push(g.special)
    for (const b of beans) this.drawFood(ctx, b, ox, oy, cell)
  },

  /**
   * 画豆子：种类靠「形状 + 颜色」区分，尺寸整体加大，统一白色描边
   *  - 普通豆：黑色圆
   *  - 金豆：金色圆（大）
   *  - 减速豆：蓝色圆
   *  - 双倍豆：白色方块 + 「×2」
   *  - 红包：红色圆角矩形（最大）
   */
  drawFood(ctx, food, ox, oy, cell) {
    if (!food) return
    const cx = ox + food.x * cell + cell / 2
    const cy = oy + food.y * cell + cell / 2
    const base = cell * 0.38            // 基础半径（再次加大）
    const type = food.type || 'normal'
    const ringW = Math.max(2, cell * 0.11)   // 统一的描边宽度

    // ── 红包：最大 ──
    if (type === 'packet') {
      const w = cell * 1.06, h = cell * 1.22
      ctx.fillStyle = '#FA5151'
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = ringW
      this.roundRect(ctx, cx - w / 2, cy - h / 2, w, h, cell * 0.18)
      ctx.fill(); ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy - h * 0.14, w * 0.2, 0, Math.PI * 2)
      ctx.fillStyle = '#FFD700'
      ctx.fill()
      ctx.lineWidth = Math.max(1.5, cell * 0.07)
      ctx.strokeStyle = '#FFFFFF'
      ctx.stroke()
      return
    }

    // ── 双倍豆：方块 + ×2 ──
    if (type === 'double') {
      const d = cell * 0.72
      ctx.fillStyle = '#FFFFFF'
      ctx.strokeStyle = '#F59E0B'
      ctx.lineWidth = ringW
      this.roundRect(ctx, cx - d / 2, cy - d / 2, d, d, cell * 0.12)
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#F59E0B'
      ctx.font = 'bold ' + Math.max(9, Math.round(cell * 0.46)) + 'px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('×2', cx, cy + 1)
      return
    }

    // ── 磁铁豆：黑底 + 白色 U 形磁铁图标 ──
    if (type === 'magnet') {
      const r = base * 1.25
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = '#000000'
      ctx.fill()
      ctx.lineWidth = Math.max(2, cell * 0.11)
      ctx.strokeStyle = '#FFFFFF'
      ctx.stroke()

      // U 形磁铁（白色两条竖臂 + 底部弧）
      const aw = r * 0.95           // 整体宽
      const ah = r * 1.0            // 整体高
      const arm = Math.max(2, cell * 0.13)
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = arm
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(cx - aw / 2, cy - ah / 2)          // 左臂上端
      ctx.lineTo(cx - aw / 2, cy + ah * 0.08)
      ctx.arc(cx, cy + ah * 0.08, aw / 2, Math.PI, 0, true)   // 底部半圆
      ctx.lineTo(cx + aw / 2, cy - ah / 2)          // 右臂上端
      ctx.stroke()
      // 两个磁极（红色小段）
      ctx.strokeStyle = '#FA5151'
      ctx.lineWidth = arm * 1.15
      ctx.beginPath()
      ctx.moveTo(cx - aw / 2, cy - ah / 2)
      ctx.lineTo(cx - aw / 2, cy - ah * 0.2)
      ctx.moveTo(cx + aw / 2, cy - ah / 2)
      ctx.lineTo(cx + aw / 2, cy - ah * 0.2)
      ctx.stroke()
      return
    }

    // ── 圆形类：金豆 / 减速豆 / 普通豆（尺寸与颜色不同，统一白描边）──
    const spec = {
      gold:   { r: base * 1.35, fill: '#E6A700' },
      slow:   { r: base * 1.15, fill: '#0F6FD1' },
      normal: { r: base,        fill: '#000000' }
    }[type] || { r: base, fill: '#000000' }

    ctx.beginPath()
    ctx.arc(cx, cy, spec.r, 0, Math.PI * 2)
    ctx.fillStyle = spec.fill
    ctx.fill()
    ctx.lineWidth = ringW
    ctx.strokeStyle = '#FFFFFF'
    ctx.stroke()
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  },

  /**
   * 初始化聊天消息：模拟真实微信聊天，消息按时间顺序向下累积
   * 对方在左、自己在右，靠边框两侧对齐
   */
  buildBubbles() {
    const s = settings.get()
    this.msgSeq = 0
    if (!s.fakeMsg) { this.setData({ messages: [], scrollTo: '' }); this.stopChatTimer(); return }

    // 初始铺满一段搞笑对话
    const arr = []
    const seed = jokes.conversation(3)
    seed.forEach((m) => arr.push(this.makeMessage(arr.length, m)))
    this.setData({ messages: arr, scrollTo: 'msg-' + arr[arr.length - 1].id })
    this.startChatTimer()
  },

  /** 构造一条随机消息（随机对方/自己、随机文案） */
  makeMessage(seq, preset) {
    const id = ++this.msgSeq
    const self = preset ? !!preset.self : Math.random() > 0.5
    const text = preset ? preset.text : fake.pick(fake.BUBBLES)
    // 头像必须两侧都有：自己在右用蓝色头像，对方在左用绿色头像
    const avatar = self ? AVATAR_ME : AVATAR_OTHER
    return { id, seq, text, self, avatar }
  },

  /** 定时追加新消息并向下滚动（像真实聊天持续收到消息） */
  startChatTimer() {
    this.stopChatTimer()
    const s = settings.get()
    if (!s.fakeMsg) return
    const iv = s.fakeMsgRate === 'high' ? 2200 : s.fakeMsgRate === 'mid' ? 3800 : 6000
    this.chatTimer = setInterval(() => {
      if (this.data.bossMode) return
      const list = (this.data.messages || []).slice()
      // 每次追加一小段对话（1-2 条），像真的在聊天
      const batch = jokes.oneMessage()
      batch.forEach((m) => list.push(this.makeMessage(list.length, m)))
      // 只保留最近 40 条，避免长期运行内存增长
      while (list.length > 40) list.shift()
      const last = list[list.length - 1]
      this.setData({ messages: list, scrollTo: 'msg-' + last.id })
    }, iv)
  },

  stopChatTimer() {
    if (this.chatTimer) { clearInterval(this.chatTimer); this.chatTimer = null }
  },

  drawBubbles(ctx, ox, oy) {
    // 气泡用 WXML 渲染（更易做圆角与换行），此处不重复绘制
  },

  /* ================= 操作 ================= */
  onStart() {
    if (!this.game || this.game.state === 'over') this.createGame()
    this.game.start()
    this.setData({ running: true, paused: false, over: false, result: { show: false } })
    // 修复：暂停→继续 之后假消息不再更新
    // 原因为重复启动定时器（暂停时旧定时器仍在，resume 又新建一个），
    // 这里统一先停后启；消息内容不清空，只恢复刷新。
    this.stopChatTimer()
    if (!(this.data.messages || []).length) this.buildBubbles()
    else this.startChatTimer()
    this.startLoop()
    this.draw()
  },

  onPauseToggle() {
    if (!this.game) return
    if (this.game.state === 'running') {
      this.pauseGame('user')
    } else if (this.game.state === 'paused') {
      this.game.resume()
      this.setData({ paused: false, running: true })
      this.stopChatTimer()
      this.startChatTimer()
      this.startLoop()
      this.startRenderLoop()
    }
  },

  pauseGame(reason) {
    if (!this.game) return
    this.game.pause()
    this.stopLoop()
    this.stopChatTimer()          // 暂停时停掉聊天刷新，避免定时器泄漏
    this.setData({ paused: true, running: false })
    if (reason === 'hide') this.pausedByHide = true
  },

  /** 暂停时点击伪装的聊天底框 → 继续游戏 */
  onResumeFromBar() {
    if (this.game && this.game.state === 'paused') this.onPauseToggle()
  },

  onRestart() {
    this.createGame()
    this.onStart()
    this.showToast('已重开')
  },

  /** 方向键（点按） */
  /** 方向键（点按） */
  /**
   * 方向键（点按）
   *
   * 按键延迟的来源不是平滑插值，而是「方向要等下一个 tick 才生效」——
   * 最坏要等一个间隔（慢档 280ms / 中档 160ms）。这里改为：
   *   按下方向键 → 立即应用方向并推进一格 → 再重启循环
   * 使转向在按键瞬间可见，延迟 ≈ 0。
   * 若两次按键间隔极短（<40ms，属于连点），则只记录方向交给下一个 tick，
   * 避免因连点而瞬间前进多格。
   */
  onDir(e) {
    const dir = e.currentTarget.dataset.dir
    if (!this.game) return
    if (this.game.state === 'ready' || this.game.state === 'over') {
      this.onStart()
    }
    if (this.game.state !== 'running') return
    if (!this.game.turn(dir)) return

    const now = Date.now()
    const tooFast = this.lastDirAt && (now - this.lastDirAt) < 40

    if (tooFast) {
      // 连点：仅记录方向，等下一个 tick 生效
      if (this.game) this.game.pendingDir = dir
    } else {
      // 立即推进一格，让转向即时可见
      this.stopLoop()
      this.stepOnce()                 // 内部会记录 prevSnake / lastTickAt 并处理死亡
      if (this.game && this.game.state === 'running') this.startLoop()
      this.startRenderLoop()
    }
    this.lastDirAt = now

    const s = settings.get()
    util.vibrate(s.vibrate)
  },




  /* ---------- 消息区滑动控制方向（说明书 §5.3） ---------- */
  onTouchStart(e) {
    const t = e.touches && e.touches[0]
    if (!t) return
    this.touchStart = { x: t.clientX, y: t.clientY, time: Date.now() }
  },

  onTouchEnd(e) {
    const st = this.touchStart
    if (!st) return
    const t = (e.changedTouches && e.changedTouches[0]) || null
    if (!t) return
    const dx = t.clientX - st.x
    const dy = t.clientY - st.y
    const dist = Math.max(Math.abs(dx), Math.abs(dy))
    if (dist < 24) return   // 视为点击
    if (Math.abs(dx) > Math.abs(dy)) this.onDir({ currentTarget: { dataset: { dir: dx > 0 ? 'right' : 'left' } } })
    else this.onDir({ currentTarget: { dataset: { dir: dy > 0 ? 'down' : 'up' } } })
  },

  /** 老板键：双击消息区立即伪装（说明书 §9） */
  onMessageTap() {
    const now = Date.now()
    if (this.lastTap && now - this.lastTap < 300) {
      const s = settings.get()
      if (!s.bossKey) return
      const next = !this.data.bossMode
      if (next) this.pauseGame('user')
      this.setData({ bossMode: next })
      this.showToast(next ? '已伪装' : '已恢复')
      this.lastTap = 0
      return
    }
    this.lastTap = now
  },

  /** 点击聊天对象名称也可触发伪装（说明书 §9） */
  onTitleTap() {
    const s = settings.get()
    if (!s.bossKey) return
    const next = !this.data.bossMode
    if (next) this.pauseGame('user')
    this.setData({ bossMode: next })
    this.showToast(next ? '已伪装' : '已恢复')
  },

  /* ---------- 退出（说明书 §8.1：游戏中先暂停并弹确认，文案伪装） ---------- */
  onBack() {
    if (this.game && this.game.state === 'running') {
      this.pauseGame('user')
      wx.showModal({
        title: fake.pick(fake.EXIT_TEXTS),
        content: '',
        confirmText: '删除',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this.saveBest()
            wx.navigateBack()
          } else {
            // 取消后继续游戏
            if (this.game) { this.game.resume(); this.setData({ paused: false, running: true }); this.startLoop() }
          }
        }
      })
      return
    }
    this.saveBest()
    wx.navigateBack()
  },

  saveBest() {
    const g = this.game
    if (g && g.score > 0) settings.setBest(g.mode, g.score)
  },

  /* ---------- 结算弹窗按钮（伪装成“重新发送 / 返回聊天”） ---------- */
  onResend() {
    this.setData({ result: { show: false } })
    this.onRestart()
  },
  onBackToChat() {
    this.setData({ result: { show: false } })
    this.saveBest()
    wx.navigateBack()
  },

  /* ---------- 设置入口（右上角三个点） ---------- */
  onOpenSettings() {
    this.pauseGame('user')   // 打开设置自动暂停（说明书 §8.2）
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  showToast(text) {
    this.setData({ toastText: text || '' })
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.setData({ toastText: '' }), 900)
  },

  onShareAppMessage() { return { title: '聊天', path: '/pages/index/index' } }
})
