/**
 * 首页：类微信首页（说明书 §4）
 * 聊天列表里的“用户”其实都是小游戏名称；点击“贪吃蛇”进入游戏页。
 * 按说明书 §14 合规要求，这里是原创的“类微信风格”，不使用微信官方素材。
 */
const settings = require('../../utils/settings')
const fake = require('../../utils/fake')
const util = require('../../utils/util')

/** 列表项定义：名称来自设置（可被长按改名覆盖） */
const BASE_ITEMS = [
  { id: 'snake',  kind: 'game',     nameKey: 'chatName', fallback: '贪吃蛇', avatar: '/images/avatar-snake.png',  msg: '点击开始', time: '刚刚' },
  { id: '2048',   kind: 'soon',     name: '2048',       avatar: '/images/avatar-2048.png',   msg: '敬请期待', time: '昨天' },
  { id: 'mine',   kind: 'soon',     name: '扫雷',       avatar: '/images/avatar-mine.png',   msg: '敬请期待', time: '昨天' },
  { id: 'plane',  kind: 'soon',     name: '飞机大战',   avatar: '/images/avatar-plane.png',  msg: '敬请期待', time: '周日' },
  { id: 'setting',kind: 'settings', name: '设置',       avatar: '/images/avatar-set.png',    msg: '版本信息', time: '周一' }
]

const NAME_OVERRIDE_KEY = 'moyu_name_override'

Page({
  data: {
    statusBarHeight: 20,
    navHeight: 44,
    safeBottom: 0,
    unreadTotal: 0,
    activeTab: 'wechat',
    tabs: [
      { key: 'wechat',    text: '微信',   icon: '' },
      { key: 'contacts',  text: '通讯录', icon: '/images/tab-contacts.png' },
      { key: 'discover',  text: '发现',   icon: '/images/tab-discover.png' },
      { key: 'me',        text: '我',     icon: '/images/tab-me.png' }
    ],
    list: []
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      safeBottom: app.globalData.safeBottom
    })
    // 计算顶部栏高度：状态栏 + 与胶囊按钮对齐
    const mb = app.globalData.menuButton
    if (mb && mb.top) {
      const navHeight = (mb.top - app.globalData.statusBarHeight) * 2 + mb.height
      this.setData({ navHeight: navHeight > 0 ? navHeight : 44 })
    }
  },

  onShow() {
    this.buildList()
  },

  onPullDownRefresh() {
    // 下拉刷新：随机更新假消息，增强伪装（说明书 §4.3）
    this.buildList(true)
    wx.stopPullDownRefresh()
  },

  /** 组装聊天列表 */
  buildList(shuffle) {
    const s = settings.get()
    const overrides = this.readOverrides()
    let unread = 0

    const list = BASE_ITEMS.map((it, i) => {
      // 名称优先级：用户长按改名 > 设置中的聊天对象名称 > 默认名
      let name = it.name
      if (it.nameKey === 'chatName') name = settings.normalizeChatName(s.chatName)
      if (overrides[it.id]) name = overrides[it.id]

      let msg = it.msg
      if (shuffle && it.kind === 'game') msg = fake.randomListMsg()
      if (shuffle && it.kind === 'soon') msg = fake.randomListMsg()

      const time = shuffle ? fake.fakeTime(Math.floor(Math.random() * 5)) : it.time
      const candidate = { id: it.id, kind: it.kind, name, avatar: it.avatar, msg, time, unread: 0 }

      // 未读红点：贪吃蛇默认 1 条，点击后消失（说明书 §4.2）
      if (it.kind === 'game' && !this.consumed) {
        candidate.unread = 1
        unread += 1
      }
      return candidate
    })

    this.setData({ list, unreadTotal: unread })
  },

  readOverrides() {
    try {
      const v = wx.getStorageSync(NAME_OVERRIDE_KEY)
      return v && typeof v === 'object' ? v : {}
    } catch (e) { return {} }
  },

  writeOverride(id, name) {
    const all = this.readOverrides()
    all[id] = name
    try { wx.setStorageSync(NAME_OVERRIDE_KEY, all) } catch (e) {}
  },

  /** 点击列表项 */
  onTapItem(e) {
    const item = e.currentTarget.dataset.item
    if (!item) return
    // 点击后清除红点（本会话内）
    this.consumed = true

    if (item.kind === 'game') {
      wx.navigateTo({ url: '/pages/game/snake/index' })
      return
    }
    if (item.kind === 'settings') {
      wx.navigateTo({ url: '/pages/settings/index' })
      return
    }
    util.toast('功能开发中')
  },

  /** 长按改名（说明书 §4.3，V1.1） */
  onLongPressItem(e) {
    const item = e.currentTarget.dataset.item
    if (!item || item.kind !== 'game') return
    wx.showModal({
      title: '修改显示名称',
      editable: true,
      placeholderText: '1-20 个字符，如：张总',
      content: item.name,
      success: (res) => {
        if (!res.confirm) return
        const name = settings.normalizeChatName(res.content)
        this.writeOverride(item.id, name)
        // 同步到设置，保证游戏页顶部名称一致（说明书 §4.4）
        settings.set('chatName', name)
        this.buildList()
        util.toast('已更新')
      }
    })
  },

  onSearch() { util.toast('搜索功能开发中') },
  onAdd() { util.toast('功能开发中') },

  onTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'wechat') { this.setData({ activeTab: key }); return }
    util.toast('功能开发中')
  },

  onShareAppMessage() {
    return { title: '聊天', path: '/pages/index/index' }
  }
})
