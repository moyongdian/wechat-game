const settings = require('./utils/settings')

App({
  globalData: {
    // 系统信息（状态栏高度、安全区等），供自定义导航栏适配
    statusBarHeight: 20,
    safeBottom: 0,
    menuButton: null
  },

  onLaunch() {
    this.initSystemInfo()
    // 设置项兜底初始化：首次启动写入默认值
    settings.ensureDefaults()
  },

  /** 读取设备信息，计算自定义顶部栏与底部安全区 */
  initSystemInfo() {
    let info = {}
    try {
      info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    } catch (e) {
      info = wx.getSystemInfoSync()
    }
    const statusBarHeight = info.statusBarHeight || 20
    const safeArea = info.safeArea || {}
    const screenHeight = info.screenHeight || 0
    const safeBottom = safeArea.bottom && screenHeight
      ? Math.max(0, screenHeight - safeArea.bottom)
      : 0

    let menuButton = null
    try {
      menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    } catch (e) {
      menuButton = null
    }

    this.globalData.statusBarHeight = statusBarHeight
    this.globalData.safeBottom = safeBottom
    this.globalData.menuButton = menuButton
  }
})
