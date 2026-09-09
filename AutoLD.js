// ==UserScript==
// @name         Auto Linux Do
// @namespace    https://github.com/YisRime/AutoLD
// @version      1.1.1
// @description  Linux Do 自动化
// @author       YisRime
// @homepage     https://github.com/YisRime/AutoLD
// @supportURL   https://github.com/YisRime/AutoLD/issues
// @match        https://linux.do/*
// @match        https://idcflare.com/*
// @icon         https://www.google.com/s2/favicons?domain=linux.do
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      credit.linux.do
// @connect      connect.linux.do
// @connect      linux.do
// @run-at       document-idle
// @license      AGPLv3
// ==/UserScript==
(function () {
    'use strict';
    // 过盾管理
    if (window.name === 'lda_challenge_window') {
        const checkClose = () => { if (!location.pathname.startsWith('/challenge')) window.close(); };
        checkClose();
        const timer = setInterval(() => {
            if (!location.pathname.startsWith('/challenge')) {
                clearInterval(timer);
                window.close();
            }
        }, 500);
        const checkSuccess = () => setTimeout(() => { checkClose(); setTimeout(window.close, 1000); }, 1000);
        
        const origFetch = window.fetch;
        if (origFetch) {
            window.fetch = async (...args) => {
                const res = await origFetch.apply(window, args);
                try {
                    if (String(args[0]?.url || args[0] || '').includes('/challenge') && res.ok) checkSuccess();
                } catch (_) {}
                return res;
            };
        }
        const origOpen = window.XMLHttpRequest.prototype.open;
        const origSend = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.open = function(m, u) { this._u = u; return origOpen.apply(this, arguments); };
        window.XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', () => {
                try {
                    if (String(this._u).includes('/challenge') && this.status >= 200 && this.status < 400) checkSuccess();
                } catch (_) {}
            });
            return origSend.apply(this, args);
        };
        return;
    }
    // 工具函数
    const Tool = {
        wait: async (ms, r) => {
            const steps = Math.ceil(ms / 50);
            for (let i = 0; i < steps; i++) {
                if (r && !r.active) return false;
                await new Promise(res => setTimeout(res, 50));
            }
            return true;
        },
        rand: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
        bottom: () => Math.ceil(window.scrollY + window.innerHeight) >= document.body.scrollHeight - 200,
        ready: () => !document.querySelector('.loading, .infinite-scroll'),
        topic: () => location.pathname.includes('/t/topic/'),
        identity: () => location.pathname.match(/\/t\/topic\/(\d+)/)?.[1],
        title: () => document.querySelector('#topic-title h1 a')?.innerText,
        isBlueDot(style, rect) {
            if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
            const [w, h, rad] = [parseFloat(style.width) || rect?.width || 0, parseFloat(style.height) || rect?.height || 0, parseFloat(style.borderTopLeftRadius) || 0];
            const isRound = w >= 4 && w <= 20 && h >= 4 && h <= 20 && Math.abs(w - h) <= 6 && rad >= Math.min(w, h) * 0.3;
            if (!isRound) return false;
            return [style.backgroundColor, style.borderColor, style.color].some(c => {
                const m = String(c || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
                return m && (m[4] === undefined ? 1 : Number(m[4])) > 0.35 && Number(m[3]) >= 120 && Number(m[2]) >= 90 && Number(m[1]) <= 80;
            });
        },
        hasUnreadBlueDot() {
            const boxes = document.querySelectorAll('.topic-timeline, .timeline-scrollarea, .timeline-container, .timeline-replies, .topic-navigation');
            return Array.from(boxes).some(b => Array.from(b.querySelectorAll('*')).some(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return false;
                if (this.isBlueDot(window.getComputedStyle(el), rect)) return true;
                return ['::before', '::after'].some(p => {
                    const ps = window.getComputedStyle(el, p);
                    return ps && ps.content !== 'none' && this.isBlueDot(ps, rect);
                });
            }));
        }
    };
    // 防检测
    const Stealth = {
        audioCtx: null,
        isChallenge: () => location.pathname.startsWith('/challenge'),
        openChallenge() {
            const width = 600, height = 700;
            const left = Math.max(0, Math.floor((window.screen.width - width) / 2));
            const top = Math.max(0, Math.floor((window.screen.height - height) / 2));
            return window.open('/challenge', 'lda_challenge_window', `width=${width},height=${height},top=${top},left=${left},toolbar=no,menubar=no`);
        },
        init() {
            if (this.isChallenge()) return;
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const doc = win.document;
            try {
                Object.defineProperty(doc, 'hidden', { get: () => false, configurable: true });
                Object.defineProperty(doc, 'visibilityState', { get: () => 'visible', configurable: true });
                Object.defineProperty(doc, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
                win.hasFocus = () => true;
                doc.hasFocus = () => true;
            } catch (_) {}
            ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'mouseleave'].forEach(evtName => {
                win.addEventListener(evtName, e => e.stopImmediatePropagation(), true);
                doc.addEventListener(evtName, e => e.stopImmediatePropagation(), true);
            });
            setInterval(() => {
                try {
                    doc.dispatchEvent(new MouseEvent('mousemove', {
                        bubbles: true,
                        cancelable: true,
                        view: win,
                        clientX: Tool.rand(100, 300),
                        clientY: Tool.rand(100, 300)
                    }));
                } catch (_) {}
            }, Tool.rand(8000, 15000));
        },
        // 后台保活
        keepAlive() {
            if (this.isChallenge()) return;
            try {
                if (!this.audioCtx) {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (AudioContext) {
                        this.audioCtx = new AudioContext();
                        const osc = this.audioCtx.createOscillator();
                        const gain = this.audioCtx.createGain();
                        gain.gain.value = 0.00001;
                        osc.connect(gain);
                        gain.connect(this.audioCtx.destination);
                        osc.start();
                    }
                }
                if (this.audioCtx?.state === 'suspended') {
                    this.audioCtx.resume();
                }
            } catch (_) {}
        },
        // 保活心跳
        suspendKeepAlive() {
            try {
                if (this.audioCtx?.state === 'running') {
                    this.audioCtx.suspend();
                }
            } catch (_) {}
        },
        // 鼠标点击
        click(el) {
            if (!el) return;
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const rect = el.getBoundingClientRect();
            const baseEvt = {
                bubbles: true,
                cancelable: true,
                view: win,
                clientX: rect.left + rect.width * (0.2 + Math.random() * 0.6),
                clientY: rect.top + rect.height * (0.2 + Math.random() * 0.6),
                screenX: (rect.left + rect.width * 0.5) + (win.screenX || 0),
                screenY: (rect.top + rect.height * 0.5) + (win.screenY || 0)
            };
            ['pointerover', 'mouseover', 'pointerdown', 'mousedown'].forEach(t => {
                el.dispatchEvent(new MouseEvent(t, { ...baseEvt, button: 0, buttons: 1 }));
            });
            if (typeof el.focus === 'function') el.focus();
            ['pointerup', 'mouseup', 'click'].forEach(t => {
                el.dispatchEvent(new MouseEvent(t, { ...baseEvt, button: 0, buttons: 0 }));
            });
        }
    };
    // 限流保护
    const Guard = {
        runner: null,
        get state() { return GM_getValue('lda_guard', { until: 0, tag: '' }); },
        set state(v) { GM_setValue('lda_guard', v); },
        isNormal: () => !!document.querySelector('#main-outlet, .topic-list, .topic-post, .d-header, .ember-application, #discourse-splash') || !!document.querySelector('meta[name="generator"][content*="Discourse"]'),
        isRestricted() { return this.state.until > Date.now(); },
        trigger(sec, tag) {
            if (this.isRestricted()) return;
            const until = Date.now() + sec * 1000;
            this.state = { until, tag };
            const time = new Date(until).toLocaleTimeString('zh-CN', { hour12: false });
            this.runner?.ui.log(`${tag}：暂停至 ${time}`);
            this.runner?.pause(tag);
        },
        check() {
            if (this.isNormal()) {
                if (this.state.until) {
                    this.state = { until: 0, tag: '' };
                    if (this.runner?.active) this.runner.ui.status('运行');
                }
                return;
            }
            const { until, tag } = this.state;
            if (until && Date.now() >= until) {
                this.state = { until: 0, tag: '' };
                this.runner?.ui.log(`${tag}：已解除`);
                this.runner?.resumeLimit();
                return;
            }
            if (!this.isRestricted()) {
                const txt = ((document.body?.innerText || '') + ' ' + (document.title || '')).toLowerCase();
                if (txt.length < 2500) {
                    if (/rate limited|banned temporarily|too many requests|error\s*429|http\s*429/.test(txt)) this.trigger(1800, 'IP 限流');
                    else if (/502\s*bad\s*gateway/.test(txt)) this.trigger(300, '服务 502');
                }
            }
        },
        init(runner) {
            this.runner = runner;
            this.check();
            setInterval(() => this.check(), 3000);
        }
    };
    // 网络请求
    const Net = {
        async fetch(url, runner, retry = 3) {
            for (let i = 0; i < retry; i++) {
                if (Guard.isRestricted()) throw new Error();
                try {
                    const res = await fetch(url);
                    if (res.status === 429) { Guard.trigger(1800, 'IP 限流'); throw new Error(); }
                    if (res.status === 502) { Guard.trigger(300, '服务 502'); throw new Error(); }
                    if (res.ok) return await res.json();
                } catch (e) {
                    if (Guard.isRestricted() || i === retry - 1) throw e;
                    await Tool.wait(600 * Math.pow(2, i) + Tool.rand(50, 150), runner);
                }
            }
        }
    };
    // 接口拦截
    const Interceptor = {
        ui: null,
        closePopup() {
            [200, 500].forEach(delay => {
                setTimeout(() => {
                    const btn = document.querySelector('.dialog-footer .btn-primary, .modal-footer .btn-primary, .d-modal__footer .btn-primary, .bootbox .btn-primary, .dialog-body button, button.btn-primary');
                    if (btn) Stealth.click(btn);
                    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
                }, delay);
            });
        },
        trigger(data) {
            const waitSec = data?.extras?.wait_seconds || 0;
            const timeLeft = data?.extras?.time_left || waitSec;
            GM_setValue('lda_cooldown', waitSec > 0 ? Date.now() + waitSec * 1000 : Date.now() + 30 * 60 * 1000);
            if (this.ui) {
                this.ui.log(`点赞受限：${timeLeft}`);
                this.ui.cooldown();
            }
            this.closePopup();
        },
        init(ui) {
            this.ui = ui;
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const isLike = (u) => /toggle\.json|custom-reactions|discourse-reactions|post_actions/.test(String(u));
            const origFetch = win.fetch;
            win.fetch = async (...args) => {
                const res = await origFetch.apply(win, args);
                if (isLike(args[0]?.url || args[0])) {
                    try {
                        const d = await res.clone().json();
                        if (res.status === 429 || d?.error_type === 'rate_limit') Interceptor.trigger(d);
                    } catch (_) {}
                }
                return res;
            };
            const origOpen = win.XMLHttpRequest.prototype.open;
            const origSend = win.XMLHttpRequest.prototype.send;
            win.XMLHttpRequest.prototype.open = function(m, u) { this._u = u; return origOpen.apply(this, arguments); };
            win.XMLHttpRequest.prototype.send = function(...args) {
                this.addEventListener('load', function() {
                    if (isLike(this._u)) {
                        try {
                            const d = JSON.parse(this.responseText);
                            if (this.status === 429 || d?.error_type === 'rate_limit') Interceptor.trigger(d);
                        } catch (_) {}
                    }
                });
                return origSend.apply(this, args);
            };
        }
    };
    // 点赞管理
    class Liker {
        constructor(ui) {
            this.ui = ui;
            this.records = GM_getValue('lda_records', {});
        }
        cooling() { return GM_getValue('lda_cooldown', 0) > Date.now(); }
        getScore(post) {
            const c = post.querySelector('.discourse-reactions-counter, .reactions-counter, .like-count');
            if (c) {
                const n = parseInt(c.innerText?.trim() || c.textContent?.trim() || '0');
                if (!isNaN(n)) return n;
            }
            const btn = post.querySelector('.discourse-reactions-reaction-button, button.btn-toggle-reaction-like, button.like');
            return parseInt((btn?.getAttribute('aria-label') || btn?.innerText || '').match(/(\d+)/)?.[1] || '0');
        }
        isLiked(el) {
            const btn = el.querySelector('button.btn-toggle-reaction-like, .discourse-reactions-reaction-button button, button.like');
            return !btn || btn.classList.contains('has-like') || btn.classList.contains('liked') || btn.getAttribute('aria-pressed') === 'true' || !!el.querySelector('.has-like, .my-reaction');
        }
        async execute(runner) {
            if (this.cooling()) {
                this.ui.cooldown();
                return;
            }
            const id = Tool.identity();
            if (!id) return;
            const history = this.records[id] || [];
            const threshold = this.ui.threshold;
            for (const post of Array.from(document.querySelectorAll('.topic-post'))) {
                if (this.cooling() || !runner.active) break;
                const floor = parseInt(post.getAttribute('data-post-number') || '0');
                if (!floor || history.includes(floor)) continue;
                if (this.isLiked(post)) { history.push(floor); continue; }
                if (threshold > 0 && this.getScore(post) < threshold) continue;
                const btn = post.querySelector('button.btn-toggle-reaction-like, .discourse-reactions-reaction-button button, button.like');
                if (!btn) continue;
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                if (!(await Tool.wait(Tool.rand(400, 600), runner))) return;
                try {
                    Stealth.click(btn);
                    history.push(floor);
                    this.records[id] = history;
                    GM_setValue('lda_records', this.records);
                    this.ui.log(`自动点赞：第 ${floor} 楼`);
                } catch (_) {}
                if (!(await Tool.wait(Tool.rand(600, 900), runner))) return;
            }
            this.records[id] = history;
            GM_setValue('lda_records', this.records);
        }
    }
    // 浏览管理
    class Runner {
        constructor(liker, ui) {
            this.liker = liker;
            this.ui = ui;
            this.moving = false;
            this.history = GM_getValue('lda_history', []);
            this.timestamp = Date.now();
            this.url = location.href;
            setInterval(() => {
                if (this.url !== location.href) {
                    this.url = location.href;
                    this.timestamp = Date.now();
                    if (this.active && !this.moving && !Guard.isRestricted()) setTimeout(() => this.resume(), 800);
                }
            }, 1000);
            setInterval(() => {
                if (this.active && Date.now() - this.timestamp > 35000 && !Guard.isRestricted()) {
                    this.moving = false;
                    this.timestamp = Date.now();
                    this.forward();
                }
            }, 5000);
            if (this.active) {
                if (this.ui.keepAlive) Stealth.keepAlive();
                if (Guard.isRestricted()) this.pause(Guard.state.tag);
                else {
                    this.ui.status('运行');
                    setTimeout(() => this.resume(), 1000);
                }
            }
        }
        get active() { return sessionStorage.getItem('lda_active') === 'true'; }
        set active(v) { sessionStorage.setItem('lda_active', v); }
        get queue() { return JSON.parse(sessionStorage.getItem('lda_queue') || '[]'); }
        set queue(v) { sessionStorage.setItem('lda_queue', JSON.stringify(v)); }
        get page() { return parseInt(sessionStorage.getItem('lda_page') || '0'); }
        set page(v) { sessionStorage.setItem('lda_page', v); }
        get count() { return parseInt(sessionStorage.getItem('lda_count') || '0'); }
        set count(v) { sessionStorage.setItem('lda_count', v); }
        pause(tag) {
            this.moving = false;
            this.ui.status(`暂停(${tag})`);
        }
        resumeLimit() {
            if (!this.active) return;
            this.ui.status('运行');
            Guard.isNormal() ? this.resume() : location.assign('/latest');
        }
        start() {
            if (this.ui.keepAlive) Stealth.keepAlive();
            this.active = true;
            this.count = 0;
            this.timestamp = Date.now();
            if (Guard.isRestricted()) {
                this.pause(Guard.state.tag);
                this.ui.log(`限制等待：剩余 ${Math.ceil((Guard.state.until - Date.now()) / 60000)} 分钟`);
                return;
            }
            this.ui.status('运行');
            Net.fetch('/session/current.json', this).catch(()=>{});
            this.resume();
        }
        stop() {
            this.active = false;
            this.moving = false;
            this.ui.status('停止');
            Stealth.suspendKeepAlive();
        }
        async resume() {
            if (!this.active || Stealth.isChallenge() || Guard.isRestricted()) return;
            this.timestamp = Date.now();
            if (Tool.topic()) await this.browse();
            else await this.forward();
        }
        plan() {
            const vh = window.innerHeight || 800;
            const top = Math.floor(vh * (this.ui.full ? 0.35 : 0.65)) + Tool.rand(-20, 40);
            return { top, delay: Math.floor(top * 1.5) + Tool.rand(200, 400) };
        }
        async finishTopic(id) {
            if (id && !this.history.includes(id)) {
                this.history.push(id);
                if (this.history.length > 800) this.history.shift();
                GM_setValue('lda_history', this.history);
            }
            this.moving = false;
            this.count++;
            this.ui.updateReadCount(this.count);
            if (this.ui.limit > 0 && this.count >= this.ui.limit) this.stop();
            await this.forward();
        }
        async browse() {
            if (this.moving || Guard.isRestricted()) return;
            this.moving = true;
            this.ui.log(`开始阅读：${Tool.title()}`);
            const id = Tool.identity();
            if (id) Net.fetch(`/t/topic/${id}.json`, this).catch(()=>{});
            if (this.ui.full && window.scrollY > 100) {
                window.scrollTo(0, 0);
                if (!(await Tool.wait(600, this))) return;
            }
            if (!(await Tool.wait(800, this))) return;
            await this.liker.execute(this);
            if (!(await Tool.wait(Tool.rand(1200, 2000), this))) return;
            const enter = Date.now();
            while (this.active && this.moving) {
                if (Guard.isRestricted()) { this.moving = false; return; }
                this.timestamp = Date.now();
                const step = this.plan();
                const curY = window.scrollY;
                window.scrollBy({ top: step.top, behavior: 'smooth' });
                setTimeout(() => {
                    if (window.scrollY === curY && this.active && this.moving) {
                        window.scrollBy(0, step.top);
                    }
                }, 100);
                if (!(await Tool.wait(step.delay, this))) return;
                await this.liker.execute(this);
                if (Tool.bottom() && Tool.ready()) {
                    let checks = 0;
                    while (Tool.hasUnreadBlueDot() && checks < 4) {
                        window.scrollBy({ top: Tool.rand(20, 50), behavior: 'smooth' });
                        if (!(await Tool.wait(600, this))) return;
                        checks++;
                    }
                    if (Tool.hasUnreadBlueDot()) {
                        this.ui.log('开始验证：CF Challenge');
                        const cfWin = Stealth.openChallenge();
                        while (cfWin && !cfWin.closed && this.active) {
                            if (!(await Tool.wait(1000, this))) return;
                        }
                        if (!(await Tool.wait(1000, this))) return;
                    }
                    await this.finishTopic(id);
                    return;
                }
                if (Date.now() - enter > Tool.rand(180000, 300000)) {
                    await this.finishTopic(id);
                    return;
                }
            }
        }
        async fetch() {
            try {
                const d = await Net.fetch(`/latest.json?no_definitions=true&page=${this.page}`, this);
                let list = d?.topic_list?.topics;
                if (!list) throw new Error();
                if (this.ui.skip) list = list.filter(t => !this.history.includes(t.id.toString()));
                if (list.length > 0) {
                    this.queue = list;
                    this.ui.log(`获取列表：${list.length} 篇`);
                    return true;
                }
                this.page++;
                if (this.page > 15) { this.page = 0; return false; }
                return await this.fetch();
            } catch (_) { return false; }
        }
        async forward() {
            if (!this.active || Stealth.isChallenge() || Guard.isRestricted()) return;
            this.timestamp = Date.now();
            let topics = this.queue;
            if (topics.length === 0) {
                if (!(await this.fetch()) || this.queue.length === 0) { this.route('/latest'); return; }
                topics = this.queue;
            }
            const t = topics.shift();
            this.queue = topics;
            if (t) this.route(t.last_read_post_number ? `/t/topic/${t.id}/${t.last_read_post_number}` : `/t/topic/${t.id}`);
        }
        route(url) {
            try { if (window.DiscourseURL?.routeTo) return window.DiscourseURL.routeTo(url); } catch (_) {}
            location.assign(url);
        }
    }
    // 界面
    class UI {
        constructor() {
            this.userLoaded = false;
            this.creditLoaded = false;
            this.styles();
            this.construct();
            this.events();
            this.cooldown();
        }
        get limit() { return parseInt(document.getElementById('lda-limit').value); }
        get threshold() { return parseInt(document.getElementById('lda-threshold').value); }
        get skip() { return document.getElementById('lda-skip').checked; }
        get full() { return document.getElementById('lda-full').checked; }
        get keepAlive() { return document.getElementById('lda-keepalive').checked; }
        styles() {
            GM_addStyle(`
                #lda-box{position:fixed;right:16px;top:50%;transform:translateY(-50%);width:56px;height:56px;background:#fff;border-radius:28px;z-index:99999;box-shadow:0 4px 16px rgba(13,148,136,.18);border:1px solid #ccfbf1;overflow:hidden;transition:width .25s cubic-bezier(.4,0,.2,1),height .25s cubic-bezier(.4,0,.2,1),border-radius .25s cubic-bezier(.4,0,.2,1),box-shadow .25s cubic-bezier(.4,0,.2,1),border-color .25s cubic-bezier(.4,0,.2,1),padding .25s cubic-bezier(.4,0,.2,1);box-sizing:border-box;display:flex;flex-direction:column;padding:11px}
                #lda-box.expanded{width:265px;height:auto;border-radius:16px;padding:12px;max-height:92vh;overflow-y:auto}
                #lda-box.expanded::-webkit-scrollbar{width:4px}
                #lda-box.expanded::-webkit-scrollbar-thumb{background:#99f6e4;border-radius:2px}
                #lda-box.active-run{border-color:#5eead4;box-shadow:0 0 14px rgba(20,184,166,.4)}
                #lda-box.active-run #lda-gear svg{animation:lda-spin 4s linear infinite}
                @keyframes lda-spin{100%{transform:rotate(360deg)}}
                #lda-panel-content{display:flex;flex-direction:column;gap:8px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;width:100%}
                #lda-header{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#64748b;height:16px;padding:0 2px}
                #lda-header-title{font-weight:600;color:#0f766e}
                #lda-header a{color:#0d9488;text-decoration:none;transition:color .2s;font-weight:500}
                #lda-header a:hover{color:#0f766e;text-decoration:underline}
                #lda-top-bar{display:flex;align-items:center;justify-content:flex-end;gap:8px;width:100%;height:32px}
                #lda-execute{flex:1;height:32px}
                #lda-gear{width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:#0d9488;cursor:pointer;background:transparent;border:none;transition:color .2s;flex-shrink:0;box-sizing:border-box}
                #lda-gear:hover{color:#0f766e}
                #lda-box:not(.expanded) #lda-panel-content{gap:0}
                #lda-box:not(.expanded) #lda-top-bar{width:32px;height:32px;margin:0 auto}
                #lda-box:not(.expanded) #lda-header,
                #lda-box:not(.expanded) #lda-execute,
                #lda-box:not(.expanded) .lda-group,
                #lda-box:not(.expanded) .lda-extra-group,
                #lda-box:not(.expanded) .lda-logger{display:none !important}
                .lda-group{display:flex;flex-direction:column;gap:6px;width:100%}
                .lda-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#1e293b;height:26px}
                .lda-ctrl{display:flex;align-items:center;justify-content:flex-end;width:64px}
                .lda-inp{background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;border-radius:8px;padding:0 4px;font-size:12px;outline:none;text-align:center;width:64px;height:24px}
                .lda-checkbox{cursor:pointer;width:16px;height:16px;accent-color:#0d9488;margin:0}
                .lda-button{width:100%;height:32px;border:none;border-radius:10px;font-weight:600;cursor:pointer;color:#fff;font-size:13px;transition:all .2s;display:flex;align-items:center;justify-content:center}
                .lda-button.start{background:linear-gradient(135deg,#06b6d4,#0d9488)}
                .lda-button.stop{background:linear-gradient(135deg,#14b8a6,#10b981)}
                .lda-logger{background:#f0fdfa;padding:8px;height:90px;overflow-y:auto;font-size:11px;color:#115e59;font-family:monospace;border:1px solid #ccfbf1;border-radius:8px;line-height:1.4}
                .lda-logger::-webkit-scrollbar{width:4px}
                .lda-logger::-webkit-scrollbar-thumb{background:#99f6e4;border-radius:2px}
                #lda-threshold-label{cursor:pointer;user-select:none}
                details summary::-webkit-details-marker, details summary::marker{display:none !important}
                details summary{list-style:none;outline:none}
                details summary.lda-row{display:flex !important;justify-content:space-between !important;align-items:center !important;width:100% !important;height:26px !important}
                .lda-extra-group{display:flex;flex-direction:column;gap:6px;width:100%}
                .lda-action-btn{background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;border-radius:6px;padding:0 8px;font-size:11px;height:22px;cursor:pointer;line-height:20px;outline:none;transition:all .2s}
                .lda-action-btn:hover{background:#ccfbf1;border-color:#5eead4}
                .lda-grid-content{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;background:#f0fdfa;border:1px solid #ccfbf1;border-radius:8px;padding:6px 8px;margin-top:4px;box-sizing:border-box}
                .lda-grid-item{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#334155;line-height:1.4}
                .lda-grid-item .lda-val{font-weight:600;color:#0f766e;margin-left:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                .lda-empty-tip{grid-column:span 2;text-align:center;color:#94a3b8;font-size:11px;padding:4px 0}
            `);
        }
        construct() {
            this.box = document.createElement('div');
            this.box.id = 'lda-box';
            this.box.innerHTML = `
                <div id="lda-panel-content">
                    <div id="lda-header">
                        <span id="lda-header-title">Auto LD</span>
                        <a href="https://github.com/YisRime/AutoLD" target="_blank">Yis_Rime | GitHub</a>
                    </div>
                    <div id="lda-top-bar">
                        <button id="lda-execute" class="lda-button start">开始</button>
                        <div id="lda-gear" title="展开/收起">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.485.485 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                            </svg>
                        </div>
                    </div>
                    <div class="lda-group">
                        <div class="lda-row" title="自动跳过已经阅读过的话题"><span>跳过已读</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-skip"></div></div>
                        <div class="lda-row" title="完整阅读每个话题未读内容"><span>完整阅读</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-full"></div></div>
                        <div class="lda-row" title="设置本次阅读话题数量上限"><span>阅读限额</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-limit" min="0"></div></div>
                        <div class="lda-row" title="自动点赞的赞数阈值 | 点击文字可重置冷却"><span id="lda-threshold-label">点赞阈值</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-threshold" min="-1"></div></div>
                        <details style="width:100%">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起">
                                <span>高级选项</span>
                            </summary>
                            <div style="display:flex;flex-direction:column;gap:6px;padding-top:4px">
                                <div class="lda-row" title="保持不被浏览器休眠"><span>后台保活</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-keepalive"></div></div>
                                <div class="lda-row" title="手动进行 CF 验证"><span>CF 验证</span><div class="lda-ctrl"><button id="lda-cf-btn" class="lda-inp" style="cursor:pointer">验证</button></div></div>
                            </div>
                        </details>
                    </div>
                    <div class="lda-logger" id="lda-logger"></div>
                    <div class="lda-extra-group">
                        <details style="width:100%" id="lda-user-info-detail">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起">
                                <span>用户信息</span>
                                <div class="lda-ctrl">
                                    <button class="lda-action-btn" id="lda-fetch-user">刷新</button>
                                </div>
                            </summary>
                            <div class="lda-grid-content" id="lda-user-list">
                                <div class="lda-empty-tip">正在获取</div>
                            </div>
                        </details>
                        <details style="width:100%" id="lda-credit-info-detail">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起">
                                <span>用户 LDC</span>
                                <div class="lda-ctrl">
                                    <button class="lda-action-btn" id="lda-fetch-credit">刷新</button>
                                </div>
                            </summary>
                            <div class="lda-grid-content" id="lda-credit-list">
                                <div class="lda-empty-tip">正在获取</div>
                            </div>
                        </details>
                    </div>
                </div>`;
            document.body.appendChild(this.box);
        }
        events() {
            this.box.onclick = () => {
                if (!this.box.classList.contains('expanded')) this.box.classList.add('expanded');
            };
            document.getElementById('lda-gear').onclick = (e) => {
                e.stopPropagation();
                this.box.classList.toggle('expanded');
            };
            [['limit', 0, false], ['threshold', 0, false], ['skip', true, true], ['full', false, true]].forEach(([k, def, isChk]) => {
                const el = document.getElementById(`lda-${k}`);
                if (isChk) {
                    el.checked = GM_getValue(`lda_${k}`, def);
                    el.onchange = e => GM_setValue(`lda_${k}`, e.target.checked);
                } else {
                    el.value = GM_getValue(`lda_${k}`, def);
                    el.onchange = e => GM_setValue(`lda_${k}`, e.target.value);
                }
            });
            const keepaliveEl = document.getElementById('lda-keepalive');
            keepaliveEl.checked = GM_getValue('lda_keepalive', true);
            keepaliveEl.onchange = e => {
                GM_setValue('lda_keepalive', e.target.checked);
                if (e.target.checked) {
                    if (this.executeBtn?.classList.contains('stop')) Stealth.keepAlive();
                } else {
                    Stealth.suspendKeepAlive();
                }
            };
            document.getElementById('lda-cf-btn').onclick = (e) => {
                e.stopPropagation();
                if (!Stealth.isChallenge()) Stealth.openChallenge();
            };
            this.executeBtn = document.getElementById('lda-execute');
            document.getElementById('lda-threshold-label').onclick = (e) => {
                e.stopPropagation();
                GM_setValue('lda_cooldown', 0);
                Guard.state = { until: 0, tag: '' };
                this.cooldown();
                if (runner.active) this.status('运行');
                this.log('已清除所有冷却与限制');
            };
            const bindDetailLoader = (name, loader) => {
                const detail = document.getElementById(`lda-${name}-info-detail`);
                detail.addEventListener('toggle', e => {
                    if (e.target.open && !this[`${name}Loaded`]) loader();
                });
                document.getElementById(`lda-fetch-${name}`).onclick = (e) => {
                    e.stopPropagation();
                    if (!detail.open) detail.open = true;
                    loader();
                };
            };
            bindDetailLoader('user', () => this.loadUserInfo());
            bindDetailLoader('credit', () => this.loadCreditInfo());
        }
        async getCurrentUsername() {
            try {
                const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                if (win.Discourse?.currentUser?.username) return win.Discourse.currentUser.username;
                const res = await fetch('/session/current.json');
                const data = await res.json();
                return data?.current_user?.username;
            } catch (_) {}
            return null;
        }
        async fetchConnectDetails() {
            if (!location.hostname.includes('linux.do')) return null;
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://connect.linux.do/',
                    timeout: 10000,
                    onload: (res) => {
                        if (res.status !== 200) return resolve(null);
                        try {
                            const doc = new DOMParser().parseFromString(res.responseText, 'text/html');
                            const details = {};
                            doc.querySelectorAll('.tl3-bar-item').forEach(el => {
                                const label = el.querySelector('.tl3-bar-label')?.textContent.trim() || '';
                                const nums = el.querySelector('.tl3-bar-nums')?.textContent.trim() || '';
                                if (label.includes('获赞天数')) details.likedDays = nums;
                                if (label.includes('用户') || label.includes('不同用户')) details.likedUsers = nums;
                            });
                            doc.querySelectorAll('.tl3-quota-card').forEach(el => {
                                const label = el.querySelector('.tl3-quota-label')?.textContent.trim() || '';
                                const nums = el.querySelector('.tl3-quota-nums')?.textContent.trim() || '';
                                if (label.includes('被举报')) details.flagged = nums;
                                else if (label.includes('举报用户')) details.flaggedUsers = nums;
                            });
                            doc.querySelectorAll('.tl3-veto-item').forEach(el => {
                                const label = el.querySelector('.tl3-veto-label')?.textContent.trim() || '';
                                const isMet = el.classList.contains('met');
                                const vals = el.querySelectorAll('.tl3-veto-value');
                                const val = isMet ? (vals[0]?.textContent.trim() || '0') : (vals[vals.length - 1]?.textContent.trim() || '0');
                                if (label.includes('禁言')) details.silenced = val;
                                if (label.includes('封禁')) details.suspended = val;
                            });
                            if (!details.likedDays && !details.flagged) {
                                doc.querySelectorAll('table tbody tr').forEach(tr => {
                                    const cells = tr.querySelectorAll('td');
                                    if (cells.length >= 3) {
                                        const name = cells[0].textContent.trim();
                                        const cur = cells[1].textContent.trim();
                                        const req = cells[2].textContent.trim();
                                        const valStr = `${cur}/${req}`;
                                        if (name.includes('获赞天数')) details.likedDays = valStr;
                                        else if (name.includes('不同用户') || (name.includes('获赞') && name.includes('用户'))) details.likedUsers = valStr;
                                        else if (name.includes('被举报')) details.flagged = valStr;
                                        else if (name.includes('举报用户') || name.includes('发起举报')) details.flaggedUsers = valStr;
                                        else if (name.includes('禁言')) details.silenced = cur;
                                        else if (name.includes('封禁')) details.suspended = cur;
                                    }
                                });
                            }
                            resolve(details);
                        } catch (_) {
                            resolve(null);
                        }
                    },
                    onerror: () => resolve(null),
                    ontimeout: () => resolve(null)
                });
            });
        }
        async loadUserInfo() {
            const btn = document.getElementById('lda-fetch-user');
            const list = document.getElementById('lda-user-list');
            btn.disabled = true;
            try {
                const username = await this.getCurrentUsername();
                if (!username) throw new Error('未登录');
                const [userRes, summaryRes, connectData] = await Promise.all([
                    fetch(`/u/${username}.json`).then(r => r.ok ? r.json() : null).catch(() => null),
                    fetch(`/u/${username}/summary.json`).then(r => r.ok ? r.json() : null).catch(() => null),
                    this.fetchConnectDetails()
                ]);
                const userData = userRes?.user || userRes;
                const s = summaryRes?.user_summary || {};
                let trustLevel = userData?.trust_level ?? s?.trust_level;
                if (trustLevel === undefined) {
                    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                    trustLevel = win.Discourse?.currentUser?.trust_level;
                }
                const levels = ['Lv0', 'Lv1', 'Lv2', 'Lv3', 'Lv4'];
                const levelStr = trustLevel !== undefined ? (levels[trustLevel] || `Lv${trustLevel}`) : 'Lv-';
                const timeMinutes = Math.floor((s.time_read || 0) / 60);
                const timeDisplay = timeMinutes >= 60 ? `${(timeMinutes / 60).toFixed(1)}时` : `${timeMinutes}分`;
                const clean = (val) => String(val || '').replace(/\s+/g, '');
                const checkRatio = (valStr) => {
                    if (!valStr || !valStr.includes('/')) return null;
                    const [c, r] = valStr.split('/').map(v => parseFloat(v));
                    return (!isNaN(c) && !isNaN(r)) ? c >= r : null;
                };
                const likedDays = clean(connectData?.likedDays) || '-';
                const likedUsers = clean(connectData?.likedUsers) || '-';
                const flaggedVal = clean(connectData?.flagged) || '0/5';
                const flaggedUsersVal = clean(connectData?.flaggedUsers) || '0/5';
                const silencedVal = clean(connectData?.silenced) || '0';
                const suspendedVal = clean(connectData?.suspended) || '0';
                const likedDaysColor = checkRatio(likedDays) === false ? 'color:#f59e0b' : '';
                const likedUsersColor = checkRatio(likedUsers) === false ? 'color:#f59e0b' : '';
                const flaggedColor = (parseInt(flaggedVal) > 0) ? 'color:#ef4444' : '';
                const flaggedUsersColor = (parseInt(flaggedUsersVal) > 0) ? 'color:#ef4444' : '';
                const silencedColor = (parseInt(silencedVal) > 0) ? 'color:#ef4444' : '';
                const suspendedColor = (parseInt(suspendedVal) > 0) ? 'color:#ef4444' : '';
                list.innerHTML = `
                    <div class="lda-grid-item"><span>等级</span><span class="lda-val">${levelStr}</span></div>
                    <div class="lda-grid-item"><span>时长</span><span class="lda-val">${timeDisplay}</span></div>
                    <div class="lda-grid-item"><span>访问天数</span><span class="lda-val">${s.days_visited || 0}</span></div>
                    <div class="lda-grid-item"><span>浏览帖子</span><span class="lda-val">${s.posts_read_count || 0}</span></div>
                    <div class="lda-grid-item"><span>浏览话题</span><span class="lda-val">${s.topics_entered || 0}</span></div>
                    <div class="lda-grid-item"><span>点赞</span><span class="lda-val">${s.likes_given || 0}</span></div>
                    <div class="lda-grid-item"><span>获赞</span><span class="lda-val">${s.likes_received || 0}</span></div>
                    <div class="lda-grid-item"><span>回复话题</span><span class="lda-val">${s.post_count || userData?.post_count || 0}</span></div>
                    <div class="lda-grid-item"><span>获赞天数</span><span class="lda-val" style="${likedDaysColor}">${likedDays}</span></div>
                    <div class="lda-grid-item"><span>获赞用户</span><span class="lda-val" style="${likedUsersColor}">${likedUsers}</span></div>
                    <div class="lda-grid-item"><span>被举报帖子</span><span class="lda-val" style="${flaggedColor}">${flaggedVal}</span></div>
                    <div class="lda-grid-item"><span>举报用户</span><span class="lda-val" style="${flaggedUsersColor}">${flaggedUsersVal}</span></div>
                    <div class="lda-grid-item"><span>被禁言</span><span class="lda-val" style="${silencedColor}">${silencedVal}</span></div>
                    <div class="lda-grid-item"><span>被封禁</span><span class="lda-val" style="${suspendedColor}">${suspendedVal}</span></div>
                `;
                btn.innerText = '刷新';
                this.userLoaded = true;
            } catch (err) {
                list.innerHTML = `<div class="lda-empty-tip" style="color:#ef4444">获取失败: ${err.message || '网络错误'}</div>`;
                btn.innerText = '重试';
            } finally {
                btn.disabled = false;
            }
        }
        loadCreditInfo() {
            const btn = document.getElementById('lda-fetch-credit');
            const list = document.getElementById('lda-credit-list');
            btn.disabled = true;
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://credit.linux.do/api/v1/oauth/user-info',
                responseType: 'json',
                onload: (res) => {
                    btn.disabled = false;
                    if (res.status === 200 && res.response?.data) {
                        const d = res.response.data;
                        list.innerHTML = `
                            <div class="lda-grid-item"><span>可用积分</span><span class="lda-val" style="color:#0d9488">${d.available_balance || 0}</span></div>
                            <div class="lda-grid-item"><span>社区积分</span><span class="lda-val">${d.community_balance || 0}</span></div>
                            <div class="lda-grid-item"><span>累计收入</span><span class="lda-val">+${d.total_receive || 0}</span></div>
                            <div class="lda-grid-item"><span>累计支出</span><span class="lda-val">-${d.total_payment || 0}</span></div>
                        `;
                        btn.innerText = '刷新';
                        this.creditLoaded = true;
                    } else if (res.status === 401 || res.status === 403) {
                        list.innerHTML = `<div class="lda-empty-tip"><a href="https://credit.linux.do" target="_blank" style="color:#0d9488">前往 credit.linux.do 登录</a></div>`;
                        btn.innerText = '未登录';
                    } else {
                        list.innerHTML = `<div class="lda-empty-tip" style="color:#ef4444">获取失败(${res.status})</div>`;
                        btn.innerText = '重试';
                    }
                },
                onerror: () => {
                    btn.disabled = false;
                    list.innerHTML = `<div class="lda-empty-tip" style="color:#ef4444">请求错误</div>`;
                    btn.innerText = '重试';
                }
            });
        }
        status(state) {
            const active = state === '运行';
            this.box.classList.toggle('active-run', active);
            this.executeBtn.className = `lda-button ${active ? 'stop' : (state.includes('暂停') ? 'stop' : 'start')}`;
            this.executeBtn.innerText = active ? `已读: ${sessionStorage.getItem('lda_count') || 0}` : (state.includes('暂停') ? state : '开始');
        }
        cooldown() {
            const label = document.getElementById('lda-threshold-label');
            if (label) {
                const isCooldown = GM_getValue('lda_cooldown', 0) > Date.now();
                label.style.color = isCooldown ? '#ef4444' : '';
                label.innerText = isCooldown ? '点赞上限' : '点赞阈值';
            }
        }
        updateReadCount(count) {
            if (this.executeBtn.classList.contains('stop') && !this.executeBtn.innerText.includes('暂停')) {
                this.executeBtn.innerText = `已读: ${count}`;
            }
        }
        log(msg) {
            const el = document.getElementById('lda-logger');
            if (!el) return;
            const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            const item = document.createElement('div');
            item.innerText = `[${time}] ${msg}`;
            el.appendChild(item);
            el.scrollTop = el.scrollHeight;
        }
    }
    // 初始化
    Stealth.init();
    const ui = new UI();
    Interceptor.init(ui);
    const liker = new Liker(ui);
    const runner = new Runner(liker, ui);
    Guard.init(runner);
    ui.executeBtn.onclick = () => runner.active ? runner.stop() : runner.start();
})();