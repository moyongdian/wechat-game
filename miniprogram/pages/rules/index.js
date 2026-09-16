/**
 * 游戏规则页（设置 → 游戏规则）
 * 展示各模式规则、道具、障碍物与计分规则。
 * 内容以数据驱动，便于维护与测试。
 */
const RULES = [
  {
    key: 'classic',
    name: '经典模式',
    scene: '标准玩法',
    lines: [
      '撞墙死亡，撞到自己死亡',
      '吃豆加分、蛇身加长',
      '速度随分数提升'
    ]
  },
  {
    key: 'wrap',
    name: '穿墙模式',
    scene: '轻松休闲',
    lines: [
      '左右边界互通，上下边界互通',
      '穿墙不会死亡，只有撞到自己才会结束',
      '速度随分数提升'
    ]
  },
  {
    key: 'timed',
    name: '限时模式',
    scene: '快速一局',
    lines: [
      '默认 60 秒，时间到自动结算',
      '撞墙或撞自己会提前结束',
      '速度固定，不随分数变化'
    ]
  },
  {
    key: 'obstacle',
    name: '障碍模式',
    scene: '增加挑战',
    lines: [
      '地图上随机出现聊天障碍物',
      '障碍物数量随分数增加',
      '撞到致命障碍会直接死亡'
    ]
  },
  {
    key: 'endless',
    name: '无尽模式',
    scene: '挑战极限',
    lines: [
      '速度持续加快，没有速度上限',
      '同时会出现障碍物',
      '坚持越久得分越高'
    ]
  },
  {
    key: 'moyu',
    name: '摸鱼模式',
    scene: '上班摸鱼',
    lines: [
      '蛇自动寻找豆子吃，无需操作',
      '速度约为常规的 2 倍',
      '适合挂着刷分、腾出手做别的事'
    ]
  }
]

const ITEMS = [
  { name: '金豆', effect: '+5 分' },
  { name: '双倍豆', effect: '20 秒内吃豆得分翻倍' },
  { name: '减速豆', effect: '+3 分，8 秒内移动变慢' },
  { name: '磁铁豆', effect: '+3 分，15 秒内自动吸附附近豆子' },
  { name: '红包', effect: '+10~50 随机分，屏幕弹出提示' },
  { name: '炸弹豆', effect: '+3 分，清除周围障碍物' },
  { name: '文件', effect: '+3 分，蛇身 +2 节，短暂减速' },
  { name: '语音', effect: '+3 分，加速 3 秒' },
  { name: '表情', effect: '+3 分，随机效果：加分 / 减速 / 清障' },
  { name: '撤回', effect: '+3 分，清除全部障碍' }
]

const OBSTACLES = [
  { name: '已读不回', effect: '静止，撞到死亡' },
  { name: '正在输入', effect: '横向或纵向移动，撞到 -5 分并消失' },
  { name: '文件传输', effect: '长条文件，无法通行' },
  { name: '表情包', effect: '撞到 -10 分并消失' },
  { name: '免打扰', effect: '减速区域' }
]

const SCORING = [
  '普通豆每 3 秒生成一颗，场上最多同时 5 颗，被吃掉才消失',
  '特殊豆随机出现，出现后 8 秒未被吃掉会自动消失',
  '分数达到 20 / 40 / 60 / 100 进入新阶段，之后每 +100 分再进一阶',
  '每个阶段：吃豆得分倍数 +1（20 分后 ×2、40 分后 ×3，依次类推），同时蛇速提升',
  '关卡越高，障碍物数量越多',
  '最高分按模式分别保存'
]

Page({
  data: {
    statusBarHeight: 20,
    navHeight: 44,
    safeBottom: 0,
    rules: RULES,
    items: ITEMS,
    obstacles: OBSTACLES,
    scoring: SCORING,
    activeMode: ''      // 从设置页指定模式进入时高亮
  },

  onLoad(options) {
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
    if (options && options.mode) {
      this.setData({ activeMode: options.mode })
      wx.setNavigationBarTitle({ title: '游戏规则' })
    }
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.navigateBack({ delta: 1 }) })
  },

  /** 点击模式卡片：仅做高亮，不跳转 */
  onTapMode(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeMode: this.data.activeMode === key ? '' : key })
  }
})
