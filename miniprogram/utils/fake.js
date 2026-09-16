/**
 * 假消息与伪装文案（说明书 §9）
 * 用于聊天列表的“最后一条消息”、消息区装饰气泡、伪装提示。
 */

/** 聊天列表项的伪装最后一条消息 */
const LIST_MSG = [
  '好的', '收到', '这个我看一下', '晚点回复你', '在忙，稍后说',
  '嗯嗯', '明白', '已阅', '辛苦了', '[草稿]', '哈哈', '回头聊'
]

/** 消息区装饰气泡（透明度低，不影响游戏） */
const BUBBLES = [
  '收到', '好的', '这个我看一下', '晚点回复你', '在开会', '稍等',
  '嗯嗯', '明白', '辛苦了', '先这样', '我看看', '回头说'
]

/** 游戏结束弹窗伪装文案（说明书 §6.1） */
const FAIL_TITLES = ['消息发送失败', '网络异常', '消息已过期']

/** 退出确认框伪装文案（说明书 §8.1） */
const EXIT_TEXTS = ['确定删除该聊天？', '删除后聊天记录不可恢复']

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** 随机假消息；rate 控制频率（low/mid/high） */
function randomBubble(rate) {
  const p = rate === 'high' ? 0.5 : rate === 'mid' ? 0.3 : 0.15
  if (Math.random() > p) return null
  return pick(BUBBLES)
}

function randomListMsg() {
  return pick(LIST_MSG)
}

/** 相对时间文案：刚刚 / 昨天 / 周一 */
function fakeTime(i) {
  const arr = ['刚刚', '昨天', '周一', '周二', '周日']
  return arr[i % arr.length]
}

module.exports = {
  LIST_MSG, BUBBLES, FAIL_TITLES, EXIT_TEXTS,
  pick, randomBubble, randomListMsg, fakeTime
}
