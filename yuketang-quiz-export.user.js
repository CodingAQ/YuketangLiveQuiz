// ==UserScript==
// @name         长江雨课堂题目数据导出
// @namespace    https://github.com/CodingAQ/YuketangLiveQuiz
// @version      1.0.0
// @description  自动收集整堂课的题目原始数据（含选项、答案、解析等），一键导出为 JSON 文件
// @author       CodingAQ
// @match        *://*.yuketang.cn/*
// @match        *://yuketang.cn/*
// @match        *://*.changjiang.yuketang.cn/*
// @match        *://changjiang.yuketang.cn/*
// @grant        GM_addStyle
// @grant        GM_download
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ── 已收集的题目 Map，key = problemId ────────────────────────────────────
    // 使用 Map 而非 Array，保证同一道题只保留最新版本（sendTime 更大或字段更完整的版本）
    const problemMap = new Map();

    // ── 工具：合并新旧题目对象（以 sendTime 较大者优先，但始终保留已有答案）───
    function mergeProblem(existing, incoming) {
        // 合并答案：优先保留非空的那一份；如果两者都有答案，取较新版本（sendTime 较大）的答案
        const existingAnswers = existing.answers || [];
        const incomingAnswers = incoming.answers || [];
        let answers;
        if (existingAnswers.length > 0 && incomingAnswers.length === 0) {
            answers = existingAnswers;
        } else if (incomingAnswers.length > 0 && existingAnswers.length === 0) {
            answers = incomingAnswers;
        } else if (existingAnswers.length > 0 && incomingAnswers.length > 0) {
            answers = (incoming.sendTime >= (existing.sendTime || 0)) ? incomingAnswers : existingAnswers;
        } else {
            answers = [];
        }
        // 取 sendTime 更大的版本作为基础（老师推送时才有非零 sendTime）
        const base = (incoming.sendTime > (existing.sendTime || 0)) ? incoming : existing;
        return Object.assign({}, base, { answers });
    }

    // ── 提取并存储题目 ────────────────────────────────────────────────────────

    /**
     * 从任意解析后的 JSON 数据中提取题目数组并存入 problemMap
     * @param {any} data
     */
    function extractAndStore(data) {
        if (!data) return;

        // 直接是题目数组
        if (Array.isArray(data) && data.length > 0 && data[0] && data[0].problemId) {
            storeProblems(data);
            return;
        }

        // 包裹在对象字段中
        if (typeof data === 'object') {
            for (const key of ['data', 'problems', 'result', 'list', 'items', 'questions']) {
                const val = data[key];
                if (Array.isArray(val) && val.length > 0 && val[0] && val[0].problemId) {
                    storeProblems(val);
                } else if (typeof val === 'string') {
                    // 处理双重编码 JSON：字段值本身是 JSON 字符串（如 data.data 为字符串）
                    const parsed = safeParseJSON(val);
                    if (parsed) extractAndStore(parsed);
                } else if (val && typeof val === 'object') {
                    extractAndStore(val);
                }
            }
        }
    }

    function storeProblems(problems) {
        let changed = false;
        problems.forEach(p => {
            if (!p || !p.problemId) return;
            const id = String(p.problemId);
            if (problemMap.has(id)) {
                problemMap.set(id, mergeProblem(problemMap.get(id), p));
            } else {
                problemMap.set(id, Object.assign({}, p));
                changed = true;
            }
        });
        if (changed) {
            updateBadge();
            console.log('[雨课堂导出] 找到雨课堂问题信息:', Array.from(problemMap.values()));
        }
    }

    // ── JSON 安全解析 ─────────────────────────────────────────────────────────
    function safeParseJSON(text) {
        if (typeof text !== 'string') return null;
        const t = text.trim();
        if (!t.startsWith('{') && !t.startsWith('[')) return null;
        try { return JSON.parse(t); } catch { return null; }
    }

    // ── 拦截 XMLHttpRequest ───────────────────────────────────────────────────
    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR() {
        const xhr = new OrigXHR();
        const origOpen = xhr.open.bind(xhr);
        xhr.open = function (method, url, ...rest) {
            xhr.addEventListener('load', function () {
                const text = xhr.responseText;
                const data = safeParseJSON(text);
                if (data) {
                    if (typeof url === 'string' && (url.includes('presentation') || url.includes('lesson'))) {
                        console.log('[雨课堂导出] 收到雨课堂课件信息:', url, { data: text, type: 'xhr', url });
                    }
                    extractAndStore(data);
                }
            });
            return origOpen(method, url, ...rest);
        };
        return xhr;
    }
    Object.setPrototypeOf(PatchedXHR, OrigXHR);
    Object.setPrototypeOf(PatchedXHR.prototype, OrigXHR.prototype);
    window.XMLHttpRequest = PatchedXHR;

    // ── 拦截 Fetch ───────────────────────────────────────────────────────────
    const origFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const response = await origFetch(...args);
        const url = typeof args[0] === 'string' ? args[0]
                  : (args[0] instanceof Request ? args[0].url : '');
        response.clone().text().then(text => {
            const data = safeParseJSON(text);
            if (data) {
                if (typeof url === 'string' && (url.includes('presentation') || url.includes('lesson'))) {
                    console.log('[雨课堂导出] 收到雨课堂课件信息:', url, { data: text, type: 'fetch', url });
                }
                extractAndStore(data);
            }
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
                if (data) extractAndStore(data);
            });
        }
    }
    window.WebSocket = PatchedWebSocket;

    // ── 样式 ─────────────────────────────────────────────────────────────────
    GM_addStyle(`
        #ykt-export-fab {
            position: fixed;
            bottom: 24px;
            left: 24px;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
            font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        #ykt-export-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            background: #2980b9;
            color: #fff;
            border: none;
            border-radius: 24px;
            padding: 10px 18px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(0,0,0,0.22);
            transition: background 0.2s;
            white-space: nowrap;
        }
        #ykt-export-btn:hover { background: #1a6a9a; }
        #ykt-export-btn:active { transform: scale(0.97); }
        #ykt-export-badge {
            background: #e74c3c;
            color: #fff;
            border-radius: 12px;
            padding: 1px 8px;
            font-size: 12px;
            font-weight: bold;
            min-width: 22px;
            text-align: center;
            display: inline-block;
        }
        #ykt-export-toast {
            background: rgba(0,0,0,0.75);
            color: #fff;
            border-radius: 8px;
            padding: 6px 14px;
            font-size: 13px;
            pointer-events: none;
            animation: ykt-toast-fade 2.5s forwards;
        }
        @keyframes ykt-toast-fade {
            0%   { opacity: 1; }
            70%  { opacity: 1; }
            100% { opacity: 0; }
        }
    `);

    // ── 悬浮按钮 ─────────────────────────────────────────────────────────────
    let fabEl = null;
    let badgeEl = null;
    let toastEl = null;

    function initFAB() {
        fabEl = document.createElement('div');
        fabEl.id = 'ykt-export-fab';

        const btn = document.createElement('button');
        btn.id = 'ykt-export-btn';

        badgeEl = document.createElement('span');
        badgeEl.id = 'ykt-export-badge';
        badgeEl.textContent = '0';

        btn.innerHTML = '💾 导出题目 JSON ';
        btn.appendChild(badgeEl);
        btn.addEventListener('click', downloadJSON);

        fabEl.appendChild(btn);
        document.body.appendChild(fabEl);
    }

    function updateBadge() {
        if (badgeEl) badgeEl.textContent = String(problemMap.size);
    }

    function showToast(msg) {
        if (toastEl) toastEl.remove();
        toastEl = document.createElement('div');
        toastEl.id = 'ykt-export-toast';
        toastEl.textContent = msg;
        fabEl.insertBefore(toastEl, fabEl.firstChild);
        setTimeout(() => { if (toastEl) { toastEl.remove(); toastEl = null; } }, 2600);
    }

    // ── 导出逻辑 ─────────────────────────────────────────────────────────────

    function downloadJSON() {
        if (problemMap.size === 0) {
            showToast('⚠️ 暂未收集到任何题目数据');
            return;
        }

        // 按 sendTime 降序排列（已发送的排前面），未发送(sendTime=0)排后面
        const problems = Array.from(problemMap.values()).sort((a, b) => {
            if (b.sendTime !== a.sendTime) return b.sendTime - a.sendTime;
            return String(a.problemId).localeCompare(String(b.problemId));
        });

        const json = JSON.stringify(problems, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        // 生成文件名：yuketang_quiz_YYYYMMDD_HHMMSS.json
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
                 + `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const filename = `yuketang_quiz_${ts}.json`;

        // 优先用 GM_download（不受浏览器下载拦截影响）
        if (typeof GM_download === 'function') {
            GM_download({ url, name: filename });
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
        }

        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast(`✅ 已导出 ${problems.length} 道题目`);
        console.info(`[雨课堂导出] 已下载 ${filename}，共 ${problems.length} 题`);
    }

    // ── 等待 body 后挂载 FAB ─────────────────────────────────────────────────
    if (document.body) {
        initFAB();
    } else {
        new MutationObserver((_, obs) => {
            if (document.body) { obs.disconnect(); initFAB(); }
        }).observe(document.documentElement, { childList: true });
    }

    console.info('[雨课堂导出] 脚本已启动，正在收集题目数据...');
})();
