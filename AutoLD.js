// ==UserScript==
// @name         Auto Linux Do
// @namespace    https://github.com/YisRime/AutoLD
// @version      3.1.0
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

    const Logger = {
        element: null,
        setup(element) { this.element = element; this.draw(); },
        retrieve: () => { try { return JSON.parse(sessionStorage.getItem('lda_logs') || '[]'); } catch { return []; } },
        write(message) {
            const entry = { time: new Date().toTimeString().split(' ')[0], text: String(message) };
            const history = this.retrieve();
            if (history.push(entry) > 80) history.shift();
            try { sessionStorage.setItem('lda_logs', JSON.stringify(history)); } catch {}
            if (this.element) {
                this.element.insertAdjacentHTML('beforeend', `<div class="lda-log-line"><span class="lda-log-time">[${entry.time}]</span><span class="lda-log-text">${entry.text}</span></div>`);
                this.element.scrollTop = this.element.scrollHeight;
            }
        },
        draw() {
            if (!this.element) return;
            this.element.innerHTML = this.retrieve().map(entry => `<div class="lda-log-line"><span class="lda-log-time">[${entry.time}]</span><span class="lda-log-text">${entry.text}</span></div>`).join('');
            this.element.scrollTop = this.element.scrollHeight;
        },
        clear() { sessionStorage.removeItem('lda_logs'); if (this.element) this.element.innerHTML = ''; }
    };

    const Tool = {
        random: (minimum, maximum) => Math.floor(Math.random() * (maximum - minimum + 1)) + minimum,
        wait: async (milliseconds, runner) => {
            const target = milliseconds ?? Tool.random(500, 2000), start = Date.now();
            while (Date.now() - start < target) {
                if (runner && !runner.active) return false;
                await new Promise(resolve => setTimeout(resolve, Math.min(500, target - (Date.now() - start))));
            }
            return true;
        },
        poll: async (condition, timeout = 5000, step = 500) => {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                const response = condition();
                if (response) return response;
                await new Promise(resolve => setTimeout(resolve, step));
            }
            return null;
        },
        bottom: () => Math.ceil((window.scrollY || document.documentElement.scrollTop) + (window.innerHeight || document.documentElement.clientHeight)) >= Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - 250,
        ready: () => !document.querySelector('.loading, .infinite-scroll'),
        identity: (address = location.href) => address.match(/\/t\/.*?\/(\d+)/)?.[1] || null,
        title: () => document.querySelector('#topic-title h1 a, #topic-title .fancy-title')?.innerText?.trim(),
        unread: () => document.querySelector('.read-state:not(.read)'),
        cloudflare: () => !document.querySelector('#main-outlet, #topic-title, .topic-list') && (document.title.includes('Just a moment...') || Boolean(document.querySelector('#challenge-stage, #challenge-running'))),
        measure: (element) => { const content = element?.querySelector?.('.cooked'); return content ? (content.textContent?.length || 0) + (content.querySelectorAll('img, video, iframe').length * 80) : 0; },
        parse: (string) => {
            const number = parseFloat(String(string || '').trim().toLowerCase());
            if (isNaN(number)) return 0;
            return string.toLowerCase().endsWith('k') ? Math.round(number * 1000) : (string.toLowerCase().endsWith('w') ? Math.round(number * 10000) : Math.round(number));
        }
    };

    const Stealth = {
        audio: null, timer: null,
        poke() {
            try {
                const expected = Tool.identity(), context = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                if (!expected) return;
                const topic = context.Discourse?.__container__?.lookup?.('controller:topic')?.model;
                if (!topic?.id || String(topic.id) !== String(expected)) return;
                const tracker = context.Discourse.__container__.lookup('service:screen-track');
                if (tracker && tracker.topicId !== Number(topic.id)) tracker.start?.(Number(topic.id), topic);
                tracker?.scrolled?.();
            } catch {}
        },
        keep() {
            try {
                if (!this.audio && (window.AudioContext || window.webkitAudioContext)) {
                    this.audio = new (window.AudioContext || window.webkitAudioContext)();
                    const oscillator = this.audio.createOscillator(), gain = this.audio.createGain();
                    gain.gain.value = 0.00001; oscillator.connect(gain); gain.connect(this.audio.destination); oscillator.start();
                }
                if (this.audio?.state === 'suspended') this.audio.resume();
            } catch {}
            if (!this.timer) { this.poke(); this.timer = setInterval(() => this.poke(), 30000); }
        },
        suspend() {
            try { if (this.audio?.state === 'running') this.audio.suspend(); } catch {}
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
        }
    };

    const Interceptor = {
        view: null, runner: null,
        close() {
            setTimeout(() => {
                const button = document.querySelector('.dialog-footer .btn-primary, .d-modal__footer .btn-primary');
                if (button) button.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            }, Tool.random(500, 2000));
        },
        handle(method, address, status, response = null, data = null, reaction = false) {
            Logger.write(`接口报错：${(method || 'GET').toUpperCase()} ${String(address).replace(location.origin, '').split('?')[0]} ${status || 'ERR'}`);
            let seconds = parseInt(response?.headers?.get?.('Retry-After') || data?.extras?.wait_seconds, 10) || 0;
            if (!seconds) seconds = 300;
            if (reaction) { GM_setValue('lda_cooldown', Date.now() + seconds * 1000); this.view?.cooldown(); this.close(); }
            this.runner?.pause(seconds);
        },
        setup(view) {
            this.view = view;
            const context = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window, original = context.fetch;
            context.fetch = async function (...parameters) {
                const address = String(parameters[0]?.url || parameters[0]);
                if (/challenges\.cloudflare\.com|cdn-cgi\/challenge-platform|turnstile/.test(address)) return original.apply(this, parameters);
                const method = String(parameters[1]?.method || parameters[0]?.method || 'GET').toUpperCase(), reaction = /toggle\.json|custom-reactions|discourse-reactions|post_actions/.test(address);
                let response;
                try { response = await original.apply(this, parameters); } catch (error) { Interceptor.handle(method, address, 0, null, null, reaction); throw error; }
                if (!response.ok) {
                    let data = null; try { data = await response.clone().json(); } catch {}
                    Interceptor.handle(method, address, response.status, response, data, reaction);
                } else if (reaction) {
                    try { const data = await response.clone().json(); if (data?.error_type || data?.errors) Interceptor.handle(method, address, response.status, response, data, true); } catch {}
                }
                return response;
            };
        }
    };

    class Liker {
        constructor(view) { this.view = view; this.history = new Set(); }
        reset() { this.history.clear(); }
        cooling() { return GM_getValue('lda_cooldown', 0) > Date.now(); }
        async execute(runner) {
            if (this.cooling()) { this.view.cooldown(); return; }
            for (const post of document.querySelectorAll('.topic-post')) {
                if (this.cooling() || !runner.active) return;
                const identifier = post.dataset.postNumber;
                if (!identifier || this.history.has(identifier)) continue;
                const bounds = post.getBoundingClientRect();
                if (bounds.top >= window.innerHeight - 40 || bounds.bottom <= 40) continue;
                if (post.querySelector('.has-used-main-reaction')) { this.history.add(identifier); continue; }
                const counter = post.querySelector('.discourse-reactions-counter'), score = counter ? Tool.parse(counter.innerText || counter.getAttribute('aria-label')) : 0;
                if (this.view.threshold > 0 && score < this.view.threshold) continue;
                const button = post.querySelector('.btn-toggle-reaction-like');
                if (!button) continue;
                this.history.add(identifier); button.click(); Logger.write(`自动点赞：第 ${identifier} 楼`);
                if (!(await Tool.wait(Tool.random(500, 2000), runner))) return;
            }
        }
    }

    class Runner {
        constructor(liker, view) {
            this.liker = liker; this.view = view; this.moving = false; this.address = location.href; this.records = new Set(); this.pacing();
            const push = history.pushState, replace = history.replaceState;
            history.pushState = function() { const response = push.apply(this, arguments); window.dispatchEvent(new Event('lda_route_change')); return response; };
            history.replaceState = function() { const response = replace.apply(this, arguments); window.dispatchEvent(new Event('lda_route_change')); return response; };
            window.addEventListener('popstate', () => window.dispatchEvent(new Event('lda_route_change')));
            window.addEventListener('lda_route_change', () => {
                if (this.address !== location.href) {
                    const previous = Tool.identity(this.address), current = Tool.identity(location.href);
                    this.address = location.href;
                    if (previous && current && previous === current) return;
                    if (this.active) { this.moving = false; this.liker.reset(); this.pacing(); this.resume(); }
                }
            });
            const pause = parseInt(sessionStorage.getItem('lda_pause_until') || '0', 10);
            if (pause > Date.now()) {
                this.view.status('暂停');
                setTimeout(() => { sessionStorage.removeItem('lda_pause_until'); Logger.write('解除限流：恢复运行'); this.start(); }, pause - Date.now());
            } else if (this.active) {
                if (!sessionStorage.getItem('lda_start_time')) sessionStorage.setItem('lda_start_time', String(Date.now()));
                if (this.view.keep) Stealth.keep();
                this.view.status('运行'); this.resume();
            }
        }
        
        get active() { return sessionStorage.getItem('lda_active') === 'true'; } set active(value) { sessionStorage.setItem('lda_active', value); }
        get count() { return parseInt(sessionStorage.getItem('lda_count') || '0', 10); } set count(value) { sessionStorage.setItem('lda_count', value); }
        pacing() { this.records.clear(); this.scrolls = 0; this.characters = 0; this.flips = Tool.random(3, 6); this.words = Tool.random(500, 2000); }
        
        timeout() {
            const start = parseInt(sessionStorage.getItem('lda_start_time') || '0', 10);
            if (this.view.duration > 0 && start > 0 && Date.now() - start >= this.view.duration * 60000) { this.stop(`达到限时 ${this.view.duration} 分钟`); return true; }
            return false;
        }
        
        navigate(address) {
            const context = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window, router = context.Discourse?.__container__?.lookup('service:router');
            if (router) router.transitionTo(address); else location.href = address;
        }
        
        start() {
            this.moving = false; sessionStorage.removeItem('lda_pause_until'); sessionStorage.setItem('lda_start_time', String(Date.now()));
            if (this.view.keep) Stealth.keep();
            this.active = true; this.count = 0; this.view.status('运行'); this.liker.reset(); this.pacing(); this.resume();
        }
        
        stop(reason = '') {
            this.active = false; this.moving = false; this.liker.reset(); this.pacing();
            sessionStorage.removeItem('lda_pause_until'); sessionStorage.removeItem('lda_start_time');
            this.view.status('停止'); Stealth.suspend(); if (reason) Logger.write(`停止：${reason}`);
        }
        
        pause(seconds) {
            this.active = false; this.moving = false; this.liker.reset(); this.pacing();
            sessionStorage.setItem('lda_pause_until', String(Date.now() + seconds * 1000));
            this.view.status('暂停'); Stealth.suspend(); Logger.write(`暂停运行：${Math.round(seconds / 60) || seconds}${seconds >= 60 ? '分钟' : '秒'}`);
            setTimeout(() => {
                if (parseInt(sessionStorage.getItem('lda_pause_until') || '0', 10) <= Date.now()) { sessionStorage.removeItem('lda_pause_until'); Logger.write('解除限流：恢复运行'); this.start(); }
            }, seconds * 1000);
        }
        
        async resume() {
            if (!this.active || this.timeout()) return;
            if (Tool.cloudflare() && !(await Tool.poll(() => !Tool.cloudflare(), 5000, 500))) return;
            if (Tool.identity()) await this.browse(); else await this.forward();
        }
        
        async finish() {
            this.count++; this.view.update(this.count); this.liker.reset(); this.pacing(); this.moving = false;
            if (this.view.limit > 0 && this.count >= this.view.limit) { this.stop(`达到限额 ${this.view.limit} 篇`); return; }
            if (this.timeout()) return;
            await this.forward();
        }
        
        async browse() {
            if (this.moving || this.timeout()) return;
            this.moving = true; this.pacing();
            const context = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            let heading = '';
            
            const ready = await Tool.poll(() => {
                const identifier = Tool.identity(), post = document.querySelector('.topic-post'), model = context.Discourse?.__container__?.lookup?.('controller:topic')?.model;
                if (identifier && post && model?.id && String(model.id) === String(identifier)) { heading = model.title || Tool.title(); return Boolean(heading); }
                return false;
            }, 5000, 500);
            
            if (!ready) { this.moving = false; await this.forward(); return; }
            if (this.view.maximum > 0 && (context.Discourse?.__container__?.lookup('controller:topic')?.model?.posts_count || 0) > this.view.maximum) { await this.finish(); return; }
            
            Logger.write(`开始阅读：${heading}`);
            await this.liker.execute(this);
            if (!(await Tool.wait(Tool.random(2000, 5000), this))) { this.moving = false; return; }
            
            let previous = -1, stuck = 0;
            while (this.active && this.moving) {
                if (this.timeout()) { await this.finish(); return; }
                await Tool.poll(() => Tool.ready(), 5000, 500);
                
                const dot = Tool.unread(), destination = dot ? (dot.closest('.topic-post') || dot).getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3 : 0;
                const step = Math.floor((window.innerHeight || 800) * (this.view.full ? 0.4 : 0.5));
                window.scrollTo({ top: Math.min(Math.max(0, document.documentElement.scrollHeight - window.innerHeight), Math.max(window.scrollY + (Tool.bottom() ? 0 : step), destination)), behavior: document.hidden ? 'instant' : 'smooth' });
                
                await this.liker.execute(this);
                this.scrolls++;
                document.querySelectorAll('.topic-post').forEach(post => { if (post.dataset.postNumber && !this.records.has(post.dataset.postNumber)) { this.records.add(post.dataset.postNumber); this.characters += Tool.measure(post); }});
                
                let delay = Tool.random(500, 2000);
                if (this.scrolls >= this.flips || this.characters >= this.words) { delay = Tool.random(2000, 5000); this.scrolls = 0; this.characters = 0; this.flips = Tool.random(3, 6); this.words = Tool.random(500, 2000); }
                
                await Tool.poll(() => !Tool.unread(), 5000, 500);
                if (!(await Tool.wait(delay, this))) { this.moving = false; return; }
                
                const position = window.scrollY || document.documentElement.scrollTop;
                stuck = (Tool.bottom() || (previous === position && position > 0)) ? stuck + 1 : 0;
                previous = position;
                
                if (stuck >= 2 && Tool.ready() && Tool.bottom()) { await this.finish(); return; }
            }
            this.moving = false;
        }
        
        async forward() {
            if (!this.active || this.timeout()) return;
            this.moving = true; this.liker.reset(); this.pacing();

            let clicked = false;
            if (Tool.identity()) {
                const selector = this.view.skip ? '.more-topics__container .topic-list-item.unseen-topic' : '.more-topics__container .topic-list-item';
                const suggestions = document.querySelectorAll(selector);
                for (const row of suggestions) {
                    const link = row.querySelector('a.title'); 
                    if (!link) continue;
                    if (this.view.maximum > 0) {
                        const counter = row.querySelector('td.topic-likes-replies-data span.number');
                        if (counter && Tool.parse(counter.textContent) > this.view.maximum) continue;
                    }
                    clicked = true;
                    this.moving = false;
                    link.click();
                    return;
                }
            }

            if (!clicked) {
                if (Tool.identity() || !/^\/(latest|top|new|unread)?$/.test(location.pathname)) { 
                    this.navigate('/latest'); 
                    await Tool.poll(() => document.querySelector('.topic-list-item'), 5000, 500); 
                }
            }
            
            while (this.active) {
                if (this.timeout()) { this.moving = false; return; }
                const selector = this.view.skip ? '.topic-list-item.unseen-topic' : '.topic-list-item', items = document.querySelectorAll(selector);
                if (!items.length) {
                    if (!(await Tool.wait(500, this))) return;
                    this.navigate('/latest'); await Tool.poll(() => document.querySelector('.topic-list-item'), 5000, 500); continue;
                }
                
                let target = null;
                for (const row of items) {
                    const link = row.querySelector('a.title'); if (!link) continue;
                    if (this.view.maximum > 0 && (row.querySelector('td.topic-likes-replies-data span.number') ? Tool.parse(row.querySelector('td.topic-likes-replies-data span.number').textContent) : 0) > this.view.maximum) continue;
                    target = link; break;
                }
                
                if (target) { this.moving = false; target.click(); return; }
                
                const previous = items.length;
                window.scrollBy({ top: window.innerHeight * 0.85, behavior: document.hidden ? 'instant' : 'smooth' });
                const timestamp = Date.now();
                while (this.active && Date.now() - timestamp < 5000) { if (!(await Tool.wait(500, this))) return; if (document.querySelectorAll(selector).length > previous || Tool.bottom()) break; }
                if (Tool.bottom()) { this.navigate('/latest'); await Tool.poll(() => document.querySelector('.topic-list-item'), 5000, 500); }
            }
            this.moving = false;
        }
    }

    class View {
        constructor() { this.styles(); this.construct(); this.events(); this.cooldown(); }
        get limit() { return parseInt(document.getElementById('lda-limit').value, 10); }
        get duration() { return parseInt(document.getElementById('lda-duration').value, 10) || 0; }
        get maximum() { return parseInt(document.getElementById('lda-maximum').value, 10) || 0; }
        get threshold() { return parseInt(document.getElementById('lda-threshold').value, 10); }
        get skip() { return document.getElementById('lda-skip').checked; }
        get full() { return document.getElementById('lda-full').checked; }
        get keep() { return document.getElementById('lda-keep').checked; }
        
        styles() {
            GM_addStyle(`
                #lda-box { position:fixed; right:16px; bottom:20px; width:56px; height:56px; background:#fff; border-radius:28px; z-index:99999; box-shadow:0 4px 16px rgba(13,148,136,.18); border:1px solid #ccfbf1; overflow:hidden; transition:all .25s; box-sizing:border-box; display:flex; flex-direction:column; padding:11px }
                #lda-box.expanded { width:265px; height:auto; border-radius:16px; padding:12px; max-height:92vh; overflow-y:auto }
                #lda-box.active-run { border-color:#5eead4; box-shadow:0 0 14px rgba(20,184,166,.4) }
                #lda-panel-content { display:flex; flex-direction:column; gap:8px; font-family:-apple-system,BlinkMacSystemFont,sans-serif; width:100% }
                #lda-header { display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#64748b; height:16px; padding:0 2px }
                #lda-header-title { font-weight:600; color:#0f766e }
                #lda-header a { color:#0d9488; text-decoration:none }
                #lda-bottom-bar { display:flex; align-items:center; justify-content:flex-end; gap:8px; width:100%; height:32px }
                #lda-execute { flex:1; height:32px }
                #lda-gear { width:32px; height:32px; display:flex; align-items:center; justify-content:center; color:#0d9488; cursor:pointer; background:transparent; border:none; border-radius:8px }
                #lda-box:not(.expanded) .lda-icon-close { display:none }
                #lda-box.expanded .lda-icon-gear { display:none }
                #lda-box.expanded .lda-icon-close { display:block }
                #lda-box.expanded #lda-gear { background:#f0fdfa; border:1px solid #ccfbf1 }
                #lda-box:not(.expanded) #lda-panel-content { gap:0 }
                #lda-box:not(.expanded) #lda-bottom-bar { width:32px; height:32px; margin:0 auto }
                #lda-box:not(.expanded) #lda-header, #lda-box:not(.expanded) #lda-execute, #lda-box:not(.expanded) .lda-group, #lda-box:not(.expanded) .lda-extra-group { display:none !important }
                .lda-group { display:flex; flex-direction:column; gap:6px; width:100% }
                .lda-row { display:flex; justify-content:space-between; align-items:center; font-size:13px; color:#1e293b; height:26px }
                .lda-ctrl { display:flex; align-items:center; justify-content:flex-end; width:64px }
                .lda-inp { background:#f0fdfa; border:1px solid #99f6e4; color:#0f766e; border-radius:8px; padding:0 4px; font-size:12px; outline:none; text-align:center; width:64px; height:24px }
                .lda-checkbox { cursor:pointer; width:16px; height:16px; accent-color:#0d9488; margin:0 }
                .lda-button { width:100%; height:32px; border:none; border-radius:10px; font-weight:600; cursor:pointer; color:#fff; font-size:13px; display:flex; align-items:center; justify-content:center }
                .lda-button.start { background:linear-gradient(135deg,#06b6d4,#0d9488) }
                .lda-button.stop { background:linear-gradient(135deg,#14b8a6,#10b981) }
                .lda-button.pause { background:linear-gradient(135deg,#f59e0b,#d97706) }
                #lda-threshold-label { cursor:pointer }
                details summary::-webkit-details-marker, details summary::marker { display:none !important }
                details summary { list-style:none; outline:none }
                details summary.lda-row { display:flex !important; justify-content:space-between !important; align-items:center !important; width:100% !important; height:26px !important }
                .lda-extra-group { display:flex; flex-direction:column; gap:6px; width:100% }
                .lda-action-btn { background:#f0fdfa; border:1px solid #99f6e4; color:#0f766e; border-radius:6px; padding:0 8px; font-size:11px; height:22px; cursor:pointer; line-height:20px; outline:none }
                .lda-grid-content { display:grid; grid-template-columns:1fr 1fr; gap:4px 8px; background:#f0fdfa; border:1px solid #ccfbf1; border-radius:8px; padding:6px 8px; margin-top:4px }
                .lda-grid-item { display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#334155 }
                .lda-grid-item .lda-val { font-weight:600; color:#0f766e; margin-left:4px }
                .lda-empty-tip { grid-column:span 2; text-align:center; color:#94a3b8; font-size:11px; padding:4px 0 }
                #lda-log-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:6px 8px; font-size:11px; color:#475569; max-height:180px; overflow-y:auto; font-family:ui-monospace,monospace; display:flex; flex-direction:column; gap:3px; word-break:break-all }
                .lda-log-time { color:#94a3b8; margin-right:4px } .lda-log-text { color:#334155 }
            `);
        }
        
        construct() {
            this.box = document.createElement('div');
            this.box.id = 'lda-box';
            this.box.innerHTML = `
                <div id="lda-panel-content">
                    <div id="lda-header">
                        <span id="lda-header-title">Auto LD</span><a href="https://github.com/YisRime/AutoLD" target="_blank">GitHub</a>
                    </div>
                    <div class="lda-extra-group">
                        <details style="width:100%" id="lda-user-detail">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起"><span>用户信息</span><div class="lda-ctrl"><button class="lda-action-btn" id="lda-fetch-user">刷新</button></div></summary>
                            <div class="lda-grid-content" id="lda-user-list"><div class="lda-empty-tip">正在获取</div></div>
                        </details>
                        <details style="width:100%" id="lda-credit-detail">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起"><span>用户 LDC</span><div class="lda-ctrl"><button class="lda-action-btn" id="lda-fetch-credit">刷新</button></div></summary>
                            <div class="lda-grid-content" id="lda-credit-list"><div class="lda-empty-tip">正在获取</div></div>
                        </details>
                    </div>
                    <div class="lda-group">
                        <div class="lda-row" title="自动跳过已经阅读过的话题"><span>跳过已读</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-skip"></div></div>
                        <div class="lda-row" title="完整阅读每个话题未读内容"><span>完整阅读</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-full"></div></div>
                        <div class="lda-row" title="设置本次阅读话题数量上限"><span>阅读限额</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-limit" min="0"></div></div>
                        <div class="lda-row" title="设置本次阅读话题时长上限"><span>阅读限时</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-duration" min="0"></div></div>
                        <div class="lda-row" title="阅读总数少于设定值的话题"><span>最大楼层</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-maximum" min="0"></div></div>
                        <div class="lda-row" title="自动点赞的赞数阈值 | 点击文字可重置冷却"><span id="lda-threshold-label">点赞阈值</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-threshold" min="-1"></div></div>
                        <details style="width:100%">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起"><span>高级选项</span></summary>
                            <div style="display:flex;flex-direction:column;gap:6px;padding-top:4px">
                                <div class="lda-row" title="保持不被浏览器休眠"><span>后台保活</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-keep"></div></div>
                                <div class="lda-row" title="手动进行 CF 验证"><span>CF 验证</span><div class="lda-ctrl"><button id="lda-cf-btn" class="lda-inp" style="cursor:pointer">验证</button></div></div>
                            </div>
                        </details>
                        <details style="width:100%">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起"><span>运行日志</span><div class="lda-ctrl"><button class="lda-action-btn" id="lda-clear-log">清空</button></div></summary>
                            <div id="lda-log-box"></div>
                        </details>
                    </div>
                    <div id="lda-bottom-bar">
                        <button id="lda-execute" class="lda-button start">开始</button>
                        <div id="lda-gear" title="展开/收起">
                            <svg class="lda-icon-gear" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.485.485 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                            <svg class="lda-icon-close" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(this.box);
            Logger.setup(document.getElementById('lda-log-box'));
        }
        
        events() {
            this.box.onclick = () => { if (!this.box.classList.contains('expanded')) this.box.classList.add('expanded'); };
            document.getElementById('lda-gear').onclick = (event) => { event.stopPropagation(); this.box.classList.toggle('expanded'); };
            
            [['limit', 0, false], ['duration', 0, false], ['maximum', 128, false], ['threshold', 5, false], ['skip', true, true], ['full', false, true]].forEach(([key, fallback, boolean]) => {
                const element = document.getElementById(`lda-${key}`);
                if (boolean) { element.checked = GM_getValue(`lda_${key}`, fallback); element.onchange = event => GM_setValue(`lda_${key}`, event.target.checked); }
                else { element.value = GM_getValue(`lda_${key}`, fallback); element.onchange = event => GM_setValue(`lda_${key}`, event.target.value); }
            });
            
            const keep = document.getElementById('lda-keep');
            keep.checked = GM_getValue('lda_keep', true);
            keep.onchange = event => { GM_setValue('lda_keep', event.target.checked); if (event.target.checked && this.button.classList.contains('stop')) Stealth.keep(); else Stealth.suspend(); };
            
            document.getElementById('lda-clear-log').onclick = (event) => { event.stopPropagation(); Logger.clear(); };
            document.getElementById('lda-cf-btn').onclick = (event) => {
                event.stopPropagation(); const running = runner.active;
                if (running) { runner.stop('等待 CF 验证'); this.status('暂停'); }
                const button = document.getElementById('lda-cf-btn'); button.disabled = true; button.innerText = '验证中';
                const popup = window.open('https://linux.do/challenge', 'cf_win', 'width=480,height=600');
                const timer = setInterval(() => { if (!popup || popup.closed) { clearInterval(timer); button.disabled = false; button.innerText = '验证'; if (running) runner.start(); } }, 500);
            };
            
            this.button = document.getElementById('lda-execute');
            document.getElementById('lda-threshold-label').onclick = (event) => { event.stopPropagation(); GM_setValue('lda_cooldown', 0); this.cooldown(); if (runner.active) this.status('运行'); };
            
            const bind = (name, loader) => {
                const detail = document.getElementById(`lda-${name}-detail`); detail.addEventListener('toggle', event => { if (event.target.open) loader(); });
                document.getElementById(`lda-fetch-${name}`).onclick = (event) => { event.stopPropagation(); if (!detail.open) detail.open = true; loader(); };
            };
            bind('user', () => this.user()); bind('credit', () => this.credit());
        }
        
        async user() {
            const button = document.getElementById('lda-fetch-user'), list = document.getElementById('lda-user-list'); button.disabled = true;
            try {
                const context = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                const profile = await Tool.poll(() => context.Discourse?.__container__?.lookup?.('service:current-user'), 5000, 500);
                if (!profile?.username) throw new Error('未登录');
                
                const [summary, connect] = await Promise.all([
                    fetch(`/u/${encodeURIComponent(profile.username)}/summary.json`).then(response => response.ok ? response.json() : null),
                    new Promise(resolve => {
                        GM_xmlhttpRequest({
                            method: 'GET', url: 'https://connect.linux.do/', timeout: 5000,
                            onload: response => {
                                if (response.status !== 200) return resolve(null);
                                const documentObj = new DOMParser().parseFromString(response.responseText, 'text/html'), data = {};
                                documentObj.querySelectorAll('.tl3-bar-item').forEach(element => {
                                    const text = element.querySelector('.tl3-bar-label')?.textContent.trim() || '', numbers = element.querySelector('.tl3-bar-nums')?.textContent.trim() || '';
                                    if (text.includes('获赞天数')) data.days = numbers; if (text.includes('用户') || text.includes('不同用户')) data.users = numbers;
                                });
                                documentObj.querySelectorAll('.tl3-quota-card').forEach(element => {
                                    const text = element.querySelector('.tl3-quota-label')?.textContent.trim() || '', numbers = element.querySelector('.tl3-quota-nums')?.textContent.trim() || '';
                                    if (text.includes('被举报')) data.flagged = numbers; else if (text.includes('举报用户')) data.reporters = numbers;
                                });
                                documentObj.querySelectorAll('.tl3-veto-item').forEach(element => {
                                    const text = element.querySelector('.tl3-veto-label')?.textContent.trim() || '', met = element.classList.contains('met'), values = element.querySelectorAll('.tl3-veto-value');
                                    const value = met ? (values[0]?.textContent.trim() || '0') : (values[values.length - 1]?.textContent.trim() || '0');
                                    if (text.includes('禁言')) data.silenced = value; if (text.includes('封禁')) data.suspended = value;
                                });
                                resolve(data);
                            }, onerror: () => resolve(null)
                        });
                    })
                ]);
                
                const stats = summary?.user_summary || {}, format = (value) => String(value || '').replace(/\s+/g, '');
                const verify = (string) => {
                    if (!string || !string.includes('/')) return null; const [current, required] = string.split('/').map(value => parseFloat(value)); return (!isNaN(current) && !isNaN(required)) ? current >= required : null;
                };
                
                const days = format(connect?.days) || '-', users = format(connect?.users) || '-';
                const flagged = format(connect?.flagged) || '0/5', reporters = format(connect?.reporters) || '0/5';
                const silenced = format(connect?.silenced) || '0', suspended = format(connect?.suspended) || '0';
                
                list.innerHTML = `
                    <div class="lda-grid-item"><span>等级</span><span class="lda-val">Lv${profile.trust_level ?? stats.trust_level ?? '-'}</span></div>
                    <div class="lda-grid-item"><span>时长</span><span class="lda-val">${Math.floor((stats.time_read || 0) / 60)}分</span></div>
                    <div class="lda-grid-item"><span>访问天数</span><span class="lda-val">${stats.days_visited || 0}</span></div>
                    <div class="lda-grid-item"><span>浏览帖子</span><span class="lda-val">${stats.posts_read_count || 0}</span></div>
                    <div class="lda-grid-item"><span>浏览话题</span><span class="lda-val">${stats.topics_entered || 0}</span></div>
                    <div class="lda-grid-item"><span>点赞</span><span class="lda-val">${stats.likes_given || 0}</span></div>
                    <div class="lda-grid-item"><span>获赞</span><span class="lda-val">${stats.likes_received || 0}</span></div>
                    <div class="lda-grid-item"><span>回复话题</span><span class="lda-val">${stats.post_count || profile.post_count || 0}</span></div>
                    <div class="lda-grid-item"><span>获赞天数</span><span class="lda-val" style="${verify(days) === false ? 'color:#f59e0b' : ''}">${days}</span></div>
                    <div class="lda-grid-item"><span>获赞用户</span><span class="lda-val" style="${verify(users) === false ? 'color:#f59e0b' : ''}">${users}</span></div>
                    <div class="lda-grid-item"><span>被举报帖子</span><span class="lda-val" style="${parseInt(flagged, 10) > 0 ? 'color:#ef4444' : ''}">${flagged}</span></div>
                    <div class="lda-grid-item"><span>举报用户</span><span class="lda-val" style="${parseInt(reporters, 10) > 0 ? 'color:#ef4444' : ''}">${reporters}</span></div>
                    <div class="lda-grid-item"><span>被禁言</span><span class="lda-val" style="${parseInt(silenced, 10) > 0 ? 'color:#ef4444' : ''}">${silenced}</span></div>
                    <div class="lda-grid-item"><span>被封禁</span><span class="lda-val" style="${parseInt(suspended, 10) > 0 ? 'color:#ef4444' : ''}">${suspended}</span></div>
                `;
                button.innerText = '刷新';
            } catch (error) { list.innerHTML = `<div class="lda-empty-tip" style="color:#ef4444">获取失败: ${error.message}</div>`; button.innerText = '重试'; } finally { button.disabled = false; }
        }
        
        credit() {
            const button = document.getElementById('lda-fetch-credit'), list = document.getElementById('lda-credit-list'); button.disabled = true;
            GM_xmlhttpRequest({
                method: 'GET', url: 'https://credit.linux.do/api/v1/oauth/user-info', timeout: 5000, responseType: 'json',
                onload: (response) => {
                    button.disabled = false; const data = response.response?.data;
                    if (response.status === 200 && data) {
                        list.innerHTML = `
                            <div class="lda-grid-item"><span>可用积分</span><span class="lda-val" style="color:#0d9488">${data.available_balance || 0}</span></div>
                            <div class="lda-grid-item"><span>社区积分</span><span class="lda-val">${data.community_balance || 0}</span></div>
                            <div class="lda-grid-item"><span>累计收入</span><span class="lda-val">+${data.total_receive || 0}</span></div>
                            <div class="lda-grid-item"><span>累计支出</span><span class="lda-val">-${data.total_payment || 0}</span></div>
                        `;
                        button.innerText = '刷新';
                    } else { list.innerHTML = `<div class="lda-empty-tip" style="color:#ef4444">获取失败</div>`; button.innerText = '重试'; }
                },
                onerror: () => { button.disabled = false; button.innerText = '重试'; }
            });
        }
        
        status(state) {
            const active = state === '运行', paused = state.includes('暂停');
            this.box.classList.toggle('active-run', active);
            this.button.className = `lda-button ${active ? 'stop' : (paused ? 'pause' : 'start')}`;
            this.button.innerText = paused ? '暂停' : (active ? `已读: ${sessionStorage.getItem('lda_count') || 0}` : '开始');
        }
        
        cooldown() {
            const label = document.getElementById('lda-threshold-label');
            if (label) { const cooling = GM_getValue('lda_cooldown', 0) > Date.now(); label.style.color = cooling ? '#ef4444' : ''; label.innerText = cooling ? '点赞上限' : '点赞阈值'; }
        }
        
        update(count) { if (this.button.classList.contains('stop') && !this.button.classList.contains('pause')) this.button.innerText = `已读: ${count}`; }
    }

    const view = new View(); Interceptor.setup(view); const runner = new Runner(new Liker(view), view); Interceptor.runner = runner;
    view.button.onclick = () => {
        if (runner.active) return runner.stop('停止');
        if (parseInt(sessionStorage.getItem('lda_pause_until') || '0', 10) > Date.now()) return runner.stop('停止 - 限流');
        runner.start();
    };
})();