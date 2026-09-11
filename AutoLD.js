// ==UserScript==
// @name         Auto Linux Do
// @namespace    https://github.com/YisRime/AutoLD
// @version      1.3.0
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
    if (window.__ldaBooted) return;
    window.__ldaBooted = true;
    const Tool = {
        wait: async (ms, r) => {
            const steps = Math.ceil(ms / 1000);
            for (let i = 0; i < steps; i++) {
                if (r && !r.active) return false;
                await new Promise(res => setTimeout(res, 1000));
            }
            return true;
        },
        rand: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
        bottom: () => Math.ceil(window.scrollY + window.innerHeight) >= document.body.scrollHeight - 200,
        ready: () => !document.querySelector('.loading, .infinite-scroll'),
        topic: () => location.pathname.includes('/t/topic/'),
        identity: () => location.pathname.match(/\/t\/topic\/(\d+)/)?.[1],
        title: () => document.querySelector('#topic-title h1 a')?.innerText,
        dots: () => {
            const vh = window.innerHeight ||  800;
            return Array.from(document.querySelectorAll('.read-state:not(.read)')).filter(el => {
                const r = el.getBoundingClientRect();
                return r.top > -50 && r.top < vh + 50;
            });
        },
        nextDot: () => {
            const vh = window.innerHeight ||  800;
            const all = Array.from(document.querySelectorAll('.read-state:not(.read)'));
            const pick = all.filter(el => el.getBoundingClientRect().top > vh * 0.25);
            const arr = pick.length ? pick : all;
            return arr.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
        }
    };
    const Stealth = {
        audioCtx: null,
        init() {
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
                        clientX: Tool.rand(128, 1024),
                        clientY: Tool.rand(128, 1024)
                    }));
                } catch (_) {}
            }, Tool.rand(5, 15) * 1000);
        },
        keepAlive() {
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
        suspendKeepAlive() {
            try {
                if (this.audioCtx?.state === 'running') {
                    this.audioCtx.suspend();
                }
            } catch (_) {}
        },
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
    const Net = {
        async fetch(url) {
            try {
                const res = await fetch(url);
                if (res.ok) return await res.json();
            } catch (_) {}
            return null;
        }
    };
    const Tracker = {
        tracked: new Set(),
        markTracked(id) {
            if (id) this.tracked.add(String(id));
        },
        execute(id) {
            if (!id || this.tracked.has(String(id))) return;
            this.markTracked(id);
            const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
            const headers = {
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Discourse-Present': 'true'
            };
            if (csrf) headers['X-CSRF-Token'] = csrf;
            fetch(`/t/${id}.json?track_visit=true`, {
                method: 'GET',
                headers: {
                    ...headers,
                    'Discourse-Track-View': 'true',
                    'Discourse-Track-View-Topic-Id': String(id)
                }
            }).catch(() => {});
        }
    };
    const Interceptor = {
        ui: null,
        runner: null,
        closePopup() {
            setTimeout(() => {
                const btn = document.querySelector('.dialog-footer .btn-primary, .modal-footer .btn-primary, .d-modal__footer .btn-primary, .bootbox .btn-primary');
                if (btn) Stealth.click(btn);
                else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            }, 1000);
        },
        pause(res, isLike = false, data = null) {
            let sec = 0;
            const retryAfter = res?.headers?.get?.('Retry-After') || res?.getResponseHeader?.('Retry-After');
            if (retryAfter) {
                const n = parseInt(retryAfter, 10);
                if (n > 0) sec = n;
            }
            if (!sec && data?.extras?.wait_seconds) {
                const n = parseInt(data.extras.wait_seconds, 10);
                if (n > 0) sec = n;
            }
            if (!sec) {
                sec = isLike ? 24 * 3600 : 10 * 60;
            }
            if (isLike) {
                GM_setValue('lda_cooldown', Date.now() + sec * 1000);
                if (this.ui) {
                    console.log(`点赞限流：剩余 ${sec} 秒`);
                    this.ui.cooldown();
                }
                this.closePopup();
                return;
            }
            console.log(`接口限流：暂停 ${Math.round(sec / 60)} 分钟`);
            this.runner?.pause(sec);
        },
        trigger(data, res = null) {
            this.pause(res, true, data);
        },
        init(ui) {
            this.ui = ui;
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const isLike = (u) => /toggle\.json|custom-reactions|discourse-reactions|post_actions/.test(String(u));
            const isTrack = (u) => {
                const str = String(u);
                return str.includes('/pageview') || str.includes('track_visit=true');
            };
            const origFetch = win.fetch;
            win.fetch = async (...args) => {
                const urlStr = String(args[0]?.url || args[0]);
                if (isTrack(urlStr)) {
                    const idMatch = urlStr.match(/\/t\/(?:topic\/)?(\d+)/);
                    Tracker.markTracked(idMatch ? idMatch[1] : Tool.identity());
                }
                const isLikeUrl = isLike(urlStr);
                let res;
                try {
                    res = await origFetch.apply(win, args);
                } catch (e) {
                    this.pause(null, isLikeUrl);
                    throw e;
                }
                if (!res.ok) {
                    let d = null;
                    try {
                        d = await res.clone().json();
                    } catch (_) {}
                    this.pause(res, isLikeUrl, d);
                } else if (isLikeUrl) {
                    try {
                        const d = await res.clone().json();
                        if (d?.error_type || d?.errors) {
                            this.pause(res, true, d);
                        }
                    } catch (_) {}
                }
                return res;
            };
            const origOpen = win.XMLHttpRequest.prototype.open;
            const origSend = win.XMLHttpRequest.prototype.send;
            win.XMLHttpRequest.prototype.open = function(m, u) { 
                this._u = u; 
                if (isTrack(u)) {
                    const idMatch = String(u).match(/\/t\/(?:topic\/)?(\d+)/);
                    Tracker.markTracked(idMatch ? idMatch[1] : Tool.identity());
                }
                return origOpen.apply(this, arguments); 
            };
            win.XMLHttpRequest.prototype.send = function(...args) {
                this.addEventListener('load', function() {
                    const isLikeUrl = isLike(this._u);
                    let hasError = this.status >= 400 || this.status === 0;
                    let d = null;
                    try {
                        d = JSON.parse(this.responseText);
                        if (d?.error_type || d?.errors) hasError = true;
                    } catch (_) {}
                    if (hasError) {
                        Interceptor.pause(this, isLikeUrl, d);
                    }
                });
                this.addEventListener('error', function() {
                    Interceptor.pause(this, isLike(this._u));
                });
                return origSend.apply(this, args);
            };
        }
    };
    class Liker {
        constructor(ui) {
            this.ui = ui;
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
            const threshold = this.ui.threshold;
            const topBound = window.scrollY + window.innerHeight + 100;
            for (const post of Array.from(document.querySelectorAll('.topic-post'))) {
                if (this.cooling() || !runner.active) return;
                if (post.offsetTop > topBound) continue;
                if (this.isLiked(post)) continue;
                if (threshold > 0 && this.getScore(post) < threshold) continue;
                const btn = post.querySelector('button.btn-toggle-reaction-like, .discourse-reactions-reaction-button button, button.like');
                if (!btn) continue;
                Stealth.click(btn);
                console.log(`自动点赞：第 ${post.getAttribute('data-post-number')} 楼`);
                if (!(await Tool.wait(1000, runner))) return;
            }
        }
    }
    class Runner {
        constructor(liker, ui) {
            this.liker = liker;
            this.ui = ui;
            this.moving = false;
            this.history = GM_getValue('lda_history', []);
            this.lastResumeAt = 0;
            this.url = location.href;
            setInterval(() => {
                if (this.url !== location.href) {
                    this.url = location.href;
                    if (this.active && !this.moving) setTimeout(() => this.resume(), 1000);
                }
            }, 1000);
            if (this.active) {
                if (this.ui.keepAlive) Stealth.keepAlive();
                this.ui.status('运行');
                setTimeout(() => this.resume(), 1000);
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
        start() {
            sessionStorage.removeItem('lda_pause_until');
            if (this.ui.keepAlive) Stealth.keepAlive();
            this.active = true;
            this.count = 0;
            this.ui.status('运行');
            this.resume();
        }
        stop() {
            this.active = false;
            this.moving = false;
            sessionStorage.removeItem('lda_pause_until');
            this.ui.status('停止');
            Stealth.suspendKeepAlive();
        }
        pause(sec) {
            if (!this.active) return;
            const ms = sec * 1000;
            this.stop();
            sessionStorage.setItem('lda_pause_until', String(Date.now() + ms));
            this.ui.status('暂停');
            setTimeout(() => {
                const until = parseInt(sessionStorage.getItem('lda_pause_until') || '0', 10);
                if (until && Date.now() >= until) {
                    sessionStorage.removeItem('lda_pause_until');
                    console.log('解除限流：恢复运行');
                    this.start();
                }
            }, ms);
        }
        async resume() {
            if (!this.active) return;
            if (Tool.topic()) await this.browse();
            else await this.forward();
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
            if (this.active) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            await this.forward();
        }
        async browse() {
            if (this.moving) return;
            this.moving = true;
            const id = Tool.identity();
            const maxP = this.ui.maxPosts;
            if (maxP > 0) {
                let count = 0;
                const timelineEl = document.querySelector('.timeline-replies');
                if (timelineEl) {
                    const match = timelineEl.innerText.match(/\/\s*(\d+)/);
                    if (match) count = parseInt(match[1], 10);
                }
                if (!count) {
                    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                    count = win.Discourse?.__container__?.lookup('controller:topic')?.model?.posts_count || 0;
                }
                if (count > maxP) {
                    console.log(`触发过滤：${count} > ${maxP} 楼`);
                    await this.finishTopic(id);
                    return;
                }
            }
            Tracker.execute(id);
            if (this.ui.full && window.scrollY > 100) window.scrollTo(0, 0);
            if (!(await Tool.wait(1000, this))) return;
            console.log(`开始阅读：${Tool.title()}`);
            while (this.active && this.moving) {
                let tLoad = Date.now();
                while (this.active && this.moving && !Tool.ready()) {
                    if (Date.now() - tLoad > 10000) break;
                    if (!(await Tool.wait(1000, this))) return;
                }
                const dot = Tool.nextDot();
                if (dot) {
                    const anchor = (dot.closest('.topic-post') || dot).getBoundingClientRect();
                    const target = anchor.top + window.scrollY - window.innerHeight * 0.3;
                    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
                } else {
                    const vh = window.innerHeight ||  800;
                    const step = Math.floor(vh * (this.ui.full ? 0.4 : 0.7));
                    window.scrollBy({ top: step, behavior: 'smooth' });
                }
                if (!(await Tool.wait(1000, this))) return;
                await this.liker.execute(this);
                const t1 = Date.now();
                let waited = false;
                while (this.active && this.moving) {
                    if (Date.now() - t1 >= 10000) break;
                    if (Tool.dots().length === 0) break;
                    if (!waited) { waited = true; console.log(`等待蓝点：剩余 ${Tool.dots().length} 个`); }
                    if (!(await Tool.wait(1000, this))) return;
                }
                if (Tool.bottom() && Tool.ready()) {
                    if (!(await Tool.wait(3000, this))) return;
                    await this.finishTopic(id);
                    return;
                }
            }
        }
        async fetch() {
            const unreadData = await Net.fetch(`/unread.json?page=${this.page}`);
            let list = unreadData?.topic_list?.topics;
            if (!Array.isArray(list) || list.length === 0) {
                return false;
            }
            console.log(`获取未读：${list.length} 篇`);
            if (this.ui.skip) list = list.filter(t => !this.history.includes(t.id.toString()));
            const maxP = this.ui.maxPosts;
            if (maxP > 0) list = list.filter(t => (t.posts_count || t.highest_post_number || 0) <= maxP);
            if (list.length > 0) {
                this.queue = list;
                return true;
            }
            this.page++;
            return await this.fetch();
        }
        async forward() {
            if (!this.active) return;
            let topics = this.queue;
            if (this.ui.skip) topics = topics.filter(t => !this.history.includes(t.id.toString()));
            const maxP = this.ui.maxPosts;
            if (maxP > 0) topics = topics.filter(t => (t.posts_count || t.highest_post_number || 0) <= maxP);
            if (topics.length === 0) {
                if (!(await this.fetch()) || this.queue.length === 0) {
                    this.stop();
                    return;
                }
                topics = this.queue;
            }
            const t = topics.shift();
            this.queue = topics;
            if (t) this.route(t.last_read_post_number ? `/t/topic/${t.id}/${t.last_read_post_number}` : `/t/topic/${t.id}`);
        }
        route(url) {
            location.assign(url);
        }
    }
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
        get maxPosts() { return parseInt(document.getElementById('lda-maxPosts').value) || 0; }
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
                @keyframes lda-spin{100%{transform:rotate(360deg)}}
                #lda-panel-content{display:flex;flex-direction:column;gap:8px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;width:100%}
                #lda-header{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#64748b;height:16px;padding:0 2px}
                #lda-header-title{font-weight:600;color:#0f766e}
                #lda-header a{color:#0d9488;text-decoration:none;transition:color .2s;font-weight:500}
                #lda-header a:hover{color:#0f766e;text-decoration:underline}
                #lda-top-bar{display:flex;align-items:center;justify-content:flex-end;gap:8px;width:100%;height:32px}
                #lda-execute{flex:1;height:32px}
                #lda-gear{width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:#0d9488;cursor:pointer;background:transparent;border:none;transition:all .2s;flex-shrink:0;box-sizing:border-box;border-radius:8px}
                #lda-gear:hover{color:#0f766e;background:#ccfbf1}
                #lda-box:not(.expanded) .lda-icon-close{display:none}
                #lda-box.expanded .lda-icon-gear{display:none}
                #lda-box.expanded .lda-icon-close{display:block}
                #lda-box.expanded #lda-gear{background:#f0fdfa;border:1px solid #ccfbf1}
                #lda-box.expanded #lda-gear:hover{background:#ccfbf1}
                #lda-box.active-run #lda-gear .lda-icon-gear{animation:lda-spin 4s linear infinite}
                #lda-box:not(.expanded) #lda-panel-content{gap:0}
                #lda-box:not(.expanded) #lda-top-bar{width:32px;height:32px;margin:0 auto}
                #lda-box:not(.expanded) #lda-header,
                #lda-box:not(.expanded) #lda-execute,
                #lda-box:not(.expanded) .lda-group,
                #lda-box:not(.expanded) .lda-extra-group{display:none !important}
                .lda-group{display:flex;flex-direction:column;gap:6px;width:100%}
                .lda-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#1e293b;height:26px}
                .lda-ctrl{display:flex;align-items:center;justify-content:flex-end;width:64px}
                .lda-inp{background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;border-radius:8px;padding:0 4px;font-size:12px;outline:none;text-align:center;width:64px;height:24px}
                .lda-checkbox{cursor:pointer;width:16px;height:16px;accent-color:#0d9488;margin:0}
                .lda-button{width:100%;height:32px;border:none;border-radius:10px;font-weight:600;cursor:pointer;color:#fff;font-size:13px;transition:all .2s;display:flex;align-items:center;justify-content:center}
                .lda-button.start{background:linear-gradient(135deg,#06b6d4,#0d9488)}
                .lda-button.stop{background:linear-gradient(135deg,#14b8a6,#10b981)}
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
                            <svg class="lda-icon-gear" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.485.485 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                            </svg>
                            <svg class="lda-icon-close" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                        </div>
                    </div>
                    <div class="lda-group">
                        <div class="lda-row" title="自动跳过已经阅读过的话题"><span>跳过已读</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-skip"></div></div>
                        <div class="lda-row" title="完整阅读每个话题未读内容"><span>完整阅读</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-full"></div></div>
                        <div class="lda-row" title="设置本次阅读话题数量上限"><span>阅读限额</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-limit" min="0"></div></div>
                        <div class="lda-row" title="阅读总数少于设定值的话题"><span>最大楼层</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-maxPosts" min="0"></div></div>
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
            [['limit', 0, false], ['maxPosts', 0, false], ['threshold', 0, false], ['skip', true, true], ['full', false, true]].forEach(([k, def, isChk]) => {
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
                console.log('重新加载：完成 CF 验证');
                location.reload();
            };
            this.executeBtn = document.getElementById('lda-execute');
            document.getElementById('lda-threshold-label').onclick = (e) => {
                e.stopPropagation();
                GM_setValue('lda_cooldown', 0);
                this.cooldown();
                if (runner.active) this.status('运行');
                console.log('清除冷却：已清除');
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
        getCurrentUsername() {
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            return win.Discourse?.currentUser?.username || null;
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
                const username = this.getCurrentUsername();
                if (!username) throw new Error('未登录');
                const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                const me = win.Discourse?.currentUser || {};
                const [summaryRes, connectData] = await Promise.all([
                    fetch(`/u/${username}/summary.json`).then(r => r.ok ? r.json() : null).catch(() => null),
                    this.fetchConnectDetails()
                ]);
                const s = summaryRes?.user_summary || {};
                const trustLevel = me.trust_level ?? s?.trust_level;
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
                    <div class="lda-grid-item"><span>回复话题</span><span class="lda-val">${s.post_count || me.post_count || 0}</span></div>
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
                timeout: 10000,
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
                },
                ontimeout: () => {
                    btn.disabled = false;
                    list.innerHTML = `<div class="lda-empty-tip" style="color:#ef4444">请求超时</div>`;
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
    }
    Stealth.init();
    const ui = new UI();
    Interceptor.init(ui);
    const liker = new Liker(ui);
    const runner = new Runner(liker, ui);
    Interceptor.runner = runner;
    ui.executeBtn.onclick = () => {
        if (runner.active) { runner.stop(); return; }
        const until = parseInt(sessionStorage.getItem('lda_pause_until') || '0', 10);
        if (until > Date.now()) { runner.stop(); return; }
        runner.start();
    };
})();