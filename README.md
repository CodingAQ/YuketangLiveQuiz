# YuketangLiveQuiz

长江雨课堂答题提醒油猴脚本 —— 当老师在雨课堂发起答题时，自动弹出包含**题目内容与选项**的悬浮卡片、发送浏览器通知并播放提示音，避免错过答题。

---

## 功能

- 🔔 **浏览器通知**：弹出系统级 Notification，包含题目摘要
- 🔊 **提示音**：连续三声蜂鸣（Web Audio API 合成，无需额外音频文件）
- 📋 **悬浮答题卡片**：右下角展示完整题目正文与 ABCD 选项，内置同步倒计时
- 🕵️ **精准检测**：拦截 XHR / Fetch / WebSocket，通过 `sendTime` 字段判断题目是否已发送，无误报
- 🔁 **去重机制**：同一题目只提醒一次，不重复打扰

## 安装方法

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)（支持 Chrome / Edge / Firefox）
2. 打开 Tampermonkey 管理面板 → **新建脚本**
3. 将 [`yuketang-quiz-alert.user.js`](./yuketang-quiz-alert.user.js) 的全部内容粘贴进去，保存
4. 打开雨课堂上课页面，脚本自动生效

> 也可以直接点击脚本文件的 **Raw** 按钮，Tampermonkey 会自动识别并提示安装。

## 适用域名

默认匹配以下地址（可在脚本 `@match` 处自行添加）：

- `*.yuketang.cn`
- `*.changjiang.yuketang.cn`

## 工作原理

脚本在页面加载时注入，拦截所有 `XMLHttpRequest`、`fetch` 和 `WebSocket` 消息，从响应 JSON 中搜索包含 `problemId` 的题目数组。当发现某道题的 `sendTime > 0`（即老师已发送该题）且该题尚未提醒过时，立即触发提醒。

```
网络响应 JSON
   └─ 题目数组 [ { problemId, sendTime, body, options, limit, ... } ]
                              │
                    sendTime > 0 且未提醒？
                              │ 是
              ┌───────────────┼──────────────────┐
         播放提示音      浏览器通知         右下角悬浮卡片
                                          （含倒计时 limit 秒）
```

## 配置项

脚本顶部 `CONFIG` 对象可按需修改：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `beep.frequency` | 提示音频率（Hz） | `880` |
| `beep.count` | 蜂鸣次数 | `3` |
| `beep.volume` | 音量（0~1） | `0.6` |
| `notificationTimeout` | 浏览器通知显示时长（ms） | `10000` |
| `autoCloseDelay` | 答题截止后卡片自动关闭延迟（ms） | `3000` |

## 注意事项

- 首次触发通知时，浏览器会请求「通知」权限，请点击**允许**
- 部分浏览器需手动与页面交互后才能播放声音（浏览器自动播放策略限制）
- 若雨课堂接口结构变更导致检测失效，欢迎在 Issue 中反馈
