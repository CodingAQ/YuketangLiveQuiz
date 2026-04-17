# YuketangLiveQuiz

长江雨课堂答题提醒油猴脚本 —— 当老师在雨课堂发起答题时，自动弹出浏览器通知并播放提示音，避免错过答题。

---

## 功能

- 🔔 **浏览器通知**：弹出系统级 Notification 提示
- 🔊 **提示音**：连续三声蜂鸣（Web Audio API 合成，无需音频文件）
- 📢 **页面悬浮提示条**：顶部红色横幅，同步显示答题倒计时
- 🕵️ **自动检测**：通过 MutationObserver 实时监听 DOM，无需手动刷新

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

## 配置项

脚本顶部 `CONFIG` 对象可按需修改：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `bannerDuration` | 提示条自动关闭时长（ms），`0` = 手动关闭 | `0` |
| `beep.frequency` | 提示音频率（Hz） | `880` |
| `beep.count` | 蜂鸣次数 | `3` |
| `beep.volume` | 音量（0~1） | `0.6` |
| `notificationTimeout` | 浏览器通知显示时长（ms） | `8000` |

## 注意事项

- 首次触发通知时，浏览器会请求「通知」权限，请点击**允许**
- 部分浏览器需手动点击页面后才能播放声音（浏览器自动播放策略），页面顶部会出现"点击此处允许播放提醒音"的提示
- 若雨课堂页面结构更新导致检测失效，可在 Issue 中反馈