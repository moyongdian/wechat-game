/**
 * 设置页（说明书 §7）
 * 聊天对象名称 / 游戏模式 / 速度 / 音效 / 震动 / 聊天背景 / 假消息 / 老板键 / 清除最高分
 */
const settings = require('../../utils/settings')
const util = require('../../utils/util')

const SPEEDS = [
  { key: 'slow', label: '慢' },
  { key: 'mid', label: '中' },
  { key: 'fast', label: '快' }
]
const MODES = [
  { key: 'classic', label: '经典' },
  { key: 'wrap', label: '穿墙' },
  { key: 'timed', label: '限时' }
]
const RATES = [
  { key: 'low', label: '低' },
  { key: 'mid', label: '中' },
  { key: 'high', label: '高' }
]

Page({
  data: {
    statusBarHeight: 20,
    navHeight: 44,
    safeBottom: 0,
    s: {},
    speeds: SPEEDS,
    modes: MODES,
    rates: RATES,
    best: { classic: 0, wrap: 0, timed: 0 },
    version: '1.0.0'
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      safeBottom: app.globalData.safeBottom
    })
    const mb = app.globalData.menuButton
    if (mb && mb.top) {
      const h = (mb.top - app.globalData.statusBarHeight) * 2 + mb.height
      if (h > 0) this.setData({ navHeight: h })
    }
    this.refresh()
  },

  refresh() {
    const s = settings.get()
    this.setData({
      s,
      best: {
        classic: settings.getBest('classic'),
        wrap: settings.getBest('wrap'),
        timed: settings.getBest('timed')
      }
    })
  },

  onBack() {
    // 返回游戏页；名称与设置在 onShow 中读取，无需额外传参
    wx.navigateBack()
  },

  /* ---------- 聊天对象名称（1-20 字符） ---------- */
  onNameInput(e) {
    this.setData({ 's.chatName': e.detail.value })
  },
  onNameBlur(e) {
    const name = settings.normalizeChatName(e.detail.value)
    settings.set('chatName', name)
    this.refresh()
    util.toast('已保存')
  },

  /* ---------- 通用选项切换 ---------- */
  onPickSpeed(e) { settings.set('speed', e.currentTarget.dataset.v); this.refresh() },
  onPickMode(e) { settings.set('mode', e.currentTarget.dataset.v); this.refresh() },
  onPickRate(e) { settings.set('fakeMsgRate', e.currentTarget.dataset.v); this.refresh() },

  onToggle(e) {
    const key = e.currentTarget.dataset.key
    settings.set(key, !this.data.s[key])
    this.refresh()
  },

  /* ---------- 聊天背景（说明书 §7：默认背景 / 自定义图片） ---------- */
  onPickBackground() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],   // 自定义背景过大时压缩后使用（说明书 §13）
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0]
        if (!f) return
        settings.set('background', f.tempFilePath)
        this.refresh()
        util.toast('背景已更新')
      },
      fail: () => {}
    })
  },
  onResetBackground() {
    settings.set('background', 'default')
    this.refresh()
    util.toast('已恢复默认背景')
  },

  /* ---------- 清除最高分（二次确认） ---------- */
  onClearBest() {
    wx.showModal({
      title: '清除最高分',
      content: '清除后无法恢复，确定继续？',
      confirmText: '清除',
      success: (res) => {
        if (!res.confirm) return
        settings.clearBest()
        this.refresh()
        util.toast('已清除')
      }
    })
  },

  onAbout() {
    wx.showModal({
      title: '关于',
      content: `摸鱼小游戏 v${this.data.version}\n聊天贪吃蛇\n\n数据仅保存在本机，不收集任何个人信息。`,
      showCancel: false
    })
  },

  onFeedback() {
    wx.setClipboardData({
      data: '摸鱼小游戏 - 聊天贪吃蛇',
      success: () => util.toast('已复制，可粘贴反馈')
    })
  },

  onResetAll() {
    wx.showModal({
      title: '恢复默认设置',
      content: '将重置所有设置项（不影响最高分）',
      success: (res) => {
        if (!res.confirm) return
        settings.reset()
        this.refresh()
        util.toast('已恢复默认')
      }
    })
  },

  onBackHome() {
    wx.navigateBack({ delta: 2, fail: () => wx.navigateBack() })
  }
})
