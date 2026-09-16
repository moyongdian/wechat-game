# 原版 2.0 基线（Original Baseline 2.0）

- **提交**：`ee9aeeb4ffce247fe81e6c59a5000e738bb5bbd6`
- **日期**：2026-09-16
- **说明**：这是用户确认的「原版 2.0」。以后若要求「回到原版 2.0」，即回退到此版本。

## 与原版（1.0）的关系

原版为 `5d32a7e`（标签 `original-baseline`）。2.0 在 1.0 基础上包含：

- 多颗普通豆：每 3 秒生成一颗，场上最多同时 5 颗，被吃才消失
- 特殊豆：存活 8 秒后自动消失
- 红包特效：「红包来啦」在红包豆**出现**时提示（淡红 60rpx）；得分数字 130rpx 停留 2.4s
- 图层：假消息(2) < 豆子(3) < **蛇(4，最高)**，三层均为透明画布，背景由容器 CSS 提供

## 回退方法

```bash
git checkout ee9aeeb4ffce247fe81e6c59a5000e738bb5bbd6 -- .
```

## 校验

```bash
node tools/check.js        # 静态校验
node tools/test-engine.js  # 游戏内核单元测试
node tools/test-page.js    # 页面逻辑测试
```
