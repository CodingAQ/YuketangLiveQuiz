// ==UserScript==
// @name         长江雨课堂答题提醒
// @namespace    https://github.com/CodingAQ/YuketangLiveQuiz
// @version      1.0.0
// @description  当老师发起答题时，自动弹出浏览器通知并播放提示音
// @author       CodingAQ
// @match        *://*.yuketang.cn/*
// @match        *://yuketang.cn/*
// @match        *://*.changjiang.yuketang.cn/*
// @match        *://changjiang.yuketang.cn/*
// @grant        GM_notification
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ── 配置项 ──────────────────────────────────────────────────────────────
    const CONFIG = {
        // 提示条显示时长（毫秒），设为 0 表示一直显示直到答题结束
        bannerDuration: 0,
        // 提示音频率（Hz）与时长（ms）
        beep: { frequency: 880, duration: 400, volume: 0.6, count: 3, interval: 500 },
        // 浏览器通知显示时长（毫秒）
        notificationTimeout: 8000,
        // 监测间隔（毫秒）—— 作为 MutationObserver 的兜底轮询
        pollInterval: 1000,
    };

    // ── 状态 ────────────────────────────────────────────────────────────────
    let lastQuizActive = false;
    let bannerEl = null;
    let bannerTimerEl = null;
    let countdownInterval = null;
    let audioCtx = null;

    // ── 工具函数 ─────────────────────────────────────────────────────────────

    /**
     * 获取 AudioContext（懒初始化，绕过浏览器自动播放策略）
     */
    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioCtx;
    }

    /**
     * 播放单个蜂鸣
     * @param {AudioContext} ctx
     * @param {number} freq 频率（Hz）
     * @param {number} duration 时长（ms）
     * @param {number} volume 音量 0~1
     * @param {number} startTime 相对于 ctx.currentTime 的开始时间（秒）
     */
    function scheduleBeep(ctx, freq, duration, volume, startTime) {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, startTime);
        gainNode.gain.setValueAtTime(volume, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration / 1000);
        oscillator.start(startTime);
        oscillator.stop(startTime + duration / 1000);
    }

    /**
     * 连续播放多声提示音
     */
    function playAlert() {
        try {
            const ctx = getAudioContext();
            const { frequency, duration, volume, count, interval } = CONFIG.beep;
            for (let i = 0; i < count; i++) {
                const startTime = ctx.currentTime + (i * (duration + interval)) / 1000;
                scheduleBeep(ctx, frequency, duration, volume, startTime);
            }
        } catch (e) {
            console.warn('[雨课堂提醒] 播放提示音失败：', e);
        }
    }

    /**
     * 发送浏览器通知
     * @param {string} title
     * @param {string} body
     */
    function sendNotification(title, body) {
        if (!('Notification' in window)) return;

        const doNotify = () => {
            // 优先使用 GM_notification（无需额外权限请求）
            if (typeof GM_notification === 'function') {
                GM_notification({ title, text: body, timeout: CONFIG.notificationTimeout });
            } else {
                new Notification(title, { body, icon: '' });
            }
        };

        if (Notification.permission === 'granted') {
            doNotify();
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') doNotify();
            });
        }
    }

    // ── 样式 ────────────────────────────────────────────────────────────────
    GM_addStyle(`
        #ykt-quiz-banner {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 2147483647;
            background: linear-gradient(90deg, #e74c3c, #c0392b);
            color: #fff;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            padding: 10px 16px;
            box-shadow: 0 3px 12px rgba(0,0,0,0.35);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            animation: ykt-slidein 0.3s ease;
            font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        @keyframes ykt-slidein {
            from { transform: translateY(-100%); opacity: 0; }
            to   { transform: translateY(0);     opacity: 1; }
        }
        #ykt-quiz-banner .ykt-icon { font-size: 22px; }
        #ykt-quiz-banner .ykt-timer {
            background: rgba(255,255,255,0.25);
            border-radius: 6px;
            padding: 2px 10px;
            font-size: 15px;
            min-width: 80px;
        }
        #ykt-quiz-banner .ykt-close {
            cursor: pointer;
            background: rgba(255,255,255,0.2);
            border: none;
            color: #fff;
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 14px;
            margin-left: 8px;
        }
        #ykt-quiz-banner .ykt-close:hover { background: rgba(255,255,255,0.35); }
    `);

    // ── 提示条 ───────────────────────────────────────────────────────────────

    /**
     * 从页面倒计时元素中读取剩余秒数
     * @returns {number|null}
     */
    function readCountdownSeconds() {
        // 常见选择器，按实际页面 DOM 调整
        const selectors = [
            '.countdown',
            '[class*="countdown"]',
            '[class*="count-down"]',
            '[class*="countDown"]',
            '[class*="timer"]',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const text = el.textContent.trim();
            // 匹配 "00:22" 或 "22" 格式
            const mmss = text.match(/(\d{1,2}):(\d{2})/);
            if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
            const ss = text.match(/^(\d+)$/);
            if (ss) return parseInt(ss[1], 10);
        }
        return null;
    }

    function showBanner(quizType) {
        if (bannerEl) return; // 已显示

        bannerEl = document.createElement('div');
        bannerEl.id = 'ykt-quiz-banner';

        const icon = document.createElement('span');
        icon.className = 'ykt-icon';
        icon.textContent = '🔔';

        const msg = document.createElement('span');
        msg.textContent = `老师发起了${quizType ? '【' + quizType + '】' : ''}答题，请尽快作答！`;

        bannerTimerEl = document.createElement('span');
        bannerTimerEl.className = 'ykt-timer';
        bannerTimerEl.textContent = '⏱ --';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ykt-close';
        closeBtn.textContent = '×';
        closeBtn.title = '关闭提示';
        closeBtn.addEventListener('click', hideBanner);

        bannerEl.appendChild(icon);
        bannerEl.appendChild(msg);
        bannerEl.appendChild(bannerTimerEl);
        bannerEl.appendChild(closeBtn);
        document.body.appendChild(bannerEl);

        // 同步倒计时
        countdownInterval = setInterval(() => {
            const secs = readCountdownSeconds();
            if (bannerTimerEl) {
                bannerTimerEl.textContent = secs !== null
                    ? `⏱ ${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
                    : '⏱ --';
            }
        }, 500);

        // 如果配置了自动隐藏时长
        if (CONFIG.bannerDuration > 0) {
            setTimeout(hideBanner, CONFIG.bannerDuration);
        }
    }

    function hideBanner() {
        if (bannerEl) {
            bannerEl.remove();
            bannerEl = null;
            bannerTimerEl = null;
        }
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }

    // ── 答题检测 ─────────────────────────────────────────────────────────────

    /**
     * 检测答题弹层是否已出现，并返回题目类型（如"多选题"）
     * @returns {{ active: boolean, quizType: string }}
     */
    function detectQuiz() {
        // 策略 1：根据"提交答案"按钮判断
        const submitBtns = document.querySelectorAll('button, [role="button"]');
        for (const btn of submitBtns) {
            if (btn.textContent.includes('提交答案') || btn.textContent.includes('提交')) {
                // 找题目类型
                const quizType = extractQuizType();
                return { active: true, quizType };
            }
        }

        // 策略 2：根据倒计时 + 答题相关词汇判断
        const body = document.body.textContent;
        const hasCountdown = /倒计时/.test(body);
        const hasQuizKeyword = /单选题|多选题|填空题|判断题|投票/.test(body);
        if (hasCountdown && hasQuizKeyword) {
            return { active: true, quizType: extractQuizType() };
        }

        return { active: false, quizType: '' };
    }

    /**
     * 从页面中提取题目类型文字
     * @returns {string}
     */
    function extractQuizType() {
        const keywords = ['单选题', '多选题', '填空题', '判断题', '投票'];
        // 遍历文字节点找到第一个匹配
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            for (const kw of keywords) {
                if (node.textContent.includes(kw)) return kw;
            }
        }
        return '';
    }

    /**
     * 当检测到答题开始时调用
     */
    function onQuizStart(quizType) {
        console.info(`[雨课堂提醒] 检测到答题：${quizType || '未知类型'}`);
        playAlert();
        sendNotification(
            '📢 雨课堂答题提醒',
            `老师发起了${quizType ? '【' + quizType + '】' : ''}答题，请尽快作答！`
        );
        showBanner(quizType);
    }

    /**
     * 当检测到答题结束时调用
     */
    function onQuizEnd() {
        console.info('[雨课堂提醒] 答题已结束，隐藏提示条');
        hideBanner();
    }

    // ── 主循环（MutationObserver + 兜底轮询）────────────────────────────────

    function checkState() {
        const { active, quizType } = detectQuiz();
        if (active && !lastQuizActive) {
            lastQuizActive = true;
            onQuizStart(quizType);
        } else if (!active && lastQuizActive) {
            lastQuizActive = false;
            onQuizEnd();
        }
    }

    // MutationObserver：DOM 变化时立即检测
    const observer = new MutationObserver(() => checkState());
    observer.observe(document.body, { childList: true, subtree: true, attributes: false });

    // 兜底轮询：防止 MutationObserver 遗漏某些动态更新场景
    setInterval(checkState, CONFIG.pollInterval);

    // 初始检测
    checkState();

    console.info('[雨课堂提醒] 脚本已启动，正在监听答题...');
})();
