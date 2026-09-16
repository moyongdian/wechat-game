/**
 * 设置项读写（说明书 §7 / §11）
 * 全部保存在本地：wx.setStorageSync，无需登录、不收集隐私。
 */
const KEY = 'moyu_settings_v1'
const BEST_KEY = 'moyu_best_v1'

/** 默认设置（说明书 §7.1） */
const DEFAULTS = {
  chatName: '贪吃蛇',      // 聊天对象名称，1-20 字符，首页与游戏页同步
  mode: 'classic',         // classic 经典 / wrap 穿墙 / timed 限时
  speed: 'mid',            // slow / mid / fast
  sound: false,            // 音效，默认关
  vibrate: true,           // 震动
  bossKey: true,           // 老板键（双击消息区伪装）
  fakeMsg: true,           // 假消息
  fakeMsgRate: 'low',      // low / mid / high
  background: 'default',   // default / 自定义图片路径
  specialFood: true,       // 特殊豆开关
  timedSeconds: 60         // 限时模式默认 60 秒
}

/** 速度档位 → 每格移动间隔（毫秒），随分数递减见 game.js */
const SPEED_MAP = { slow: 280, mid: 160, fast: 110 }

function readAll() {
  try {
    const raw = wx.getStorageSync(KEY)
    if (raw && typeof raw === 'object') return Object.assign({}, DEFAULTS, raw)
  } catch (e) {}
  return Object.assign({}, DEFAULTS)
}

function writeAll(obj) {
  try {
    wx.setStorageSync(KEY, obj || {})
    return true
  } catch (e) {
    wx.showToast({ title: '保存失败', icon: 'none' })
    return false
  }
}

/** 首次启动写入默认值 */
function ensureDefaults() {
  try {
    if (!wx.getStorageSync(KEY)) writeAll(DEFAULTS)
  } catch (e) {}
}

function get(key) {
  const all = readAll()
  return key ? all[key] : all
}

function set(key, value) {
  const all = readAll()
  all[key] = value
  return writeAll(all)
}

function setMany(patch) {
  const all = readAll()
  Object.assign(all, patch || {})
  return writeAll(all)
}

function reset() {
  return writeAll(DEFAULTS)
}

/** 聊天对象名称：1-20 字符，超长截断 */
function normalizeChatName(name) {
  const s = String(name == null ? '' : name).trim()
  if (!s) return DEFAULTS.chatName
  return s.slice(0, 20)
}

/* ---------------- 最高分（按模式分别记录） ---------------- */
function readBest() {
  try {
    const raw = wx.getStorageSync(BEST_KEY)
    if (raw && typeof raw === 'object') return raw
  } catch (e) {}
  return {}
}

function getBest(mode) {
  const all = readBest()
  return Number(all[mode] || 0)
}

/** 返回是否刷新了最高分 */
function setBest(mode, score) {
  const all = readBest()
  const cur = Number(all[mode] || 0)
  if (Number(score) > cur) {
    all[mode] = Number(score)
    try { wx.setStorageSync(BEST_KEY, all) } catch (e) { return false }
    return true
  }
  return false
}

function clearBest() {
  try {
    wx.removeStorageSync(BEST_KEY)
    return true
  } catch (e) {
    return false
  }
}

module.exports = {
  KEY, BEST_KEY, DEFAULTS, SPEED_MAP,
  ensureDefaults, get, set, setMany, reset, readAll,
  normalizeChatName,
  getBest, setBest, clearBest
}
