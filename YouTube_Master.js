// ==UserScript==
// @name         YouTube 优化大师
// @namespace    https://t.me/CMLiussss
// @version      0.7.8-fix
// @description  YouTube 视频体验增强：v0.7.8 跳过按钮+seekTo+10s冷却，无hooks无循环。含画质/布局/年龄/倒赞等功能。
// @author       CMLiussss
// @icon         https://raw.cmliussss.net/favicon.ico
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// @noframes
// @updateURL    https://raw.cmliussss.net/js/YouTube_Master.js
// @downloadURL  https://raw.cmliussss.net/js/YouTube_Master.js
// ==/UserScript==

(function () {
    'use strict';
    // ===== 调试日志（带颜色前缀，方便在 F12 Console 里一眼识别） =====
    const 日志标签 = '%c[YT优化大师]';
    const 样式信息 = 'color:#339af0;font-weight:bold;';
    const 样式成功 = 'color:#51cf66;font-weight:bold;';
    const 样式警告 = 'color:#ffa94d;font-weight:bold;';
    const 样式错误 = 'color:#ff6b6b;font-weight:bold;';
    let 调试模式启用 = false;
    function logInfo() { if (!调试模式启用) return; console.log(日志标签, 样式信息, ...arguments); }
    function logOk() { console.log(日志标签, 样式成功, ...arguments); }
    function logWarn() { console.warn(日志标签, 样式警告, ...arguments); }
    function logError() { console.error(日志标签, 样式错误, ...arguments); }

    logOk('v0.7.8 脚本已注入 →', location.href);

    // ===== Trusted Types 兼容 =====
    // YouTube 启用了 CSP「require-trusted-types-for 'script'」，所有 innerHTML 赋值
    // 必须是 TrustedHTML 类型，否则浏览器直接抛错拦截。这里建一个放行 policy 来包装。
    let 创建HTML = (s) => s; // 不支持 Trusted Types 的环境直接透传字符串
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
        try {
            const policy = window.trustedTypes.createPolicy('nextshield-adb', { createHTML: (s) => s });
            创建HTML = (s) => policy.createHTML(s);
            logOk('Trusted Types policy「nextshield-adb」已创建');
        } catch (e) {
            logWarn('创建 Trusted Types policy 失败（可能名称冲突）:', e.message);
        }
    }

    // ===== 广告拦截核心（跳过按钮 + seekTo + 冷却防循环） =====
    // 策略（核心原则：零运行时函数钩子，不修改 fetch/XHR/JSON.parse 等原生函数）：
    //   1. 播放器级广告处理 —— MutationObserver 检测播放器 class 变化，检测到广告状态后处理。
    //   2. 广告静音 + 跳过按钮强制显示 —— 配合使用，模拟真人操作模式。
    //   3. 定时器加入随机 jitter —— 打破固定间隔的可预测模式。

    logOk('广告拦截核心 v0.7.8 初始化完成（策略：跳过按钮 + 广告静音）');

    // ===== 功能开关（持久化到 localStorage） =====
    // 气泡执行提示 / 自动切换画质 / 统计信息汉化 / 网速单位转换 / 预测倒赞数据：默认开启。
    // 广告过滤细粒度开关（5 项），每项对应一种独立的拦截手段，检测特征各异，
    // 可单独启用/禁用，便于用控制变量法逐项二分定位被油管检测的元凶。
    const 设置键 = 'nextshield_adb_options_v2';
    const 选项 = {
        气泡执行提示: true,
        自动画质模式: 'best',
        统计信息汉化: true,
        网速单位转换: true,
        倒赞比例条: true,
        预测倒赞数据: true,
        // ---- 广告过滤细粒度开关（5 项，默认全开） ----
        强显跳过按钮: true, // 🖱️ 强制显示隐藏的跳过按钮（让可跳过广告不被倒计时遮挡）
        广告时段静音: true, // 🔇 广告播放时自动静音
        广告横幅移除: true, // 🧹 移除页面上的广告横幅 / 商品推荐 / 信息流广告（DOM 删除）
        年龄限制绕过: true, // 🔞 绕过年龄验证弹窗
        自动恢复播放: true, // ▶️ 广告暂停视频后自动恢复播放
        调试模式: false
    };

    function 加载选项() {
        try {
            const 存档 = JSON.parse(localStorage.getItem(设置键) || '{}');
            if (typeof 存档.气泡执行提示 === 'boolean') 选项.气泡执行提示 = 存档.气泡执行提示;
            if (typeof 存档.自动画质模式 === 'string') {
                if (['best', '1080p', 'off'].includes(存档.自动画质模式)) {
                    选项.自动画质模式 = 存档.自动画质模式;
                }
            } else if (typeof 存档.自动最优画质 === 'boolean') {
                选项.自动画质模式 = 存档.自动最优画质 ? 'best' : 'off';
            }
            if (typeof 存档.统计信息汉化 === 'boolean') 选项.统计信息汉化 = 存档.统计信息汉化;
            if (typeof 存档.网速单位转换 === 'boolean') 选项.网速单位转换 = 存档.网速单位转换;
            if (typeof 存档.倒赞比例条 === 'boolean') 选项.倒赞比例条 = 存档.倒赞比例条;
            if (typeof 存档.预测倒赞数据 === 'boolean') 选项.预测倒赞数据 = 存档.预测倒赞数据;
            if (typeof 存档.调试模式 === 'boolean') 选项.调试模式 = 存档.调试模式;

            // ---- 广告过滤细粒度开关：直接读取 5 项 boolean ----
            // 5 项 key 集中在此数组，方便与「迁移」分支统一处理
            const 广告开关键表 = [
                '强显跳过按钮',
                '广告时段静音',
                '广告横幅移除',
                '年龄限制绕过', '自动恢复播放'
            ];
            const 已迁移到细粒度 = 广告开关键表.some(k => typeof 存档[k] === 'boolean');
            if (已迁移到细粒度) {
                // 新版存档：逐项读取
                广告开关键表.forEach(k => {
                    if (typeof 存档[k] === 'boolean') 选项[k] = 存档[k];
                });
            } else if (typeof 存档.快速处理 === 'boolean') {
                // 向后兼容：旧版「快速处理」开关已废弃，忽略
                logInfo('检测到旧版广告过滤开关「快速处理」，已忽略');
            }
            // 其余 3 项（广告横幅移除/年龄限制绕过/自动恢复播放）在旧版没有独立开关，
            // 迁移后保持默认开启，与旧行为一致。

            调试模式启用 = !!选项.调试模式;
            if (!['best', '1080p', 'off'].includes(选项.自动画质模式)) 选项.自动画质模式 = 'best';
            logInfo('已加载功能开关:', { ...选项 });
        } catch (e) {
            logWarn('功能开关存档损坏，使用默认值:', e);
        }
    }

    function 保存选项() {
        try { localStorage.setItem(设置键, JSON.stringify(选项)); } catch (e) { }
    }

    // 广告时段静音 / 跳过按钮处理为被动特性，当对应开关开启时需监听播放器 class 变化。
    // 各过滤函数内部已自行检查对应开关，无需在主循环层面统一门控。
    // 所有 5 项全关时才停止播放器观察器。
    function 视频广告处理启用() {
        return 选项.强显跳过按钮 || 选项.广告时段静音
            || 选项.广告横幅移除
            || 选项.年龄限制绕过 || 选项.自动恢复播放;
    }

    // 反检测：不隐藏广告 slot。YouTube 会注入广告元素并用 getComputedStyle /
    // getBoundingClientRect 校验其是否真实渲染，display:none 或零尺寸即判定为被拦截。
    // 正确做法是「不隐藏、靠秒跳让广告瞬间播完」——slot 照常渲染（校验通过）。
    function 同步广告过滤状态() {
        if (!视频广告处理启用()) {
            if (播放器观察器) {
                播放器观察器.disconnect();
                播放器观察器 = null;
            }
            已绑定播放器 = null;
            恢复音量(); // 关闭广告处理时恢复音量
        }
    }

    // ===== 全局状态 =====
    let 画质已提升 = false; // 当前视频是否已提升画质（切视频时重置）
    const 最近通知记录 = new Map(); // 通知冷却记录：键=类型+消息，值=上次弹出时间戳
    const 播放器广告类名 = ['ad-showing', 'ad-interrupting', 'ytp-ad-player-overlay', 'ytp-ad-display-override'];
    let 播放器观察器 = null;
    let 已绑定播放器 = null;

    // ===== 广告时段静音状态 =====
    let 广告静音已应用 = false; // 当前广告是否已应用静音
    let 广告静音前音量 = null; // 广告前的音量（0~1）
    let 广告静音前是否静音 = null; // 广告前的静音状态
    let 广告静音恢复定时器 = null; // 延迟确认恢复音量的定时器（防止广告中间 class 抖动误恢复）
    let 音量恢复保护定时器 = null; // 恢复音量后的短期保护定时器（防止 YouTube 播放器覆盖恢复值）

    // ===== 拦截统计（持久化到 localStorage，刷新页面也不丢） =====
    // 5 项广告过滤策略（每项限 6 字，策略名即代码标识，保持一致方便 UI 对齐）
    // 计数会显示在该开关左侧。总数 = 各策略计数之和（动态求和，不单独存）。
    const 策略键表 = [
        '强显跳过按钮',
        '广告时段静音',
        '广告横幅移除',
        '年龄限制绕过', '自动恢复播放'
    ];
    const 统计 = {};
    策略键表.forEach(k => { 统计[k] = 0; });
    const 存档键 = 'nextshield_adb_stats_v1';

    function 统计总数() {
        return 策略键表.reduce((n, k) => n + (统计[k] || 0), 0);
    }

    function 加载统计() {
        try {
            const 存档 = JSON.parse(localStorage.getItem(存档键) || '{}');
            策略键表.forEach(k => { 统计[k] = Number.isFinite(存档[k]) ? 存档[k] : 0; });
            logInfo('已加载历史统计:', { ...统计 });
        } catch (e) {
            logWarn('统计存档损坏，从 0 重新开始:', e);
        }
    }

    function 保存统计() {
        try { localStorage.setItem(存档键, JSON.stringify(统计)); } catch (e) { }
    }

    // 注：以下名字保持英文，因为它们是 DOM / YouTube API / CSS 类名，改成中文会失效：
    //   - CSS 类名（nextshield-stats、nextshield-notification 等）：在 <style> 和 querySelector 中互相对应
    //   - YouTube 的 DOM 选择器（.ad-showing、#movie_player、ytd-... 等）
    //   - YouTube 播放器 API（getAvailableQualityLevels、setPlaybackQualityRange 等）

    // ===== 注入样式 =====
    function 应用增强样式() {
        if (document.querySelector('#nextshield-style')) return; // 幂等，避免重复注入
        const 样式 = document.createElement('style');
        样式.id = 'nextshield-style';
        样式.textContent = `
            /* ===== 常驻统计面板（右下角，始终可见） ===== */
            .nextshield-stats {
                position: fixed;
                bottom: 20px;
                right: 28px; /* 与拖动/展开时的右侧边距保持一致，避免贴近浏览器右侧滚动条 */
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #fff;
                user-select: none;
                cursor: grab;
                opacity: 0;
                transform: translateY(20px);
                transition: opacity .4s ease, transform .4s cubic-bezier(.18,.89,.32,1.28), left 0s, top 0s;
            }
            .nextshield-stats.ns-ready { opacity: 1; transform: translateY(0); }
            /* 拖动中：关闭过渡动画（避免跟手卡顿），光标切换为「正在抓取」 */
            .nextshield-stats.ns-dragging {
                transition: none !important;
                cursor: grabbing !important;
            }
            /* 按钮 / 下拉框 / 开关这些可交互元素维持普通指针样式，不被拖动光标覆盖 */
            .nextshield-stats button,
            .nextshield-stats select,
            .nextshield-stats .ns-toggle {
                cursor: pointer;
            }

            .ns-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 16px;
                background: rgba(15, 15, 20, .82);
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 999px;
                box-shadow: none;
                backdrop-filter: blur(10px);
                font-size: 13px;
                font-weight: 600;
                white-space: nowrap;
                transition: background .25s ease, transform .5s ease;
            }
            .ns-header:hover { background: rgba(30, 30, 40, .9); }
            .ns-shield { font-size: 16px; filter: drop-shadow(0 0 4px rgba(80,200,120,.8)); flex-shrink: 0; }
            .ns-total {
                min-width: 18px;
                text-align: center;
                color: #51cf66;
                font-variant-numeric: tabular-nums;
                flex-shrink: 0;
            }
            .ns-arrow { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; opacity: .6; transition: transform .25s ease; flex-shrink: 0; }
            .ns-arrow svg { width: 16px; height: 16px; fill: none; stroke: #fff; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
            .nextshield-stats.ns-expanded .ns-arrow { transform: rotate(90deg); }

            /* 拦截计数 +1 时头部脉冲一下 */
            .nextshield-stats.ns-bump .ns-header { animation: nsBump .5s ease; }
            @keyframes nsBump {
                0%   { transform: scale(1); }
                35%  { transform: scale(1.12); background: rgba(81,207,102,.95); }
                100% { transform: scale(1); }
            }

            .ns-body {
                margin-top: 8px;
                padding: 12px 14px;
                background: rgba(15, 15, 20, .9);
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 14px;
                box-shadow:none;
                backdrop-filter: blur(10px);
                font-size: 12px;
                font-weight: 500;
                min-width: 190px;
                display: none;
            }
            .nextshield-stats.ns-expanded .ns-body { display: block; animation: nsFade .2s ease; }
            @keyframes nsFade { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

            .ns-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                padding: 5px 0;
                opacity: .92;
            }
            .ns-row b { font-weight: 700; font-variant-numeric: tabular-nums; color: #fff; }
            .ns-row-status b { color: #51cf66; font-size: 11px; }

            .ns-strategy {
                margin-top: 6px;
                padding-top: 8px;
                border-top: 1px solid rgba(255,255,255,.1);
            }

            /* 策略开关左侧的拦截计数徽标 */
            .ns-toggle-label { display: inline-flex; align-items: center; gap: 6px; }
            .ns-count {
                min-width: 18px;
                padding: 0 5px;
                border-radius: 999px;
                background: rgba(81,207,102,.22);
                color: #51cf66;
                font-size: 10px;
                font-weight: 700;
                font-variant-numeric: tabular-nums;
                text-align: center;
                line-height: 16px;
                flex-shrink: 0;
            }
            /* 计数为 0 时淡化，避免一堆 0 抢眼 */
            .ns-count[data-zero] { background: rgba(255,255,255,.08); color: rgba(255,255,255,.35); }

            /* 功能开关勾选项 */
            .ns-toggles {
                margin-top: 6px;
                padding-top: 8px;
                border-top: 1px solid rgba(255,255,255,.1);
            }
            .ns-toggle {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 5px 0;
                opacity: .92;
                cursor: pointer;
                user-select: none;
            }
            .ns-toggle input { display: none; }
            .ns-toggle-switch {
                position: relative;
                width: 30px;
                height: 16px;
                background: rgba(255,255,255,.18);
                border-radius: 999px;
                transition: background .2s ease;
                flex-shrink: 0;
            }
            .ns-toggle-switch::after {
                content: '';
                position: absolute;
                top: 2px;
                left: 2px;
                width: 12px;
                height: 12px;
                background: #fff;
                border-radius: 50%;
                transition: transform .2s ease;
            }
            .ns-toggle input:checked + .ns-toggle-switch { background: #51cf66; }
            .ns-toggle input:checked + .ns-toggle-switch::after { transform: translateX(14px); }
            .ns-toggle-select .ns-quality-mode {
                width: fit-content;
                min-width: 0;
                max-width: 100%;
                height: 26px;
                padding: 0 8px;
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 8px;
                background: rgba(255,255,255,.08);
                color: #fff;
                font-size: 11px;
                outline: none;
                cursor: pointer;
            }
            .ns-toggle-select .ns-quality-mode option { color: #111; }

            .ns-actions {
                display: flex;
                gap: 8px;
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(255,255,255,.1);
            }
            .ns-actions button {
                flex: 1;
                padding: 5px 8px;
                background: rgba(255,255,255,.08);
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 8px;
                color: #fff;
                font-size: 11px;
                cursor: pointer;
                transition: background .2s ease;
            }
            .ns-actions button:hover { background: rgba(255,255,255,.18); }

            /* 最小化为一个小盾牌圆点，点击恢复 */
            .nextshield-stats.ns-dots .ns-header,
            .nextshield-stats.ns-dots .ns-body { display: none; }
            .nextshield-stats.ns-dots::before {
                content: '🛡️';
                font-size: 18px;
                display: block;
                padding: 8px 10px;
                background: rgba(15,15,20,.82);
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 999px;
                box-shadow: 0 6px 24px rgba(0,0,0,.45);
                backdrop-filter: blur(10px);
            }

            /* ===== 浮动事件通知（右上角，短暂提示，不拦截点击） ===== */
            .nextshield-notification-stack {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 8px;
                pointer-events: none;
            }
            .nextshield-notification {
                padding: 10px 14px;
                background: linear-gradient(135deg, rgba(56, 142, 180, .88) 0%, rgba(42, 115, 150, .88) 100%);
                color: rgba(255,255,255,.96);
                border-radius: 10px;
                box-shadow: 0 6px 18px rgba(0,0,0,.22);
                backdrop-filter: blur(6px);
                border: 1px solid rgba(255,255,255,.12);
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
                font-weight: 500;
                opacity: 0;
                transform: translateY(-8px) scale(.98);
                transition: all .4s cubic-bezier(.18,.89,.32,1.28);
                max-width: 280px;
                overflow: hidden;
                pointer-events: none; /* 通知只是提示，不挡住下面的点击 */
            }
            .nextshield-notification.show { opacity: 1; transform: translateY(0) scale(1); }
            .nextshield-notification.ad-blocked { background: linear-gradient(135deg, rgba(176, 92, 92, .88) 0%, rgba(150, 74, 74, .88) 100%); }
            .nextshield-notification.success { background: linear-gradient(135deg, rgba(79, 152, 95, .88) 0%, rgba(61, 126, 76, .88) 100%); }
            .nextshield-notification.info { background: linear-gradient(135deg, rgba(56, 142, 180, .88) 0%, rgba(42, 115, 150, .88) 100%); }
            .nextshield-notification.warning { background: linear-gradient(135deg, rgba(177, 136, 67, .88) 0%, rgba(149, 111, 49, .88) 100%); }
            .notification-icon { display: inline-block; margin-right: 6px; font-size: 13px; }
            .notification-progress {
                position: absolute; bottom: 0; left: 0; height: 2px;
                background: rgba(255,255,255,.22); border-radius: 0 0 10px 10px;
                animation: nsProgress 3s linear forwards;
            }
            @keyframes nsProgress { from { width: 100%; } to { width: 0%; } }

            /* 反检测：不对广告 slot 施加 display:none，避免 YouTube 校验失败触发拦截器检测弹窗。 */

            /* ===== 预测倒赞数据：比例条（样式与 return-youtube-dislike content-style.css 一致） ===== */
            /* 配色：点赞绿、倒赞红（比 RYD 默认的白/灰更直观） */
            #ryd-bar-container {
                background: #cc0000; /* 倒赞红（外条=倒赞占比的底色） */
                border-radius: 2px;
            }
            #ryd-bar {
                background: #2dbe60; /* 点赞绿（内条=点赞占比的填充） */
                border-radius: 2px;
                transition: all 0.15s ease-in-out;
            }
            .ryd-tooltip {
                display: block;
                height: 2px;
            }
            .ryd-tooltip-old-design {
                position: relative;
                top: 9px;
            }
            .ryd-tooltip-new-design {
                position: absolute;
                bottom: -10px;
            }
            .ryd-tooltip-bar-container {
                width: 100%;
                height: 2px;
                position: absolute;
                padding-top: 6px;
                padding-bottom: 12px;
                top: -6px;
            }
            /* 让比例条在新版操作栏布局里可见（与 RYD 同款修复） */
            ytd-menu-renderer.ytd-watch-metadata { overflow-y: visible !important; }
            #top-level-buttons-computed { position: relative !important; }

            /* 倒赞文本容器（克隆自点赞按钮） */
            [data-ns-dislike-text] { font-weight: 500; }
        `;
        (document.head || document.documentElement).appendChild(样式);
        logOk('样式已注入');
    }

    // ===== 创建常驻统计面板（幂等，可安全重复调用） =====
    let 面板节点 = null;

    // ===== 面板拖动定位（持久化到 localStorage，刷新页面/重启浏览器后保留位置） =====
    const 位置存档键 = 'nextshield_adb_position_v1';

    function 加载面板位置() {
        try {
            const 存档 = JSON.parse(localStorage.getItem(位置存档键) || 'null');
            if (存档 && Number.isFinite(存档.left) && Number.isFinite(存档.top)) return 存档;
        } catch (e) { }
        return null;
    }

    function 保存面板位置(left, top) {
        try { localStorage.setItem(位置存档键, JSON.stringify({ left, top })); } catch (e) { }
    }

    // 把坐标限制在当前视口范围内（左右各保留 28px 边距，防止按钮紧贴屏幕边缘或被滚动条遮挡）
    const 面板边距 = 28;
    function 限制面板位置(节点, left, top) {
        const 宽 = 节点.offsetWidth || 220;
        const 高 = 节点.offsetHeight || 40;
        const 最大左 = Math.max(0, window.innerWidth - 宽 - 面板边距);
        const 最大上 = Math.max(0, window.innerHeight - 高);
        return {
            left: Math.min(Math.max(面板边距, left), 最大左),
            top: Math.min(Math.max(0, top), 最大上)
        };
    }

    // 把已保存的位置应用到面板上（没有保存过位置时，保持 CSS 默认的右下角，不做任何处理）
    function 应用面板位置(节点, 位置) {
        if (!节点 || !位置) return;
        const 安全位置 = 限制面板位置(节点, 位置.left, 位置.top);
        节点.style.left = 安全位置.left + 'px';
        节点.style.top = 安全位置.top + 'px';
        节点.style.right = 'auto';
        节点.style.bottom = 'auto';
        节点.dataset.位置已固定 = '1'; // 读到存档说明曾被拖动过，允许后续展开时持久化位置修正
    }

    // 面板用 left/top 定位（被拖动过或展开过）时，按面板当前尺寸重新夹取位置，
    // 保证右缘与视口右侧保持「面板边距」的间距。小圆点明显比头部窄：若先把小圆点
    // 拖到贴近屏幕右缘，再点击恢复成头部，宽度变大会向右伸出视口而被滚动条遮挡，
    // 因此每次面板宽度变化后都要按新宽度重新收回可视范围。
    function 把面板收回可视范围(节点) {
        if (!节点 || !节点.style.left) return; // 仍用 CSS 默认 right/bottom 定位，无需处理
        const 安全位置 = 限制面板位置(节点, parseFloat(节点.style.left) || 0, parseFloat(节点.style.top) || 0);
        节点.style.left = 安全位置.left + 'px';
        节点.style.top = 安全位置.top + 'px';
    }

    // 绑定拖动：鼠标 / 触摸均支持。整个面板（包括展开的详情区背景、最小化后的小盾牌图标）
    // 都可以拖，但落在按钮 / 输入框 / 下拉框 / 开关上时不拦截，交给它们正常响应点击。
    // 只有真正发生了移动（超过 3px）才会被判定为「拖动」，单纯点击不受任何影响。
    function 绑定面板拖动(节点) {
        let 拖动中 = false;
        let 起始X = 0, 起始Y = 0, 起始Left = 0, 起始Top = 0;

        function 取指针坐标(e) {
            const 触点 = e.touches && e.touches[0];
            return { x: 触点 ? 触点.clientX : e.clientX, y: 触点 ? 触点.clientY : e.clientY };
        }

        function 是否可交互元素(目标) {
            return !!(目标.closest && 目标.closest('button, input, select, label.ns-toggle, .ns-actions, .ns-quality-mode'));
        }

        function 开始拖动(e) {
            if (是否可交互元素(e.target)) return; // 落在按钮/开关/下拉框上，不拦截
            拖动中 = true;
            delete 节点.dataset.拖动已移动;

            const 矩形 = 节点.getBoundingClientRect();
            起始Left = 矩形.left;
            起始Top = 矩形.top;
            const p = 取指针坐标(e);
            起始X = p.x;
            起始Y = p.y;

            document.addEventListener('mousemove', 拖动中处理, { passive: false });
            document.addEventListener('mouseup', 结束拖动);
            document.addEventListener('touchmove', 拖动中处理, { passive: false });
            document.addEventListener('touchend', 结束拖动);
        }

        function 拖动中处理(e) {
            if (!拖动中) return;
            const p = 取指针坐标(e);
            const dx = p.x - 起始X;
            const dy = p.y - 起始Y;

            if (!节点.dataset.拖动已移动 && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                // 首次确认这是「拖动」而不是单击：此刻才切到 left/top 定位、加上拖动态样式
                节点.dataset.拖动已移动 = '1';
                节点.style.left = 起始Left + 'px';
                节点.style.top = 起始Top + 'px';
                节点.style.right = 'auto';
                节点.style.bottom = 'auto';
                节点.classList.add('ns-dragging');
            }
            if (!节点.dataset.拖动已移动) return;
            if (e.cancelable) e.preventDefault(); // 防止拖动时触发页面滚动 / 选中文字

            const 安全位置 = 限制面板位置(节点, 起始Left + dx, 起始Top + dy);
            节点.style.left = 安全位置.left + 'px';
            节点.style.top = 安全位置.top + 'px';
        }

        function 结束拖动() {
            if (!拖动中) return;
            拖动中 = false;
            document.removeEventListener('mousemove', 拖动中处理);
            document.removeEventListener('mouseup', 结束拖动);
            document.removeEventListener('touchmove', 拖动中处理);
            document.removeEventListener('touchend', 结束拖动);

            if (节点.dataset.拖动已移动) {
                节点.classList.remove('ns-dragging');
                节点.style.right = 'auto';
                节点.style.bottom = 'auto';
                节点.dataset.位置已固定 = '1'; // 标记已被用户拖动过，之后展开时的位置修正才允许持久化
                保存面板位置(parseFloat(节点.style.left) || 0, parseFloat(节点.style.top) || 0);
                logInfo('面板位置已保存:', 节点.style.left, 节点.style.top);
            }
        }

        节点.addEventListener('mousedown', (e) => { if (e.button === 0) 开始拖动(e); });
        节点.addEventListener('touchstart', 开始拖动, { passive: true });

        // 窗口尺寸变化（改变窗口大小、进入/退出影院模式等）时，把面板重新收回可视范围内
        window.addEventListener('resize', () => {
            把面板收回可视范围(节点);
        });
    }

    function 创建统计面板() {
        if (!document.body) {
            logWarn('创建面板失败：document.body 尚未就绪');
            return false;
        }
        if (面板节点 && 面板节点.isConnected) return true; // 已存在且仍在页面上

        面板节点 = null; // 上次的引用可能已脱离 DOM，清掉重建
        const 旧的 = document.querySelector('.nextshield-stats');
        if (旧的) {
            logInfo('发现残留旧面板，移除后重建');
            旧的.remove();
        }

        面板节点 = document.createElement('div');
        面板节点.className = 'nextshield-stats';
        面板节点.innerHTML = 创建HTML(`
            <div class="ns-header">
                <span class="ns-shield">🛡️</span>
                <span>已拦截</span>
                <span class="ns-total">0</span>
                <span class="ns-arrow"><svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg></span>
            </div>
            <div class="ns-body">
            <div class="ns-row ns-row-status"><span>📡 广告过滤策略</span><b class="ns-ad-count">未过滤</b></div>
                <div class="ns-strategy">
                    <label class="ns-toggle">
                        <span class="ns-toggle-label">🖱️ 强显跳过按钮 <b class="ns-count" data-count="强显跳过按钮">0</b></span>
                        <input type="checkbox" class="ns-toggle-ad-force-skip">
                        <span class="ns-toggle-switch"></span>
                    </label>
                    <label class="ns-toggle">
                        <span class="ns-toggle-label">🔇 广告时段静音 <b class="ns-count" data-count="广告时段静音">0</b></span>
                        <input type="checkbox" class="ns-toggle-ad-mute">
                        <span class="ns-toggle-switch"></span>
                    </label>
                    <label class="ns-toggle">
                        <span class="ns-toggle-label">🧹 广告横幅移除 <b class="ns-count" data-count="广告横幅移除">0</b></span>
                        <input type="checkbox" class="ns-toggle-ad-banner">
                        <span class="ns-toggle-switch"></span>
                    </label>
                    <label class="ns-toggle">
                        <span class="ns-toggle-label">🔞 年龄限制绕过 <b class="ns-count" data-count="年龄限制绕过">0</b></span>
                        <input type="checkbox" class="ns-toggle-ad-age">
                        <span class="ns-toggle-switch"></span>
                    </label>
                    <label class="ns-toggle">
                        <span class="ns-toggle-label">▶️ 自动恢复播放 <b class="ns-count" data-count="自动恢复播放">0</b></span>
                        <input type="checkbox" class="ns-toggle-ad-resume">
                        <span class="ns-toggle-switch"></span>
                    </label>
                </div>
                <div class="ns-toggles">
                    <label class="ns-toggle">
                        <span>🌐 统计信息汉化</span>
                        <input type="checkbox" class="ns-toggle-stats-i18n">
                        <span class="ns-toggle-switch"></span>
                    </label>
                    <label class="ns-toggle">
                        <span>📊 网速单位转换</span>
                        <input type="checkbox" class="ns-toggle-speed-conv">
                        <span class="ns-toggle-switch"></span>
                    </label>
                    <label class="ns-toggle">
                        <span>👎 预测倒赞数据</span>
                        <input type="checkbox" class="ns-toggle-dislike">
                        <span class="ns-toggle-switch"></span>
                    </label>
                    <label class="ns-toggle">
                        <span>📊 显示倒赞比例</span>
                        <input type="checkbox" class="ns-toggle-ratebar">
                        <span class="ns-toggle-switch"></span>
                    </label>
                    <label class="ns-toggle ns-toggle-select">
                        <span>🎬 自动切换画质</span>
                        <select class="ns-quality-mode">
                            <option value="best">最高</option>
                            <option value="1080p">1080p</option>
                            <option value="off">关闭</option>
                        </select>
                    </label>
                </div>
                <div class="ns-toggles">
                    <label class="ns-toggle">
                        <span>💬 气泡执行提示</span>
                        <input type="checkbox" class="ns-toggle-bubble">
                        <span class="ns-toggle-switch"></span>
                    </label>
                    <label class="ns-toggle">
                        <span>🧪 打印调试日志</span>
                        <input type="checkbox" class="ns-toggle-debug">
                        <span class="ns-toggle-switch"></span>
                    </label>
                </div>
                <div class="ns-actions">
                    <button class="ns-reset">重置统计</button>
                    <button class="ns-min">最小化</button>
                </div>
            </div>
        `);
        document.body.appendChild(面板节点);

        // 绑定拖动 + 还原上次保存的位置（从未拖动过则保持 CSS 默认的右下角）
        绑定面板拖动(面板节点);
        应用面板位置(面板节点, 加载面板位置());

        // 点击头部：展开 / 收起详情
        面板节点.querySelector('.ns-header').addEventListener('click', () => {
            if (面板节点.dataset.拖动已移动) { delete 面板节点.dataset.拖动已移动; return; } // 刚拖动完，不触发展开/收起
            面板节点.classList.remove('ns-dots');
            const 当前已展开 = 面板节点.classList.contains('ns-expanded');
            if (!当前已展开) {
                // 即将展开：先确保 left/top 定位生效（清除 right/bottom 防止过度约束导致拉伸到视口外）
                if (!面板节点.style.left) {
                    const 矩形 = 面板节点.getBoundingClientRect();
                    面板节点.style.left = 矩形.left + 'px';
                    面板节点.style.top = 矩形.top + 'px';
                }
                面板节点.style.right = 'auto';
                面板节点.style.bottom = 'auto';

                // 先量 body 宽度（display:none 时强制可见但脱离文档流，不影响渲染）
                const body = 面板节点.querySelector('.ns-body');
                let body宽 = 0;
                try {
                    body.style.display = 'block';
                    body.style.visibility = 'hidden';
                    body.style.position = 'absolute';
                    body宽 = body.offsetWidth;
                } finally {
                    body.style.display = '';
                    body.style.visibility = '';
                    body.style.position = '';
                }

                // 用 body 宽度计算：向左挪到刚好留出右边距
                const 当前Left = parseFloat(面板节点.style.left);
                const 目标右边 = window.innerWidth - 面板边距;
                let 新Left = Math.max(面板边距, 目标右边 - body宽);
                if (Number.isFinite(当前Left) && 新Left >= 当前Left) 新Left = 当前Left; // 不需要动就不动（NaN 时跳过保护，按计算值左移）
                面板节点.style.left = 新Left + 'px';

                // 展开
                面板节点.classList.add('ns-expanded');

                // 底部溢出修正
                const 展开后矩形 = 面板节点.getBoundingClientRect();
                let 新Top = parseFloat(面板节点.style.top);
                if (展开后矩形.bottom > window.innerHeight) {
                    新Top = Math.max(0, (Number.isFinite(新Top) ? 新Top : 展开后矩形.top) - (展开后矩形.bottom - window.innerHeight) - 10);
                    面板节点.style.top = 新Top + 'px';
                }
                // 仅当用户曾经拖动过面板时，才把展开时的临时视觉修正持久化；
                // 否则保持 CSS 默认右下角语义（未拖动 → 不落盘）
                if (面板节点.dataset.位置已固定) {
                    保存面板位置(新Left, Number.isFinite(新Top) ? 新Top : 0);
                }
            } else {
                面板节点.classList.remove('ns-expanded');
            }
        });
        // 重置计数
        面板节点.querySelector('.ns-reset').addEventListener('click', (e) => {
            e.stopPropagation();
            策略键表.forEach(k => { 统计[k] = 0; });
            保存统计();
            刷新面板();
            logInfo('统计已重置');
        });
        // 最小化为小圆点
        面板节点.querySelector('.ns-min').addEventListener('click', (e) => {
            e.stopPropagation();
            面板节点.classList.remove('ns-expanded');
            面板节点.classList.add('ns-dots');
        });
        // 最小化状态下点击小圆点恢复
        面板节点.addEventListener('click', () => {
            if (面板节点.dataset.拖动已移动) { delete 面板节点.dataset.拖动已移动; return; } // 刚拖动完，不触发恢复
            if (面板节点.classList.contains('ns-dots')) {
                面板节点.classList.remove('ns-dots');
                // 小圆点恢复成头部后宽度变大：若小圆点之前被拖到靠近屏幕右缘，
                // 需按头部新宽度重新夹取，保证右侧边距，避免被浏览器右侧滚动条遮挡。
                把面板收回可视范围(面板节点);
            }
        });

        // 刷新「广告过滤策略」状态文字
        function 刷新广告策略状态() {
            if (!面板节点) return;
            const 状态节点 = 面板节点.querySelector('.ns-ad-count');
            if (!状态节点) return;
            const 广告开关键表 = [
                '强显跳过按钮',
                '广告时段静音',
                '广告横幅移除',
                '年龄限制绕过', '自动恢复播放'
            ];
            const 已开启数 = 广告开关键表.reduce((n, k) => n + (选项[k] ? 1 : 0), 0);
            if (已开启数 === 0) {
                状态节点.textContent = '关闭';
            } else {
                状态节点.textContent = '运行中';
            }
        }

        // ---- 5 个广告过滤细粒度开关：统一绑定 ----
        // 每个 class → 对应 选项 key 的映射表；切换时写选项、落盘、同步根类名、刷新状态、打日志。
        const 广告开关映射表 = [
            { cls: '.ns-toggle-ad-force-skip', key: '强显跳过按钮' },
            { cls: '.ns-toggle-ad-mute', key: '广告时段静音' },
            { cls: '.ns-toggle-ad-banner', key: '广告横幅移除' },
            { cls: '.ns-toggle-ad-age', key: '年龄限制绕过' },
            { cls: '.ns-toggle-ad-resume', key: '自动恢复播放' }
        ];
        广告开关映射表.forEach(({ cls, key }) => {
            const 复选框 = 面板节点.querySelector(cls);
            if (!复选框) return;
            复选框.checked = !!选项[key];
            复选框.addEventListener('change', () => {
                选项[key] = 复选框.checked;
                保存选项();
                同步广告过滤状态();
                刷新广告策略状态();
                logInfo(key + '开关 →', 选项[key] ? '开' : '关');
            });
        });

        // 功能开关：气泡执行提示
        const 气泡复选框 = 面板节点.querySelector('.ns-toggle-bubble');
        气泡复选框.checked = 选项.气泡执行提示;
        气泡复选框.addEventListener('change', () => {
            选项.气泡执行提示 = 气泡复选框.checked;
            保存选项();
            logInfo('气泡执行提示开关 →', 选项.气泡执行提示 ? '开' : '关');
        });
        // 功能开关：自动切换画质
        const 画质模式选择框 = 面板节点.querySelector('.ns-quality-mode');
        画质模式选择框.value = 选项.自动画质模式;
        画质模式选择框.addEventListener('change', () => {
            选项.自动画质模式 = 画质模式选择框.value;
            保存选项();
            画质已提升 = false;
            logInfo('自动切换画质模式 →', 选项.自动画质模式);
            提升视频画质();
        });
        // 功能开关：统计信息汉化
        const 汉化复选框 = 面板节点.querySelector('.ns-toggle-stats-i18n');
        汉化复选框.checked = 选项.统计信息汉化;
        汉化复选框.addEventListener('change', () => {
            选项.统计信息汉化 = 汉化复选框.checked;
            保存选项();
            logInfo('统计信息汉化开关 →', 选项.统计信息汉化 ? '开' : '关');
            扫描统计信息面板(); // 立即应用一次（关闭时新打开的面板不再汉化）
        });
        // 功能开关：网速单位转换
        const 网速复选框 = 面板节点.querySelector('.ns-toggle-speed-conv');
        网速复选框.checked = 选项.网速单位转换;
        网速复选框.addEventListener('change', () => {
            选项.网速单位转换 = 网速复选框.checked;
            保存选项();
            logInfo('网速单位转换开关 →', 选项.网速单位转换 ? '开' : '关');
            扫描统计信息面板(); // 立即应用/撤销一次
        });
        // 功能开关：预测倒赞数据
        const 倒赞复选框 = 面板节点.querySelector('.ns-toggle-dislike');
        倒赞复选框.checked = 选项.预测倒赞数据;
        倒赞复选框.addEventListener('change', () => {
            选项.预测倒赞数据 = 倒赞复选框.checked;
            保存选项();
            logInfo('预测倒赞数据开关 →', 选项.预测倒赞数据 ? '开' : '关');
            if (选项.预测倒赞数据) {
                处理预测倒赞(); // 立即拉取一次并注入
            } else {
                清除倒赞注入(); // 关闭时移除已注入的倒赞文本与比例条
            }
        });
        // 功能开关：倒赞比例条
        const 比例条复选框 = 面板节点.querySelector('.ns-toggle-ratebar');
        比例条复选框.checked = 选项.倒赞比例条;
        比例条复选框.addEventListener('change', () => {
            选项.倒赞比例条 = 比例条复选框.checked;
            保存选项();
            logInfo('倒赞比例条开关 →', 选项.倒赞比例条 ? '开' : '关');
            if (!选项.倒赞比例条) 移除倒赞比例条();
            else if (选项.预测倒赞数据) 处理预测倒赞();
        });
        // 功能开关：调试模式
        const 调试复选框 = 面板节点.querySelector('.ns-toggle-debug');
        调试复选框.checked = 选项.调试模式;
        调试复选框.addEventListener('change', () => {
            选项.调试模式 = 调试复选框.checked;
            调试模式启用 = 选项.调试模式;
            保存选项();
            logOk('调试模式 →', 选项.调试模式 ? '开' : '关');
            if (选项.调试模式) {
                console.log(日志标签, 样式信息, '调试模式已开启，后续诊断日志会输出');
            }
        });
        // 点击 toggle 本身不应触发展开/收起
        面板节点.querySelectorAll('.ns-toggle').forEach(标签 => {
            标签.addEventListener('click', e => e.stopPropagation());
        });

        刷新广告策略状态();

        刷新面板();
        requestAnimationFrame(() => 面板节点.classList.add('ns-ready')); // 入场动画
        logOk('✅ 统计面板已创建并挂到 body');
        return true;
    }

    // 刷新面板：头部总数 + 每个策略开关左侧的计数徽标
    function 刷新面板() {
        if (!面板节点) return;
        const 总数节点 = 面板节点.querySelector('.ns-total');
        if (总数节点) 总数节点.textContent = 统计总数();
        策略键表.forEach(key => {
            const 计数节点 = 面板节点.querySelector(`[data-count="${key}"]`);
            if (!计数节点) return;
            const n = 统计[key] || 0;
            计数节点.textContent = n;
            计数节点.toggleAttribute('data-zero', n === 0);
        });
        // 头部总数等文字变化也会改变面板宽度，顺带按新宽度夹取，防止右侧伸出被遮挡
        把面板收回可视范围(面板节点);
    }

    // 记录一次策略执行：累加该策略计数、写入存档、刷新面板、触发脉冲动画
    function 记录拦截(策略key, 数量 = 1) {
        if (统计[策略key] === undefined) return; // 未知策略，忽略
        统计[策略key] += 数量;
        保存统计();
        刷新面板();
        logOk(`🎯 拦截 +${数量}（${策略key}）→ 累计 ${统计总数()}`);
        if (面板节点) {
            面板节点.classList.remove('ns-bump');
            void 面板节点.offsetWidth; // 强制重排，以重启动画
            面板节点.classList.add('ns-bump');
        }
    }

    // ===== 浮动事件通知（带冷却防刷屏） =====
    // 类型：'ad-blocked' 拦截 / 'success' 成功 / 'info' 信息 / 'warning' 警告
    function 显示通知(消息, 类型 = 'info', 持续时长 = 3000) {
        if (!选项.气泡执行提示) return; // 用户在面板里关掉了气泡执行提示，不再弹出
        const 容器挂载点 = document.body || document.documentElement;
        if (!容器挂载点) return;
        // 冷却：同样的通知在 1.5 秒内只弹一次，避免被观察器/定时器/递归三重触发刷屏
        const 冷却键 = 类型 + '|' + 消息;
        const 上次时间 = 最近通知记录.get(冷却键) || 0;
        if (Date.now() - 上次时间 < 1500) return;
        最近通知记录.set(冷却键, Date.now());

        let 通知堆栈 = document.querySelector('.nextshield-notification-stack');
        if (!通知堆栈) {
            通知堆栈 = document.createElement('div');
            通知堆栈.className = 'nextshield-notification-stack';
            容器挂载点.appendChild(通知堆栈);
        }

        const 通知 = document.createElement('div');
        通知.className = `nextshield-notification ${类型}`;
        const 图标表 = { 'ad-blocked': '🚫', 'success': '✅', 'info': 'ℹ️', 'warning': '⚠️' };
        通知.innerHTML = 创建HTML(`
            <span class="notification-icon">${图标表[类型] || 图标表.info}</span>${消息}
            <div class="notification-progress"></div>
        `);
        通知堆栈.appendChild(通知);

        setTimeout(() => 通知.classList.add('show'), 50);
        setTimeout(() => {
            通知.classList.remove('show');
            setTimeout(() => 通知.remove(), 400);
        }, 持续时长);
    }

    // ===== 提升视频画质（最优 / 1080P 限幅） =====
    function 提升视频画质() {
        if (选项.自动画质模式 === 'off') return; // 用户在面板里关掉了自动切换画质，不再自动切换
        if (画质已提升) return;

        const 播放器 = document.querySelector('#movie_player');
        if (!播放器 || !播放器.getAvailableQualityLevels) return;

        const 可用画质 = 播放器.getAvailableQualityLevels();
        if (!可用画质 || 可用画质.length === 0) return;

        画质已提升 = true;

        // 画质从高到低优先级；1080P 模式把上限卡在 hd1080
        const 画质优先级 = 选项.自动画质模式 === '1080p'
            ? ['hd1080', 'hd720', 'large', 'medium', 'small']
            : ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small'];
        const 选定画质 = 画质优先级.find(画质 => 可用画质.includes(画质));

        if (选定画质) {
            播放器.setPlaybackQualityRange(选定画质);
            显示通知(`已切换至 ${选定画质} 画质`, 'success');
            logInfo('画质已切换至', 选定画质);
        } else {
            显示通知('当前无可用的更高画质', 'info');
        }
        // 注：YouTube 的 getAvailableQualityLevels 只返回 hd1080/hd720 这类标签，
        //     不暴露帧率，因此无法通过该 API 选 60fps，故不再尝试。
    }

    function 播放器处于广告状态(播放器) {
        return !!播放器 && 播放器广告类名.some(类名 => 播放器.classList.contains(类名));
    }

    function 绑定播放器广告观察器() {
        if (!视频广告处理启用()) {
            if (播放器观察器) {
                播放器观察器.disconnect();
                播放器观察器 = null;
            }
            已绑定播放器 = null;
            return false;
        }

        const 播放器 = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (!播放器) return false;

        if (已绑定播放器 === 播放器 && 播放器观察器) return true;

        if (播放器观察器) {
            播放器观察器.disconnect();
            播放器观察器 = null;
        }

        已绑定播放器 = 播放器;
        播放器观察器 = new MutationObserver(() => {
            // 无论 class 是加上还是移除，都需调用处理函数：
            //   加上 → 静音/秒跳；移除 → 恢复音量
            处理视频广告();
        });
        播放器观察器.observe(播放器, { attributes: true, attributeFilter: ['class'] });

        if (播放器处于广告状态(播放器)) 处理视频广告();

        logOk('播放器广告观察器已绑定');
        return true;
    }

    // 视频广告处理统一入口
    //   优先使用 YouTube 原生播放器 API（seekTo）跳过，避免直接操作 HTMLVideoElement 触发属性变更监控。
    function 处理视频广告() {
        const 播放器 = 已绑定播放器 || document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (播放器) 绑定播放器广告观察器();

        const 在广告中 = 播放器处于广告状态(播放器);

        // 广告时段静音处理
        处理广告静音(播放器, 在广告中);

        if (!在广告中) return;

        // [调试] 记录广告检测
        logInfo('[处理视频广告] 检测到广告状态 | classList=' + (播放器 ? Array.from(播放器.classList).filter(function(c){return c.includes('ad')}).join(',') : '?') + ' | 强显跳过=' + 选项.强显跳过按钮);

        // ===== 强显跳过按钮 — 让隐藏的跳过按钮可见 =====
        if (选项.强显跳过按钮) {
            强显跳过按钮();
        }
    }

    // ===== 强显跳过按钮 =====
    // 当「强显跳过按钮」开启时，检测广告跳过按钮的 display:none 内联样式并移除，
    // 让用户可以手动点击跳过。可单独开启/关闭。
    function 强显跳过按钮() {
        const 跳过按钮选择器 = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot, .ytp-ad-skip-button-container';
        let 已显示 = 0;
        document.querySelectorAll(跳过按钮选择器).forEach(btn => {
            if (btn.style.display === 'none') {
                btn.style.display = '';
                已显示++;
            }
        });
        if (已显示 > 0) {
            logInfo('已移除 ' + 已显示 + ' 个跳过按钮的隐藏属性');
            显示通知('已显示广告跳过按钮 🖱️', 'ad-blocked');
            记录拦截('强显跳过按钮', 已显示);
        }
    }

    // ===== 广告时段静音（被动特性，由「广告时段静音」开关控制） =====
    // 广告播放时自动静音，广告结束立即恢复音量。与秒跳互补：秒跳直接结束广告，静音则让广告静默播放。
    // 注：YouTube 广告播放期间播放器 class 会短暂抖动（ad-showing 移除又加回），所以恢复音量时需延迟确认，避免误恢复。
    // 注：YouTube 会主动覆盖 muted 状态，所以广告期间需持续强制静音。
    function 处理广告静音(播放器, 在广告中) {
        if (!选项.广告时段静音) return;
        if (在广告中) {
            const 视频 = (播放器 && 播放器.querySelector('video'))
                || document.querySelector('#movie_player video')
                || document.querySelector('.html5-video-player video');
            if (!视频) return;

            if (!广告静音已应用) {
                // 首次进入广告：保存原始音量并静音
                // 优先通过 YouTube 播放器 API 获取，确保与播放器内部状态 / 音量滑块 UI 一致
                const 播放器API = 获取播放器API(播放器);
                if (播放器API) {
                    广告静音前音量 = (typeof 播放器API.getVolume === 'function') ? 播放器API.getVolume() / 100 : 视频.volume;
                    广告静音前是否静音 = (typeof 播放器API.isMuted === 'function') ? 播放器API.isMuted() : 视频.muted;
                } else {
                    广告静音前音量 = 视频.volume;
                    广告静音前是否静音 = 视频.muted;
                }
                广告静音已应用 = true;
                记录拦截('广告时段静音');
                显示通知('已静音广告视频 🔇', 'ad-blocked');
                logInfo('广告时段静音：已静音广告视频（前音量=', 广告静音前音量, '静音=', 广告静音前是否静音, '）');
            }
            // 取消可能挂起的恢复定时器（广告中间 class 抖动后又检测到广告）
            if (广告静音恢复定时器) {
                clearTimeout(广告静音恢复定时器);
                广告静音恢复定时器 = null;
                logInfo('广告时段静音：检测到广告仍在播放，取消挂起的恢复');
            }
            // 持续强制静音（YouTube 会覆盖 muted 状态）
            if (!视频.muted) {
                视频.muted = true;
                logInfo('广告时段静音：YouTube 试图取消静音，已重新静音');
            }
        } else if (广告静音已应用 && !广告静音恢复定时器) {
            // 广告可能结束：延迟 1 秒确认后再恢复音量
            广告静音恢复定时器 = setTimeout(() => {
                广告静音恢复定时器 = null;
                // 再次确认广告确实已结束
                const 播放器2 = 已绑定播放器 || document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
                if (播放器处于广告状态(播放器2)) {
                    logInfo('广告时段静音：延迟确认时发现仍在广告中，跳过恢复');
                    return;
                }
                恢复音量();
            }, 1000);
            logInfo('广告时段静音：检测到广告可能结束，1 秒后确认恢复音量');
        }
    }

    // 恢复广告时段静音前的音量状态
    function 恢复音量() {
        if (广告静音恢复定时器) {
            clearTimeout(广告静音恢复定时器);
            广告静音恢复定时器 = null;
        }
        // 清除可能挂起的保护定时器
        if (音量恢复保护定时器) {
            clearInterval(音量恢复保护定时器);
            音量恢复保护定时器 = null;
        }
        if (!广告静音已应用) return;

        // 保存目标值（在清空状态之前，供保护函数使用）
        const 目标音量 = 广告静音前音量;
        const 目标静音 = 广告静音前是否静音;

        const 视频 = document.querySelector('#movie_player video') || document.querySelector('.html5-video-player video');
        const 播放器API = 获取播放器API();

        if (播放器API) {
            // 优先通过 YouTube 播放器 API 恢复，使播放器内部状态与音量滑块 UI 同步
            if (目标音量 !== null && typeof 播放器API.setVolume === 'function') {
                播放器API.setVolume(Math.round(目标音量 * 100));
            }
            if (目标静音 === false && typeof 播放器API.unMute === 'function') {
                播放器API.unMute();
            } else if (目标静音 === true && typeof 播放器API.mute === 'function') {
                播放器API.mute();
            }
            logInfo('广告时段静音：已通过播放器 API 恢复音量');
        } else if (视频) {
            // 降级：直接操作 video 元素
            if (目标音量 !== null) 视频.volume = 目标音量;
            if (目标静音 !== null) 视频.muted = 目标静音;
            logInfo('广告时段静音：已恢复音量（降级模式）');
        }

        显示通知('已恢复音量 🔊', 'success');

        // 启动短期保护，防止 YouTube 在广告/正片切换时覆盖音量
        启动音量恢复保护(目标音量, 目标静音);

        广告静音已应用 = false;
        广告静音前音量 = null;
        广告静音前是否静音 = null;
    }

    // 获取 YouTube 播放器 API（#movie_player 暴露的 getVolume/setVolume/mute/unMute/isMuted 等方法）
    function 获取播放器API(播放器) {
        const p = 播放器 || document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (p && typeof p.getVolume === 'function') return p;
        return null;
    }

    // 音量恢复保护：短期内持续确保音量正确，防止 YouTube 在广告/正片切换时覆盖
    function 启动音量恢复保护(目标音量, 目标静音) {
        if (音量恢复保护定时器) clearInterval(音量恢复保护定时器);

        let 保护次数 = 0;
        const 最大保护次数 = 10; // 约 5 秒内每 500ms 检查一次

        音量恢复保护定时器 = setInterval(() => {
            保护次数++;
            if (保护次数 > 最大保护次数) {
                clearInterval(音量恢复保护定时器);
                音量恢复保护定时器 = null;
                logInfo('广告时段静音：音量恢复保护已结束');
                return;
            }

            // 如果又进入广告状态，停止保护
            const 播放器 = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
            if (播放器处于广告状态(播放器)) {
                clearInterval(音量恢复保护定时器);
                音量恢复保护定时器 = null;
                logInfo('广告时段静音：保护期间检测到新广告，停止保护');
                return;
            }

            const 播放器API = 获取播放器API(播放器);
            if (播放器API) {
                if (目标音量 !== null && typeof 播放器API.getVolume === 'function' && typeof 播放器API.setVolume === 'function') {
                    const 当前音量 = 播放器API.getVolume();
                    const 期望音量 = Math.round(目标音量 * 100);
                    if (当前音量 !== 期望音量) {
                        播放器API.setVolume(期望音量);
                        logInfo('广告时段静音：保护性恢复音量', 当前音量, '→', 期望音量);
                    }
                }
                if (目标静音 === false && typeof 播放器API.isMuted === 'function' && typeof 播放器API.unMute === 'function') {
                    if (播放器API.isMuted()) {
                        播放器API.unMute();
                        logInfo('广告时段静音：保护性取消静音');
                    }
                }
            } else {
                const 视频 = document.querySelector('#movie_player video') || document.querySelector('.html5-video-player video');
                if (!视频) return;
                if (目标音量 !== null && Math.abs(视频.volume - 目标音量) > 0.01) {
                    视频.volume = 目标音量;
                    logInfo('广告时段静音：保护性恢复音量（video 元素）');
                }
                if (目标静音 === false && 视频.muted) {
                    视频.muted = false;
                    logInfo('广告时段静音：保护性取消静音（video 元素）');
                }
            }
        }, 500);
    }

    // ===== 统计信息面板优化：汉化 + 网速单位转换 =====
    // 「详细统计信息」面板（.html5-video-info-panel）出现时：
    //   1. 将主要术语汉化（仅当「统计信息汉化」开关开启）
    //   2. 在「连接速度」后追加 MB/s 显示（仅当「网速单位转换」开关开启）
    //   3. 监听网速数值变化，实时刷新 MB/s
    const 转换显示ID = 'nextshield-speed-mbps-display';
    const 转换显示色 = '#42a5f5'; // Material Design Blue

    const 统计面板汉化字典 = {
        'Video ID / sCPN': '视频 ID / 会话标识',
        'Viewport / Frames': '视窗口 / 丢帧统计',
        'Current / Optimal Res': '当前 / 最佳分辨率',
        'Volume / Normalized': '音量 / 响度标准化',
        'Codecs': '视频 / 音频编码格式',
        'Color': '色彩特性',
        'Connection Speed': '连接速度',
        'Network Activity': '网络活动',
        'Buffer Health': '缓冲时长',
        'Live Latency': '直播延迟',
        'Live Mode': '直播模式',
        'Mystery Text': '开发调试参数', // YouTube 工程师留下的彩蛋
        'Date': '日期',
        'Audio / Video': '音频 / 视频',
        'Protected': '受保护内容'
    };

    // 把 Kbps 字符串转成 MB/s 字符串（Kbps ÷ 8 ÷ 1024）
    function 转换Kbps为MBps(kbps字符串) {
        const kbps = parseInt(kbps字符串.replace(/[^0-9]/g, ''), 10);
        if (isNaN(kbps)) return null;
        return (kbps / 8 / 1024).toFixed(2);
    }

    // 在「连接速度」数值后追加 / 更新 MB/s 显示；关闭开关时移除已添加的显示元素
    function 更新网速显示(数值节点) {
        if (!数值节点) return;
        if (!选项.网速单位转换) {
            const 旧显示 = document.getElementById(转换显示ID);
            if (旧显示) 旧显示.remove();
            return;
        }

        const 原文本 = 数值节点.textContent;
        if (!/\d/.test(原文本)) return;

        const mbps值 = 转换Kbps为MBps(原文本);
        if (mbps值 === null) return;

        let 显示元素 = document.getElementById(转换显示ID);
        if (!显示元素) {
            显示元素 = document.createElement('span');
            显示元素.id = 转换显示ID;
            显示元素.style.marginLeft = '8px';
            显示元素.style.color = 转换显示色;
            显示元素.style.fontWeight = 'bold';
            显示元素.style.whiteSpace = 'nowrap';
            // 挂到「连接速度」那一行（数值节点的祖父级）
            if (数值节点.parentElement && 数值节点.parentElement.parentElement) {
                数值节点.parentElement.parentElement.appendChild(显示元素);
            }
        }
        显示元素.textContent = `${mbps值} MB/s`;
    }

    // 汉化面板：用 TreeWalker 高效遍历文本节点，命中字典则替换
    function 汉化统计面板(面板节点) {
        if (!选项.统计信息汉化) return;
        const walker = document.createTreeWalker(面板节点, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            const 文本 = node.nodeValue.trim();
            for (const [英文, 中文] of Object.entries(统计面板汉化字典)) {
                // Label 和 Value 通常是分开的节点，用全等 / 前缀匹配防止误伤数值
                if (文本 === 英文 || 文本.startsWith(英文 + ' ')) {
                    node.nodeValue = node.nodeValue.replace(英文, 中文);
                    break;
                }
            }
        }
    }

    // 已处理过的面板集合，避免对同一面板重复绑定 MutationObserver
    const 已处理面板 = new WeakSet();

    // 处理单个统计面板：汉化 + 网速转换 + 绑定观察者
    function 处理统计面板(面板节点) {
        // 1. 汉化
        汉化统计面板(面板节点);

        // 2. 定位「连接速度 / Connection Speed」行（兼容已汉化状态）
        const xpath = ".//div[contains(text(), 'Connection Speed') or contains(text(), '连接速度')]";
        const 标签节点 = document.evaluate(xpath, 面板节点, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (标签节点 && 标签节点.nextElementSibling) {
            const 数值节点 = 标签节点.nextElementSibling.querySelector('span:nth-child(2)')
                || 标签节点.nextElementSibling.querySelector('span');
            if (数值节点) {
                更新网速显示(数值节点);
                // 仅在每个面板上绑定一次观察者，监听网速数值变化
                if (!已处理面板.has(面板节点)) {
                    已处理面板.add(面板节点);
                    const 观察器 = new MutationObserver(() => 更新网速显示(数值节点));
                    观察器.observe(数值节点, { characterData: true, childList: true, subtree: true });
                }
            }
        }
    }

    // 扫描页面上所有统计面板并处理（关闭开关时也会撤销已添加的 MB/s 显示）
    function 扫描统计信息面板() {
        document.querySelectorAll('.html5-video-info-panel').forEach(处理统计面板);
    }

    // ===== 预测倒赞数据（参考 Anarios/return-youtube-dislike 实现） =====
    // YouTube 自 2021 年底起默认隐藏倒赞数。本模块调用 RYD 公共 API
    //   GET https://returnyoutubedislikeapi.com/votes?videoId=<ID>&likeCount=<点赞数>
    // 拿到 dislikes（API 依据扩展用户上报 + 早期抓取数据预测/还原），再把它注入到
    // 倒赞按钮旁，行为与官方 return-youtube-dislike 扩展一致。
    //
    // 注入策略与 RYD 完全一致：
    //   - 新版倒赞按钮默认只有图标、没有文本容器 → 克隆点赞按钮的文本容器模板插入；
    //   - 操作栏宽窄两种尺寸（segmented-buttons），需把按钮形态从「图标」改为「图标+文字」；
    //   - 在操作栏下方再插一条赞/倒赞比例条（可由「倒赞比例条」开关单独控制）。
    const RYD_API基础 = 'https://returnyoutubedislikeapi.com';
    const 倒赞文本标记 = 'data-ns-dislike-text'; // 标记我们注入的倒赞文本容器
    const 比例条标记 = 'data-ns-ratebar'; // 标记我们注入的比例条
    const 倒赞缓存 = new Map(); // 视频ID → { dislikes, likes, rating, fetchedAt }
    let 倒赞当前视频ID = null;
    let 倒赞拉取中ID = null; // 正在发起请求的视频ID，防止并发重复请求
    let 倒赞拉取定时器 = null;
    let 倒赞注入观察器 = null;

    // 千分位格式化：与 RYD 一致，按当前语言用 Intl 格式化整数
    function 格式化数字(数值) {
        return new Intl.NumberFormat(navigator.language || 'en').format(数值);
    }

    // 从 URL 里提取视频 ID（兼容 watch、embed、shorts）
    function 提取视频ID() {
        try {
            const url = new URL(location.href);
            if (url.searchParams.get('v')) return url.searchParams.get('v');
            const m = url.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/);
            if (m) return m[1];
        } catch (e) { }
        return null;
    }

    function 是否Shorts() {
        return location.pathname.startsWith('/shorts');
    }

    // ===== 选择器（完全沿用 RYD 4.x 的 DEFAULT_SELECTORS） =====
    // RYD 把所有选择器集中在 state.js 的 DEFAULT_SELECTORS 里，YouTube 改版时只改这一处。
    // 这里复制其桌面端核心选择器，保证与官方扩展命中同一批节点。
    const 倒赞选择器表 = {
        操作栏: '#top-level-buttons-computed, #top-level-buttons',
        点赞按钮: [
            '#top-level-buttons-computed like-button-view-model', // 限定在操作栏内，避免匹配全屏内隐藏元素
            '#segmented-like-button',
            'like-button-view-model'
        ],
        倒赞按钮: [
            '#top-level-buttons-computed dislike-button-view-model', // 限定在操作栏内，避免匹配全屏内隐藏元素
            '#segmented-dislike-button',
            'dislike-button-view-model'
        ],
        原生按钮: 'button',
        // 文字容器模板：点赞按钮里承载点赞数的节点，克隆给倒赞按钮
        文本模板: [
            '.yt-spec-button-shape-next__button-text-content',
            '.ytSpecButtonShapeNextButtonTextContent',
            'button > div[class*="cbox"]'
        ],
        文本模板父: [
            'div > span[role="text"]',
            'button > div.yt-spec-button-shape-next__button-text-content > span[role="text"]'
        ],
        // 形态切换：移除「纯图标」类，加上「图标前置」类，让文字得以显示
        图标按钮类: ['yt-spec-button-shape-next--icon-button', 'ytSpecButtonShapeNextIconButton', 'ytSpecButtonShapeNextOverrideSmallSizeIcon'],
        图标前置类: ['yt-spec-button-shape-next--icon-leading', 'ytSpecButtonShapeNextIconLeading'],
        点赞数节点: ['yt-formatted-string#text', 'button']
    };

    // 多选择器容错查询：依次尝试列表里的选择器，返回第一个命中节点
    function 多选查询(选择器列表, 父节点) {
        const 根 = 父节点 || document;
        for (const 选择器 of 选择器列表) {
            try {
                const 节点 = 根.querySelector(选择器);
                if (节点) return 节点;
            } catch (e) { /* 选择器语法异常时跳过 */ }
        }
        return null;
    }

    function 获取操作栏() {
        return document.querySelector(倒赞选择器表.操作栏);
    }

    function 获取点赞按钮() {
        return 多选查询(倒赞选择器表.点赞按钮);
    }

    function 获取倒赞按钮() {
        return 多选查询(倒赞选择器表.倒赞按钮);
    }

    // 按钮（容器）内部真正的 <button> 元素，文字要插到这里面
    function 获取原生按钮(按钮容器) {
        if (!按钮容器) return null;
        return 按钮容器.querySelector(倒赞选择器表.原生按钮);
    }

    // 取文字容器模板（点赞按钮里的文本节点），克隆给倒赞用
    function 获取文本模板(点赞按钮) {
        if (!点赞按钮) return null;
        let 模板 = 多选查询(倒赞选择器表.文本模板, 点赞按钮);
        if (模板) return 模板;
        const 父 = 多选查询(倒赞选择器表.文本模板父, 点赞按钮);
        return 父 ? 父.parentNode : null;
    }

    // 在倒赞按钮内查找我们已注入的文本节点（用 data 属性标记，避免与点赞文本混淆）
    // 只在原生 <button> 内查找，不在容器上兜底（容器兜底会导致注入到错误位置时仍误判为"已注入"）
    function 获取倒赞文本节点(倒赞按钮) {
        if (!倒赞按钮) return null;
        const 原生按钮 = 获取原生按钮(倒赞按钮);
        if (!原生按钮) return null;
        return 原生按钮.querySelector('[' + 倒赞文本标记 + ']');
    }

    // 读取当前页面的点赞数：优先从点赞按钮 aria-label 解析（RYD 的做法，比 textContent 准确）
    function 读取点赞数() {
        const 点赞按钮 = 获取点赞按钮();
        if (!点赞按钮) return 0;
        const 原生 = 获取原生按钮(点赞按钮) || 点赞按钮;
        const 标签 = 原生.getAttribute('aria-label') || '';
        // aria-label 形如 "点赞 1.2万 次" / "1,234 likes"
        const 纯数字 = 标签.replace(/[^\dKkMmBb万亿億.]/g, ' ').trim();
        const 简写 = 解析点赞简写(纯数字.split(/\s+/).pop() || 标签);
        if (简写 > 0) return 简写;
        // 兜底：从可见文本解析
        const 模板 = 获取文本模板(点赞按钮);
        return 解析点赞简写((模板?.textContent || '').trim());
    }

    // 把 "1.2K"、"3.4M"、"1.5万"、"1.2億" 这类简写解析为整数
    function 解析点赞简写(文本) {
        if (!文本) return 0;
        const 匹配 = String(文本).match(/([\d.,]+)\s*([KMB万億亿]?)/i);
        if (!匹配) return parseInt(String(文本).replace(/[^\d]/g, ''), 10) || 0;
        const 基数 = parseFloat(匹配[1].replace(/,/g, ''));
        if (isNaN(基数)) return 0;
        const 后缀 = 匹配[2].toLowerCase();
        if (后缀 === 'k') return Math.round(基数 * 1e3);
        if (后缀 === 'm') return Math.round(基数 * 1e6);
        if (后缀 === 'b') return Math.round(基数 * 1e9);
        if (后缀 === '万') return Math.round(基数 * 1e4);
        if (后缀 === '亿' || 后缀 === '億') return Math.round(基数 * 1e8);
        return Math.round(基数);
    }

    // 调用 RYD API，返回 { dislikes, likes, rating, viewCount } 或 null（失败）
    async function 拉取倒赞数据(视频ID) {
        if (!视频ID) return null;
        const 缓存 = 倒赞缓存.get(视频ID);
        // 10 分钟内复用缓存，减少对 RYD 服务器的请求压力
        if (缓存 && Date.now() - 缓存.fetchedAt < 10 * 60 * 1000) {
            logInfo('命中倒赞缓存:', 视频ID, 缓存);
            return 缓存;
        }
        try {
            const 点赞数 = 读取点赞数() || 0;
            const 请求地址 = `${RYD_API基础}/votes?videoId=${encodeURIComponent(视频ID)}&likeCount=${点赞数}`;
            logInfo('请求 RYD API:', 请求地址);
            const 响应 = await fetch(请求地址, { method: 'GET' });
            if (!响应.ok) throw new Error('HTTP ' + 响应.status);
            const 数据 = await 响应.json();
            if (typeof 数据.dislikes !== 'number') throw new Error('返回缺少 dislikes');
            const 结果 = {
                dislikes: 数据.dislikes,
                likes: typeof 数据.likes === 'number' ? 数据.likes : 0,
                rating: 数据.rating || null,
                fetchedAt: Date.now()
            };
            倒赞缓存.set(视频ID, 结果);
            logInfo('RYD 返回:', 视频ID, 结果);
            return 结果;
        } catch (错误) {
            logWarn('RYD API 请求失败:', 视频ID, 错误.message);
            // 失败也记一条短缓存，避免高频重试
            if (!倒赞缓存.has(视频ID)) 倒赞缓存.set(视频ID, { 失败: true, fetchedAt: Date.now() });
            return null;
        }
    }

    // 多选择器版本的等待节点
    function 等待多选(选择器列表, timeout = 5000) {
        return new Promise((resolve) => {
            const 已存在 = 多选查询(选择器列表);
            if (已存在) return resolve(已存在);
            const 观察器 = new MutationObserver(() => {
                const 节点 = 多选查询(选择器列表);
                if (节点) { 观察器.disconnect(); resolve(节点); }
            });
            观察器.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { 观察器.disconnect(); resolve(null); }, timeout);
        });
    }

    // 把倒赞按钮从「纯图标」改造成「图标+文字」，文字容器克隆自点赞按钮（与 RYD createDislikeTextContainer 同源）
    // 兜底：首次加载时点赞按钮的文字模板可能尚未渲染，此时手动创建与 YouTube 新版一致的文字容器
    // 关键策略：用 inline !important 样式强制文字可见，避免依赖 class 切换（YouTube Lit 框架会回退 class）
    function 创建倒赞文本容器(点赞按钮, 倒赞按钮) {
        if (!点赞按钮 || !倒赞按钮) return null;
        let 模板 = 获取文本模板(点赞按钮);
        let 克隆;

        if (模板) {
            克隆 = 模板.cloneNode(true);
            克隆.setAttribute(倒赞文本标记, '');
            克隆.textContent = '';
        } else {
            克隆 = document.createElement('div');
            克隆.className = 'ytSpecButtonShapeNextButtonTextContent ytSpecButtonShapeNextElevatedContent';
            克隆.setAttribute(倒赞文本标记, '');
        }

        // 用 inline !important 强制可见，不依赖按钮 class 模式
        // YouTube Lit 框架 hydration 期间可能频繁将按钮从 IconLeading 回退到 IconButton，
        // 仅靠 class 切换不可靠；inline style 最高优先级，确保文字始终渲染。
        克隆.style.setProperty('display', 'flex', 'important');
        克隆.style.setProperty('align-items', 'center', 'important');
        克隆.style.setProperty('height', '100%', 'important');
        克隆.style.setProperty('padding', '0 4px', 'important');
        克隆.style.setProperty('font-size', '14px', 'important');
        克隆.style.setProperty('font-weight', '500', 'important');

        const 原生按钮 = 获取原生按钮(倒赞按钮);
        if (!原生按钮) return null;

        // 插入到 SVG 图标之后、touch-feedback 之前（比 appendChild 更稳定）
        const 反馈区 = 原生按钮.querySelector('yt-touch-feedback-shape');
        if (反馈区) {
            原生按钮.insertBefore(克隆, 反馈区);
        } else {
            原生按钮.appendChild(克隆);
        }

        // 形态切换（best-effort，不做硬依赖）
        更新倒赞按钮形状(原生按钮);
        return 克隆;
    }

    // RYD updateDislikeButtonShape：用类名增删改变按钮形态（不是改 attribute）
    function 更新倒赞按钮形状(按钮) {
        if (!按钮) return;
        for (const 类名 of 倒赞选择器表.图标按钮类) 按钮.classList.remove(类名);
        for (const 类名 of 倒赞选择器表.图标前置类) 按钮.classList.add(类名);
    }

    // 还原按钮形态（关闭功能时调用）
    function 还原倒赞按钮形状(按钮) {
        if (!按钮) return;
        for (const 类名 of 倒赞选择器表.图标前置类) 按钮.classList.remove(类名);
        for (const 类名 of 倒赞选择器表.图标按钮类) 按钮.classList.add(类名);
    }

    // 创建比例条（结构与 id 与 RYD bar.js 完全一致，复用其 content-style.css 样式）
    // 注意：必须用 createElement 构建，不能用 insertAdjacentHTML——
    //       YouTube 启用了 CSP「require-trusted-types-for 'script'」，原始字符串赋给
    //       insertAdjacentHTML 会被 Trusted Types 拦截并抛错。
    function 创建比例条(点赞数, 倒赞数) {
        const 点赞按钮 = 获取点赞按钮();
        const 倒赞按钮 = 获取倒赞按钮();
        // 比例条宽度 = 点赞按钮宽 + 倒赞按钮宽
        let 宽度px = 100;
        try {
            if (点赞按钮 && 倒赞按钮) {
                宽度px = parseFloat(window.getComputedStyle(点赞按钮).width)
                    + parseFloat(window.getComputedStyle(倒赞按钮).width);
            }
        } catch (e) { }
        const 总数 = 点赞数 + 倒赞数;
        const 点赞比 = 总数 > 0 ? (点赞数 / 总数) * 100 : 50;
        const 倒赞比 = 总数 > 0 ? (倒赞数 / 总数) * 100 : 50;
        const 提示文本 = 格式比例提示(点赞数, 倒赞数, 点赞比, 倒赞比);

        let 容器 = document.querySelector('[' + 比例条标记 + ']');
        if (容器) {
            // 已存在则更新宽度、比例与悬停提示
            容器.style.width = 宽度px + 'px';
            const 条 = 容器.querySelector('#ryd-bar');
            if (条) 条.style.width = 点赞比.toFixed(2) + '%';
            const 条容器 = 容器.querySelector('.ryd-tooltip-bar-container');
            if (条容器) 条容器.title = 提示文本;
            return 容器;
        }

        // 首次创建：用 DOM API 逐个 createElement 构建，规避 Trusted Types
        const 新设计 = !!document.getElementById('comment-teaser');
        容器 = document.createElement('div');
        容器.className = 'ryd-tooltip ' + (新设计 ? 'ryd-tooltip-new-design' : 'ryd-tooltip-old-design');
        容器.setAttribute(比例条标记, '');
        容器.style.width = 宽度px + 'px';

        const 条容器 = document.createElement('div');
        条容器.className = 'ryd-tooltip-bar-container';
        条容器.title = 提示文本;

        const 外条 = document.createElement('div');
        外条.id = 'ryd-bar-container';
        外条.style.width = '100%';
        外条.style.height = '2px';

        const 内条 = document.createElement('div');
        内条.id = 'ryd-bar';
        内条.style.width = 点赞比.toFixed(2) + '%';
        内条.style.height = '100%';

        外条.appendChild(内条);
        条容器.appendChild(外条);
        容器.appendChild(条容器);

        const 操作栏 = 获取操作栏();
        (操作栏 || document.body).appendChild(容器);
        return 容器;
    }

    // 统一格式化比例条提示文本：
    //   只要该方数量 > 0，其百分比就至少显示 1%（向上取整，避免 0.24% 被抹成 0% 造成误导）；
    //   对应另一方则至多 99%，保证两者相加恒为 100%。
    function 格式比例提示(点赞数, 倒赞数, 点赞比, 倒赞比) {
        let 赞显示 = Math.round(点赞比);
        let 倒显示 = Math.round(倒赞比);
        // 有倒赞却不占整 1% → 拔到 1%，赞相应让出
        if (倒赞数 > 0 && 倒显示 === 0) { 倒显示 = 1; 赞显示 = 99; }
        // 有赞却不占整 1% → 拔到 1%，倒相应让出
        if (点赞数 > 0 && 赞显示 === 0) { 赞显示 = 1; 倒显示 = 99; }
        // 两边都为 0 时回退到 50/50，避免出现 0% / 0%
        if (赞显示 === 0 && 倒显示 === 0) { 赞显示 = 50; 倒显示 = 50; }
        return `${格式化数字(点赞数)} / ${格式化数字(倒赞数)}（赞 ${赞显示}% · 倒赞 ${倒显示}%）`;
    }

    // 取用于比例条的点赞数：只使用 RYD API 返回值
    function 取比例条点赞数(数据) {
        if (Number.isFinite(数据?.likes)) {
            return 数据.likes;
        }
        return 0;
    }

    function 移除倒赞比例条() {
        document.querySelectorAll('[' + 比例条标记 + ']').forEach(节点 => 节点.remove());
    }

    // 关闭功能时，清理所有已注入的痕迹
    function 清除倒赞注入() {
        倒赞当前视频ID = null;
        移除倒赞比例条();
        // 移除注入的倒赞文本，并还原按钮形态
        document.querySelectorAll('[' + 倒赞文本标记 + ']').forEach(节点 => {
            const 按钮 = 节点.closest('button') || 节点.parentElement;
            节点.remove();
            if (按钮) 还原倒赞按钮形状(按钮);
        });
        if (倒赞注入观察器) { 倒赞注入观察器.disconnect(); 倒赞注入观察器 = null; }
        if (倒赞拉取定时器) { clearTimeout(倒赞拉取定时器); 倒赞拉取定时器 = null; }
        if (倒赞注入防抖定时器) { clearTimeout(倒赞注入防抖定时器); 倒赞注入防抖定时器 = null; }
        if (倒赞重连定时器) { clearTimeout(倒赞重连定时器); 倒赞重连定时器 = null; }
        logInfo('已清除预测倒赞注入');
    }

    // 主入口：判定页面是否为视频页，决定是否拉取并注入
    async function 处理预测倒赞() {
        if (!选项.预测倒赞数据) return;
        const 视频ID = 提取视频ID();
        if (!视频ID) return; // 非视频页（首页/搜索/频道）不处理

        // Shorts 页面：操作栏结构与普通视频不同，单独走简化逻辑
        if (是否Shorts()) {
            await 处理Shorts倒赞(视频ID);
            return;
        }

        if (倒赞当前视频ID === 视频ID) {
            // 同一视频：仅当 YouTube 重渲染清空了倒赞文本时才补写，避免高频 DOM 写入
            修复倒赞文本();
            return;
        }
        倒赞当前视频ID = 视频ID;

        // 防止并发：同一视频只在拉取完成后才允许下一次
        if (倒赞拉取中ID === 视频ID) return;
        倒赞拉取中ID = 视频ID;

        const 数据 = await 拉取倒赞数据(视频ID);
        倒赞拉取中ID = null;
        if (!数据 || 数据.失败) return;

        // 等倒赞按钮容器就绪（点赞按钮用于克隆文字模板，倒赞按钮用于挂文本）
        // 这里只等「容器渲染出来」这一刻，之后改写都由周期/观察器兜底，
        // 不再把按钮引用长期缓存进闭包（避免节点被替换后引用失效）。
        const 倒赞按钮 = await 等待多选(倒赞选择器表.倒赞按钮, 4000);
        if (!倒赞按钮) { logInfo('未找到倒赞按钮，跳过注入（等待周期定时器重试）'); return; }

        注入倒赞(数据);
    }

    // 统一的「按数据把倒赞同步到前台 DOM」：每次都重新查询点赞/倒赞按钮，绝不持有旧引用。
    // 原因：YouTube 用 Polymer 重渲染时会把整个按钮节点替换掉，旧的按钮引用会变成脱离 DOM
    // 的死节点，注入到死节点上的文字/比例条页面上根本看不到——这正是「日志显示已注入、数据也有、
    // 但前台时有时无」的根因。返回 true 表示本轮实际改写了 DOM（供观察器抑制重入）。
    let 倒赞同步中 = false;
    function 同步倒赞注入(数据) {
        if (!数据 || 数据.失败) return false;

        const 点赞按钮 = 获取点赞按钮();
        const 倒赞按钮 = 获取倒赞按钮();
        if (!倒赞按钮) return false; // 按钮尚未渲染出来，等下一轮周期/防抖重试

        let 写入 = false;
        const 期望文本 = 格式化数字(数据.dislikes);

        // 1. 倒赞文字容器：没有就克隆点赞按钮的文字模板，有就校正文本
        let 文本节点 = 获取倒赞文本节点(倒赞按钮);
        if (!文本节点) {
            if (!点赞按钮) return false; // 拿不到文字模板，等下一轮
            文本节点 = 创建倒赞文本容器(点赞按钮, 倒赞按钮);
            if (文本节点) 写入 = true;
        }
        if (文本节点) {
            if (文本节点.textContent !== 期望文本 || 文本节点.hasAttribute('is-empty')) {
                文本节点.textContent = 期望文本;
                文本节点.removeAttribute('is-empty'); // RYD 同款：去掉空标记让文字显示
                写入 = true;
            }
            // 形态兜底：重渲染后「图标+文字」类名会丢，文字又被藏起来，每次都补一遍
            更新倒赞按钮形状(获取原生按钮(倒赞按钮) || 倒赞按钮);
        }

        // 2. 比例条（开关控制）：已存在则刷新宽度/比例，缺失则重建
        if (选项.倒赞比例条) {
            创建比例条(取比例条点赞数(数据), 数据.dislikes);
        }
        return 写入;
    }

    // 注入倒赞文本 + 比例条（首次拉取到数据后调用）
    function 注入倒赞(数据) {
        const 写入 = 同步倒赞注入(数据);
        if (写入) {
            显示通知('已预测倒赞数据 👎', 'success', 2000);
            logOk('倒赞已注入:', 格式化数字(数据.dislikes));
        } else {
            logInfo('倒赞注入本轮跳过：按钮未就绪或已是正确状态');
        }
        // 绑定持久化观察器，YouTube 重渲染后由它 + 周期定时器负责补写
        绑定倒赞注入观察器();
    }

    // 同视频情况下：把缓存里的倒赞重新同步到前台（按钮被重渲染清空时补回）
    function 修复倒赞文本() {
        const 视频ID = 倒赞当前视频ID;
        if (!视频ID) return;
        const 缓存 = 倒赞缓存.get(视频ID);
        if (!缓存 || 缓存.失败) return;
        同步倒赞注入(缓存);
        绑定倒赞注入观察器(); // 幂等：观察目标没变就直接 return，变了才重新挂到新节点
    }

    // 持久化观察器：挂在「操作栏按钮容器」这个相对稳定的祖先上。
    // 策略：注入完成后断开观察器 → 延迟重连，避免自身 DOM 修改触发立即重入。
    let 倒赞注入防抖定时器 = null;
    let 倒赞重连定时器 = null;
    function 绑定倒赞注入观察器() {
        const 观察目标 = 获取操作栏()
            || document.querySelector('ytd-menu-renderer.ytd-watch-metadata');
        if (!观察目标) return;

        if (倒赞注入观察器 && 倒赞注入观察器.观察目标 === 观察目标) return;

        if (倒赞注入观察器) 倒赞注入观察器.disconnect();
        const 观察器 = new MutationObserver(() => {
            if (倒赞同步中) return;
            clearTimeout(倒赞注入防抖定时器);
            倒赞注入防抖定时器 = setTimeout(() => {
                const 视频ID = 倒赞当前视频ID;
                if (!视频ID) return;
                const 缓存 = 倒赞缓存.get(视频ID);
                if (!缓存 || 缓存.失败) return;
                // 注入前先断开观察器，防止自身写入触发回环
                if (倒赞注入观察器) 倒赞注入观察器.disconnect();
                倒赞同步中 = true;
                try { 同步倒赞注入(缓存); } finally { 倒赞同步中 = false; }
                // 延迟重连观察器
                clearTimeout(倒赞重连定时器);
                倒赞重连定时器 = setTimeout(() => {
                    if (观察目标.isConnected) {
                        观察器.观察目标 = 观察目标;
                        观察器.observe(观察目标, { childList: true, subtree: true });
                    }
                }, 300);
            }, 50);
        });
        观察器.观察目标 = 观察目标;
        观察器.observe(观察目标, { childList: true, subtree: true, characterData: true });
        倒赞注入观察器 = 观察器;
    }

    // Shorts 页面：右侧只有一组图标按钮，没有可克隆的文字容器。
    // 在倒赞按钮下挂一个文字节点显示倒赞数。
    async function 处理Shorts倒赞(视频ID) {
        if (倒赞拉取中ID === 视频ID) return;
        倒赞拉取中ID = 视频ID;
        const 数据 = await 拉取倒赞数据(视频ID);
        倒赞拉取中ID = null;
        if (!数据 || 数据.失败) return;

        const 倒赞按钮 = await 等待多选(倒赞选择器表.倒赞按钮, 4000);
        if (!倒赞按钮) return;

        // 在按钮容器下挂一个文字节点显示倒赞数
        let 文本 = 倒赞按钮.querySelector('.shorts-dislike-count');
        if (!文本) {
            文本 = document.createElement('div');
            文本.className = 'shorts-dislike-count';
            文本.style.cssText = 'text-align:center;font-size:12px;color:var(--yt-spec-text-secondary,#aaa);margin-top:-6px;line-height:1.5;';
            倒赞按钮.appendChild(文本);
        }
        文本.textContent = 格式化数字(数据.dislikes);
        logOk('Shorts 倒赞已注入:', 格式化数字(数据.dislikes));
    }

    // SPA 切换视频时重置倒赞状态
    function 倒赞导航重置() {
        倒赞当前视频ID = null;
        倒赞拉取中ID = null;
        if (倒赞注入观察器) { 倒赞注入观察器.disconnect(); 倒赞注入观察器 = null; }
        // 延后处理，给 YouTube 一点时间渲染新页面的按钮
        if (选项.预测倒赞数据) {
            clearTimeout(倒赞拉取定时器);
            倒赞拉取定时器 = setTimeout(处理预测倒赞, 600);
        }
    }

    // ===== 绕过年龄限制 =====
    function 绕过年龄限制() {
        if (!选项.年龄限制绕过) return;
        const 年龄关键词 = /年龄|年龄限制|年龄验证|age\s*restriction|age-?restricted|confirm\s*your\s*age|verify\s*your\s*age|must be \d+|18\+|未满\s*18|成年/i;
        const 年龄弹窗 = Array.from(document.querySelectorAll('ytd-enforcement-message-view-model')).find(弹窗 => {
            const 文本 = (弹窗.innerText || '').replace(/\s+/g, ' ').trim();
            const 是年龄提示 = 年龄关键词.test(文本);
            const 是广告拦截提示 = /adblock|allow\s*ads|blocker|ads\s*violate|使用广告拦截器|广告拦截器|允许展示 YouTube 广告|试用 YouTube Premium|将无法播放视频|报告问题/i.test(文本);
            return 是年龄提示 && !是广告拦截提示;
        });
        const 视频 = document.querySelector('video');

        if (年龄弹窗) {
            年龄弹窗.remove();
            记录拦截('年龄限制绕过');
            显示通知('已绕过年龄限制', 'success');
        }

        // 若视频被年龄限制卡住无法播放，则跳转到无 Cookie 嵌入页播放
        if (视频 && 视频.paused && 视频.readyState === 0) {
            const 被年龄拦截 = !!document.querySelector('ytd-player .ytd-watch-flexy[ad-blocked]');
            const 视频ID = new URLSearchParams(window.location.search).get('v');
            if (被年龄拦截 && 视频ID) {
                window.location.href = `https://www.youtube-nocookie.com/embed/${视频ID}?autoplay=1`;
            }
        }
    }

    // ===== 移除页面上的广告横幅 / 商品推荐 / 信息流广告等 =====
    // 反检测：#player-ads、ytd-ad-slot-renderer 等播放器内广告容器不从此处移除——
    // YouTube 会校验这些元素是否真实渲染，元素消失即判定为被拦截。
    // 仅清理主页/侧栏/信息流中的横幅广告（这些不影响播放器校验）。
    function 移除广告横幅() {
        if (!选项.广告横幅移除) return;
        const 选择器列表 = [
            // 安全移除：以下元素为页面上独立的横幅/推广位，非播放器广告容器
            '#masthead-ad',
            '.ytp-ad-overlay-container',
            '.ytp-ad-image-overlay', '.yt-mealbar-promo-renderer',
            '.ytp-featured-product', 'ytd-merch-shelf-renderer', 'ytd-in-feed-ad-layout-renderer'
        ];

        let 移除数量 = 0;
        选择器列表.forEach(选择器 => {
            document.querySelectorAll(选择器).forEach(元素 => {
                元素.remove();
                移除数量++;
            });
        });

        // 单独处理 engagement 面板：评论区一律保留，其余仅当确含广告/赞助内容才删。
        document.querySelectorAll('ytd-engagement-panel-section-list-renderer').forEach(面板 => {
            // ① 目标 ID 命中评论区 → 保留（Shorts 与普通视频的评论都依赖它）
            const 目标ID = 面板.getAttribute('target-id') || '';
            if (目标ID.includes('comment')) return;
            // ② 面板里已渲染出评论组件 → 同样保留，防止评论区加载完成后再被误删
            if (面板.querySelector(
                'ytd-comments, ytd-comments-header-renderer, ' +
                'ytd-comment-thread-renderer, ytd-comment-renderer, ' +
                'ytd-shorts-comment-thread-renderer'
            )) return;
            // ③ 其余面板：只有内含广告 / 赞助推广标记时才移除
            const 含广告 = 面板.querySelector(
                'ytd-ads-engagement-panel-content-renderer, ytd-ad-slot-renderer, ' +
                'ytd-compact-promoted-video-renderer, ytd-promoted-sparkles-web-renderer'
            ) || /赞助|sponsored/i.test(面板.textContent || '');
            if (含广告) {
                面板.remove();
                移除数量++;
            }
        });

        if (移除数量 > 0) {
            记录拦截('广告横幅移除', 移除数量);
            显示通知(`已移除 ${移除数量} 个广告横幅`, 'ad-blocked');
        }
    }

    // ===== 防止视频被广告暂停（广告期间自动续播） =====
    // 跨广告过渡保护：仅在正片播放期间被广告打断时才恢复，
    // 避免在广告与广告之间（油管广告段内部切换）重复触发，导致计数虚增。
    let _自动恢复最后播放状态 = false;
    function 保持视频自动播放() {
        if (!选项.自动恢复播放) return;
        const 视频 = document.querySelector('video');
        if (!视频) return;

        // 持续记录正片播放状态（仅在非广告期间）
        const 播放器 = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (!播放器处于广告状态(播放器) && !视频.paused) {
            _自动恢复最后播放状态 = true;
        }

        if (视频.dataset.已设置自动续播) return;

        视频.dataset.已设置自动续播 = "true";

        视频.addEventListener('pause', () => {
            if (!选项.自动恢复播放) return;
            const 播放器 = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
            if (!播放器处于广告状态(播放器)) return;
            // 仅在正片之前正在播放时才恢复（排除广告段内部的连续暂停）
            if (!_自动恢复最后播放状态) return;
            视频.play().then(() => {
                记录拦截('自动恢复播放');
            }).catch(错误 => {
                logWarn('无法自动播放:', 错误);
            });
        });
    }

    // ===== YouTube SPA 切换视频后重置一次性状态 =====
    function 页面导航重置() {
        画质已提升 = false; // 新视频需要重新提升画质
        已绑定播放器 = null;
        恢复音量(); // 恢复音量状态（防止跨视频残留静音）
        同步广告过滤状态();
        倒赞导航重置(); // 新视频需重新预测倒赞
    }

    // ===== 初始化 =====
    let 已初始化 = false;
    function 初始化() {
        if (已初始化) return;
        已初始化 = true;

        try {
            加载选项();
            加载统计();
            应用增强样式();
            同步广告过滤状态();
            const 面板已建 = 创建统计面板();
            if (!面板已建) logWarn('面板暂未创建：body 尚未就绪，将由 MutationObserver / 兜底定时器重建');

            // 欢迎提示（面板本身已常驻，这里只是顺带弹一下）
            setTimeout(() => 显示通知('广告拦截已启用 🛡️', 'success', 2500), 800);

            // 首次进入视频页时拉取一次倒赞（页面已加载完成的情况）
            setTimeout(处理预测倒赞, 1200);

            // 监听 YouTube 单页应用（SPA）的页面切换
            window.addEventListener('yt-navigate-finish', 页面导航重置);
            window.addEventListener('yt-navigate-finish', 绑定播放器广告观察器);
            window.addEventListener('yt-page-data-updated', 绑定播放器广告观察器);

            // DOM 变化监听：页面有新增节点时，防抖后统一清理
            // 加入 ±25ms 随机 jitter，打破固定 debounce 模式
            let 防抖计时器;
            const 观察器 = new MutationObserver(() => {
                clearTimeout(防抖计时器);
                防抖计时器 = setTimeout(() => {
                    创建统计面板(); // 兜底：万一初始化时 body 还没准备好，或被框架移除
                    绑定播放器广告观察器();
                    绕过年龄限制();
                    处理视频广告();
                    移除广告横幅();
                    保持视频自动播放();
                    提升视频画质();
                    扫描统计信息面板(); // 统计信息面板出现时汉化 + 网速转换
                    处理预测倒赞(); // 视频页操作栏出现时拉取并注入倒赞
                }, 50 + Math.floor(Math.random() * 50));
            });
            // 只监听节点增删，不监听属性变化 —— 大幅降低回调频率（核心性能优化）
            观察器.observe(document.body, { childList: true, subtree: true });
            logOk('MutationObserver 已挂载');

            // 兜底定时器：每 500ms 持续拦截广告（防止漏网）
            // 加入 ±100ms 随机 jitter，打破固定间隔的可预测模式
            (function 启动抖动定时器() {
                function 抖动间隔(基准, 范围) {
                    return 基准 + Math.floor(Math.random() * 范围 * 2) - 范围;
                }
                function 主循环() {
                    绑定播放器广告观察器();
                    处理视频广告();
                    移除广告横幅();
                    扫描统计信息面板(); // 统计信息面板出现时汉化 + 网速转换
                    处理预测倒赞(); // 持续确保倒赞数据已注入
                    setTimeout(主循环, 抖动间隔(500, 100));
                }
                setTimeout(主循环, 抖动间隔(500, 100));
            })();

            // 低频兜底：确保面板始终存在（万一被页面移除则重建）
            // 加入 ±500ms jitter
            (function 启动面板抖动定时器() {
                function 面板循环() {
                    创建统计面板();
                    setTimeout(面板循环, 3000 + Math.floor(Math.random() * 1000));
                }
                setTimeout(面板循环, 3000 + Math.floor(Math.random() * 500));
            })();

            logOk('✅ 初始化完成，开始监控');
        } catch (e) {
            logError('初始化失败:', e);
        }
    }

    // ===== 等待 body 就绪（@run-at document-start 时 body 可能还不存在） =====
    // 思路：轮询 100ms，最多等 10 秒；一旦 body 出现立即初始化。
    function 等待并启动() {
        if (document.body) {
            logInfo('body 已就绪，立即初始化');
            初始化();
            return;
        }
        logInfo('body 尚未就绪，开始轮询等待...');
        const 开始时间 = Date.now();
        const 轮询 = setInterval(() => {
            if (document.body) {
                clearInterval(轮询);
                logOk(`body 就绪（等待了 ${Date.now() - 开始时间}ms），开始初始化`);
                初始化();
            } else if (Date.now() - 开始时间 > 10000) {
                clearInterval(轮询);
                logError('等待 body 超时（10 秒），脚本可能无法正常工作');
            }
        }, 100);
    }

    等待并启动();
})();
