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
    shield: 0,
    effectText: '',
    bubbles: [],              // 装饰性聊天气泡
    bgStyle: 'background: #EDEDED',
    // 结算弹窗（伪装为“消息发送失败”）
    result: { show: false, title: '', content: '' },
    // 红包飘字
    packetText: '',
    toastText: ''
  },

  /* ================= 生命周期 ================= */
  onLoad() {
    const app = getApp()
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
  onUnload() { this.stopLoop(); this.stopChatTimer() },

  /* ================= Canvas 初始化 ================= */
  initCanvas() {
    const query = wx.createSelectorQuery()
    query.select('#gameCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        // 极端情况下延迟重试一次
        setTimeout(() => this.initCanvas(), 120)
        return
      }
      const canvas = res[0].node
      const width = res[0].width
      const height = res[0].height
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2

      canvas.width = width * dpr
      canvas.height = height * dpr
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)

      this.canvas = canvas
      this.ctx = ctx
      this.dpr = dpr
      this.vw = width
      this.vh = height
      this.cell = Math.min(width / COLS, height / ROWS)

      this.createGame()
      this.draw()
    })
  },

  createGame() {
    const s = settings.get()
    this.game = new SnakeGame({
      cols: COLS, rows: ROWS,
      mode: s.mode,
      speed: s.speed,
      specialFood: s.specialFood,
      timedSeconds: s.timedSeconds
    })
    this.setData({
      score: 0,
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

    // 限时模式：秒级倒计时
    if (this.game.mode === MODES.TIMED) {
      this.secondTimer = setInterval(() => {
        if (!this.game || this.game.state !== 'running') return
        this.game.tickSecond()
        this.setData({ remainSeconds: this.game.remainSeconds })
        if (this.game.state === 'over') this.onGameOver()
      }, 1000)
    }
  },

  stopLoop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.secondTimer) { clearInterval(this.secondTimer); this.secondTimer = null }
  },

  stepOnce() {
    const g = this.game
    const r = g.tick()
    if (r.dead) { this.onGameOver(); return }

    if (r.shielded) {
      const s = settings.get()
      util.vibrate(s.vibrate)
      this.showToast(r.shielded === 'wall' ? '护盾抵挡了撞墙' : '护盾抵挡了撞击')
    }
    if (r.gained) {
      const s = settings.get()
      util.vibrate(s.vibrate)
      if (r.special) {
        const label = { gold: '金豆 +5', double: '双倍得分 20s', pace: '减速 8s',
                        shield: '护盾 +1', shrink: '蛇身 -2', packet: '红包 +' + r.gained }[r.special]
        this.showToast(label)
      }
      this.setData({ score: g.score, shield: g.shield, effectText: this.effectText() })
    }
    // 红包弹窗分数（说明书：获取时屏幕弹出红色的分数）
    if (g.packetPopup) {
      const txt = '+' + g.packetPopup
      g.packetPopup = 0
      this.setData({ packetText: txt })
      setTimeout(() => this.setData({ packetText: '' }), 1200)
    }
    this.draw()
  },

  effectText() {
    const g = this.game
    const parts = []
    if (g.hasEffect('double')) parts.push('×2 ' + g.effects.double + 's')
    if (g.hasEffect('slow')) parts.push('减速 ' + g.effects.slow + 's')
    if (g.shield) parts.push('护盾 ×' + g.shield)
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

    // 背景（聊天底色）
    ctx.clearRect(0, 0, this.vw, this.vh)
    const s = settings.get()
    if (!s.background || s.background === 'default') {
      ctx.fillStyle = '#EDEDED'
      ctx.fillRect(0, 0, this.vw, this.vh)
    }

    const ox = (this.vw - cell * COLS) / 2
    const oy = (this.vh - cell * ROWS) / 2

    // 墙体：与界面边框同色同宽（界面边框 2rpx）
    // 墙宽与界面边框一致：2rpx ≈ 1px（ctx 已按 dpr 缩放，无需再乘）
    ctx.strokeStyle = '#D6D6D6'
    ctx.lineWidth = 1
    ctx.strokeRect(ox, oy, cell * COLS, cell * ROWS)

    // 豆子：普通豆/特殊豆 + 常驻节奏豆
    this.drawFood(ctx, g.food, ox, oy, cell)
    this.drawFood(ctx, g.paceFood, ox, oy, cell)

    // 蛇（绿色 #07C160，蛇头略深 #06AD56）
    const n = g.snake.length
    for (let i = n - 1; i >= 0; i--) {
      const seg = g.snake[i]
      const x = ox + seg.x * cell
      const y = oy + seg.y * cell
      const pad = Math.max(1, cell * 0.08)
      ctx.fillStyle = i === 0 ? '#06AD56' : '#07C160'
      const rad = Math.max(2, cell * 0.22)
      this.roundRect(ctx, x + pad, y + pad, cell - pad * 2, cell - pad * 2, rad)
      ctx.fill()
    }
  },

  /** 画一颗豆子（黑色本体 + 白描边 + 类型色外圈） */
  drawFood(ctx, food, ox, oy, cell) {
    if (!food) return
    const fx = ox + food.x * cell + cell / 2
    const fy = oy + food.y * cell + cell / 2
    const r = cell * 0.28

    ctx.beginPath()
    ctx.arc(fx, fy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#000000'
    ctx.fill()
    ctx.lineWidth = Math.max(1, cell * 0.07)
    ctx.strokeStyle = '#FFFFFF'
    ctx.stroke()

    const mark = {
      gold: '#FFD700', double: '#FFFFFF', shield: '#FFFFFF',
      shrink: '#FFFFFF', packet: '#FA5151', pace: '#1989FA'
    }[food.type]
    if (mark) {
      ctx.beginPath()
      ctx.arc(fx, fy, r * 1.7, 0, Math.PI * 2)
      ctx.lineWidth = Math.max(1.5, cell * 0.09)
      ctx.strokeStyle = mark
      ctx.stroke()
    }
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
    return { id, seq, text, self, avatar: self ? AVATAR_ME : AVATAR_OTHER }
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
    this.buildBubbles()
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
      this.startLoop()
    }
  },

  pauseGame(reason) {
    if (!this.game) return
    this.game.pause()
    this.stopLoop()
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

  /** 方向键 */
  onDir(e) {
    const dir = e.currentTarget.dataset.dir
    if (!this.game) return
    if (this.game.state === 'ready' || this.game.state === 'over') {
      this.onStart()
    }
    if (this.game.state !== 'running') return
    const ok = this.game.turn(dir)
    if (!ok) return
    // 微反馈
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
