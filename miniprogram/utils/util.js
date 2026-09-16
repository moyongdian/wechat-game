/** 通用工具 */
const settings = require('./settings')

/** rpx → px（Canvas 绘制需要像素单位） */
function rpx2px(rpx) {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    return (rpx * (info.windowWidth || 375)) / 750
  } catch (e) {
    return (rpx * 375) / 750
  }
}

/** 档位 → 基础移动间隔 */
function baseInterval(speed) {
  return settings.SPEED_MAP[speed] || settings.SPEED_MAP.mid
}

/**
 * 随分数加速：每吃 5 分减少一档间隔，最低 70ms（说明书 §6 经典/穿墙：速度随分数增加逐渐加快）
 */
function tickInterval(speed, score, mode) {
  const base = baseInterval(speed)
  if (mode === 'timed') return base // 限时模式固定速度
  const step = Math.floor(Number(score || 0) / 5) * 12
  return Math.max(70, base - step)
}

/** 安全震动 */
function vibrate(on) {
  if (!on) return
  try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
}

/** 安全音效（默认关闭，避免暴露） */
function beep(on) {
  if (!on) return
  try {
    const ctx = wx.createInnerAudioContext()
    ctx.src = '' // 未内置音频资源时不播放，保留接口
    ctx.destroy && ctx.destroy()
  } catch (e) {}
}

function toast(title) {
  wx.showToast({ title: title || '功能开发中', icon: 'none' })
}

module.exports = { rpx2px, baseInterval, tickInterval, vibrate, beep, toast }
