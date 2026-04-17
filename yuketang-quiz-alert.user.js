// ==UserScript==
// @name         长江雨课堂答题提醒
// @namespace    https://github.com/CodingAQ/YuketangLiveQuiz
// @version      2.0.0
// @description  拦截雨课堂网络请求，当老师发起答题时弹出通知、播放提示音并展示题目内容
// @author       CodingAQ
// @match        *://*.yuketang.cn/*
// @match        *://yuketang.cn/*
// @match        *://*.changjiang.yuketang.cn/*
// @match        *://changjiang.yuketang.cn/*
// @grant        GM_notification
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ── 配置项 ──────────────────────────────────────────────────────────────
    const CONFIG = {
        // 提示音：频率(Hz)、单次时长(ms)、音量(0~1)、次数、间隔(ms)
        beep: { frequency: 880, duration: 400, volume: 0.6, count: 3, interval: 500 },
        // 浏览器通知显示时长（毫秒）
        notificationTimeout: 10000,
        // 答题时间结束后，悬浮卡片自动关闭的延迟（毫秒）
        autoCloseDelay: 3000,
    };

    // ── 题目类型映射 ─────────────────────────────────────────────────────────
    // problemType 字段的含义（根据实际数据推断，可按需补充）
    const PROBLEM_TYPE = {
        1: '单选题',
        2: '多选题',
        3: '填空题',
        4: '判断题',
        5: '投票题',
    };

    // ── 状态 ─────────────────────────────────────────────────────────────────
    // 已提醒过的题目 ID 集合，避免重复提醒
    const alertedIds = new Set();
    // 当前正在展示的提示卡片（每次只展示一题）
    let cardEl = null;
    let countdownInterval = null;
    let audioCtx = null;

    // ── 音频 ─────────────────────────────────────────────────────────────────

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioCtx;
    }

    function scheduleBeep(ctx, freq, duration, volume, startTime) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration / 1000);
        osc.start(startTime);
        osc.stop(startTime + duration / 1000);
    }

    function playAlert() {
        try {
            const ctx = getAudioContext();
            const { frequency, duration, volume, count, interval } = CONFIG.beep;
            for (let i = 0; i < count; i++) {
                scheduleBeep(ctx, frequency, duration, volume,
                    ctx.currentTime + i * (duration + interval) / 1000);
            }
        } catch (e) {
            console.warn('[雨课堂提醒] 播放提示音失败：', e);
        }
    }

    // ── 通知 ─────────────────────────────────────────────────────────────────

    function sendNotification(title, body) {
        if (!('Notification' in window)) return;
        const doNotify = () => {
            if (typeof GM_notification === 'function') {
                GM_notification({ title, text: body, timeout: CONFIG.notificationTimeout });
            } else {
                new Notification(title, { body });
            }
        };
        if (Notification.permission === 'granted') {
            doNotify();
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(p => { if (p === 'granted') doNotify(); });
        }
    }

    // ── 样式 ─────────────────────────────────────────────────────────────────

    GM_addStyle(`
        #ykt-quiz-card {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 2147483647;
            width: 360px;
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.22);
            font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
            font-size: 14px;
            color: #222;
            overflow: hidden;
            animation: ykt-fadein 0.35s cubic-bezier(.4,0,.2,1);
        }
        @keyframes ykt-fadein {
            from { opacity: 0; transform: translateY(20px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        #ykt-quiz-card .ykt-header {
            background: linear-gradient(90deg, #e74c3c, #c0392b);
            color: #fff;
            padding: 10px 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        #ykt-quiz-card .ykt-header-left {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: bold;
            font-size: 15px;
        }
        #ykt-quiz-card .ykt-badge {
            background: rgba(255,255,255,0.25);
            border-radius: 4px;
            padding: 1px 7px;
            font-size: 12px;
            font-weight: normal;
        }
        #ykt-quiz-card .ykt-timer {
            background: rgba(0,0,0,0.18);
            border-radius: 5px;
            padding: 2px 9px;
            font-size: 13px;
            font-weight: bold;
            min-width: 56px;
            text-align: center;
        }
        #ykt-quiz-card .ykt-timer.urgent { background: rgba(255,200,0,0.45); }
        #ykt-quiz-card .ykt-close {
            cursor: pointer;
            background: none;
            border: none;
            color: rgba(255,255,255,0.85);
            font-size: 18px;
            line-height: 1;
            padding: 0 0 0 8px;
        }
        #ykt-quiz-card .ykt-close:hover { color: #fff; }
        #ykt-quiz-card .ykt-body {
            padding: 12px 14px 4px;
            line-height: 1.6;
            font-size: 14px;
            border-bottom: 1px solid #f0f0f0;
            max-height: 80px;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
        }
        #ykt-quiz-card .ykt-options {
            padding: 8px 14px 12px;
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        #ykt-quiz-card .ykt-option {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            font-size: 13px;
            line-height: 1.5;
        }
        #ykt-quiz-card .ykt-option-key {
            flex-shrink: 0;
            width: 22px;
            height: 22px;
            border-radius: 4px;
            background: #e8e8e8;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 12px;
            color: #444;
        }
        #ykt-quiz-card .ykt-footer {
            padding: 6px 14px 10px;
            font-size: 12px;
            color: #999;
            border-top: 1px solid #f5f5f5;
        }
    `);

    // ── 提示卡片 ──────────────────────────────────────────────────────────────

    /**
     * @param {object} problem  - 单个题目数据对象
     */
    function showCard(problem) {
        hideCard();

        const typeName = PROBLEM_TYPE[problem.problemType] || '答题';
        const limitSecs = problem.limit > 0 ? problem.limit : null;
        // 计算答题截止时间（sendTime 单位为毫秒）
        const deadline = limitSecs ? problem.sendTime + limitSecs * 1000 : null;

        cardEl = document.createElement('div');
        cardEl.id = 'ykt-quiz-card';

        // ── 头部
        const header = document.createElement('div');
        header.className = 'ykt-header';

        const headerLeft = document.createElement('div');
        headerLeft.className = 'ykt-header-left';
        headerLeft.innerHTML = `🔔 答题提醒 <span class="ykt-badge">${typeName}</span>`;

        const timerEl = document.createElement('span');
        timerEl.className = 'ykt-timer';
        timerEl.textContent = limitSecs ? formatTime(limitSecs) : '--';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ykt-close';
        closeBtn.textContent = '×';
        closeBtn.title = '关闭';
        closeBtn.addEventListener('click', hideCard);

        header.appendChild(headerLeft);
        header.appendChild(timerEl);
        header.appendChild(closeBtn);

        // ── 题目正文
        const bodyEl = document.createElement('div');
        bodyEl.className = 'ykt-body';
        bodyEl.textContent = problem.body;

        // ── 选项列表
        const optionsEl = document.createElement('div');
        optionsEl.className = 'ykt-options';
        if (Array.isArray(problem.options)) {
            problem.options.forEach(opt => {
                const row = document.createElement('div');
                row.className = 'ykt-option';
                row.innerHTML = `<span class="ykt-option-key">${opt.key}</span><span>${opt.value}</span>`;
                optionsEl.appendChild(row);
            });
        }

        // ── 底部提示
        const footer = document.createElement('div');
        footer.className = 'ykt-footer';
        footer.textContent = '请前往雨课堂页面完成答题';

        cardEl.appendChild(header);
        cardEl.appendChild(bodyEl);
        cardEl.appendChild(optionsEl);
        cardEl.appendChild(footer);
        document.body.appendChild(cardEl);

        // 倒计时驱动
        if (deadline) {
            countdownInterval = setInterval(() => {
                const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
                timerEl.textContent = formatTime(remaining);
                timerEl.classList.toggle('urgent', remaining <= 10);
                if (remaining === 0) {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                    // 答题时间到，延迟后自动关闭卡片
                    setTimeout(hideCard, CONFIG.autoCloseDelay);
                }
            }, 500);
        }
    }

    function hideCard() {
        if (cardEl) { cardEl.remove(); cardEl = null; }
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    }

    function formatTime(secs) {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // ── 题目处理入口 ──────────────────────────────────────────────────────────

    /**
     * 处理从网络响应中解析出的题目数组
     * @param {any[]} problems
     */
    function handleProblems(problems) {
        if (!Array.isArray(problems)) return;

        problems.forEach(problem => {
            // 只处理 sendTime > 0（已发送）且未提醒过的题目
            if (!problem || !problem.problemId) return;
            if (!problem.sendTime || problem.sendTime === 0) return;
            if (alertedIds.has(problem.problemId)) return;

            alertedIds.add(problem.problemId);
            console.info(`[雨课堂提醒] 检测到新题目：${problem.body}`);

            playAlert();
            sendNotification(
                `📢 雨课堂${PROBLEM_TYPE[problem.problemType] || '答题'}提醒`,
                `${problem.body}\n${(problem.options || []).map(o => `${o.key}. ${o.value}`).join('  ')}`
            );
            showCard(problem);
        });
    }

    /**
     * 尝试从任意 JSON 数据中提取题目数组
     * @param {any} data
     */
    function extractProblems(data) {
        if (!data) return;

        // 直接是数组，且第一项包含 problemId
        if (Array.isArray(data) && data.length > 0 && data[0].problemId) {
            handleProblems(data);
            return;
        }

        // 是对象，递归找 problemId / problems 字段
        if (typeof data === 'object') {
            // 常见包装结构: { data: [...] } / { problems: [...] } / { result: [...] }
            for (const key of ['data', 'problems', 'result', 'list', 'items', 'questions']) {
                if (Array.isArray(data[key])) {
                    handleProblems(data[key]);
                }
            }
        }
    }

    /**
     * 安全解析 JSON 字符串
     * @param {string} text
     * @returns {any|null}
     */
    function safeParseJSON(text) {
        if (typeof text !== 'string' || !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
            return null;
        }
        try { return JSON.parse(text); } catch { return null; }
    }

    // ── 拦截 XMLHttpRequest ───────────────────────────────────────────────────

    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR() {
        const xhr = new OrigXHR();
        const origOpen = xhr.open.bind(xhr);

        xhr.open = function (...args) {
            xhr.addEventListener('load', function () {
                const data = safeParseJSON(xhr.responseText);
                if (data) extractProblems(data);
            });
            return origOpen(...args);
        };

        return xhr;
    }
    // 复制静态属性，确保 instanceof 检查等不受影响
    Object.setPrototypeOf(PatchedXHR, OrigXHR);
    Object.setPrototypeOf(PatchedXHR.prototype, OrigXHR.prototype);
    window.XMLHttpRequest = PatchedXHR;

    // ── 拦截 Fetch ───────────────────────────────────────────────────────────

    const origFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const response = await origFetch(...args);
        // clone() 让原始响应流不被消耗
        const clone = response.clone();
        clone.text().then(text => {
            const data = safeParseJSON(text);
            if (data) extractProblems(data);
        }).catch(() => {});
        return response;
    };

    // ── 拦截 WebSocket ───────────────────────────────────────────────────────

    const OrigWS = window.WebSocket;
    class PatchedWebSocket extends OrigWS {
        constructor(...args) {
            super(...args);
            this.addEventListener('message', event => {
                const data = safeParseJSON(event.data);
                if (data) extractProblems(data);
            });
        }
    }
    window.WebSocket = PatchedWebSocket;

    console.info('[雨课堂提醒] 脚本已启动，正在拦截网络请求以监听答题...');
})();
