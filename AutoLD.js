// ==UserScript==
// @name         Auto Linux Do
// @namespace    https://github.com/YisRime/AutoLD
// @version      3.4.0
// @author       YisRime
// @description  Linux Do 小助手：支持自动阅读与点赞，直跳外链、只看楼主、去模糊/盘古化，并支持一键查询升级指标与积分资产。
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
    const globalContext = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (globalContext.__ldaBooted) return;
    globalContext.__ldaBooted = true;

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

    const Patch = {
        watcher: null,
        _bypassBound: false,

        splash(state) {
            const key = 'linuxdo-kill-splash-style';
            let tag = document.getElementById(key);
            if (state) {
                if (!tag) {
                    tag = document.createElement('style');
                    tag.id = key;
                    tag.textContent = `#d-splash { display: none !important; opacity: 0 !important; pointer-events: none !important; }`;
                    document.head.appendChild(tag);
                }
                const splashElement = document.getElementById('d-splash');
                if (splashElement) splashElement.remove();
            } else if (tag) {
                tag.remove();
            }
        },

        space(text) {
            if (!text || typeof text !== 'string') return text;
            return text
                .replace(/([\u4e00-\u9fa5\u3040-\u30FF])([a-zA-Z0-9_\+\=\@\$\%\^\&\*\-\+\/\\])/g, '$1 $2')
                .replace(/([a-zA-Z0-9_\+\=\@\$\%\^\&\*\-\+\/\\])([\u4e00-\u9fa5\u3040-\u30FF])/g, '$1 $2')
                .replace(/([\u4e00-\u9fa5\u3040-\u30FF])([(\[<])/g, '$1 $2')
                .replace(/([)\]>])([\u4e00-\u9fa5\u3040-\u30FF])/g, '$1 $2');
        },

        typeset(node) {
            if (!node || node.dataset.panguApplied === 'true') return;
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
                acceptNode: (item) => {
                    const tag = item.parentNode?.tagName?.toLowerCase();
                    return ['script', 'style', 'code', 'pre', 'textarea'].includes(tag) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                }
            });
            const list = [];
            while (walker.nextNode()) list.push(walker.currentNode);
            for (const item of list) {
                const after = this.space(item.nodeValue);
                if (after !== item.nodeValue) item.nodeValue = after;
            }
            node.dataset.panguApplied = 'true';
        },

        editor() {
            const input = document.querySelector('.d-editor-input');
            if (!input) return;
            const original = input.value, formatted = this.space(original);
            if (original === formatted) return;
            input.focus();
            if (!document.execCommand('insertText', false, formatted)) {
                input.setRangeText(formatted, 0, input.value.length, 'end');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        },

        button() {
            if (!GM_getValue('lda_opt_typeset', false)) {
                document.querySelector('.pangutext')?.remove();
                return;
            }
            const target = document.querySelector('.save-or-cancel .cancel, .save-or-cancel .create');
            if (target && !document.querySelector('.pangutext')) {
                const btn = document.createElement('button');
                btn.className = 'btn discard-button btn-transparent pangutext';
                btn.type = 'button';
                btn.title = '格式化';
                btn.innerHTML = '<span class="d-button-label">格式化</span>';
                btn.onclick = (e) => { e.preventDefault(); Patch.editor(); };
                target.parentNode.insertBefore(btn, target.nextSibling);
            }
        },

        format(stamp) {
            const date = new Date(stamp), now = new Date();
            const zero = (n) => String(n).padStart(2, '0');
            const h = zero(date.getHours()), m = zero(date.getMinutes());
            if (now.toDateString() === date.toDateString()) return `${h}:${m}`;
            const month = zero(date.getMonth() + 1), day = zero(date.getDate());
            if (now.getFullYear() === date.getFullYear()) return `${month}/${day} ${h}:${m}`;
            return `${date.getFullYear()}/${month}/${day} ${h}:${m}`;
        },

        stamp(node) {
            if (!node || node.dataset.createdTimeDone) return;
            const date = node.querySelector('.relative-date');
            const time = date ? Number(date.dataset.time) : null;
            if (!time) return;

            const diff = Date.now() - time, day = 86400000;
            let color = '#94a3b8';
            if (diff < day) color = '#34d399';
            else if (diff < day * 7) color = '#10b981';
            else if (diff < day * 30) color = '#047857';

            const target = node.querySelector('.post-activity') || node;
            const text = document.createElement('span');
            text.className = 'linuxtime';
            text.style.color = color;
            text.textContent = `（${this.format(time)}）`;
            target.appendChild(text);
            node.dataset.createdTimeDone = 'true';
        },

        inject(style) {
            const key = 'linuxdo-scripts-custom-css';
            let tag = document.getElementById(key);
            if (!style) { if (tag) tag.remove(); return; }
            if (!tag) {
                tag = document.createElement('style');
                tag.id = key;
                document.head.appendChild(tag);
            }
            tag.textContent = style;
        },

        freeze(image) {
            if (!image || image.dataset.gifFrozen) return;
            const path = image.getAttribute('src');
            if (!path || !path.toLowerCase().includes('.gif')) return;

            image.dataset.gifFrozen = 'true';
            const clone = new Image();
            clone.crossOrigin = 'anonymous';
            clone.src = path;
            clone.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = clone.naturalWidth || image.width || 45;
                    canvas.height = clone.naturalHeight || image.height || 45;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(clone, 0, 0, canvas.width, canvas.height);
                    image.src = canvas.toDataURL('image/png');
                } catch {}
            };
        },

        purge() {
            if (!GM_getValue('lda_opt_purge', false)) return;
            const isWelfare = /welfare|36/.test(location.pathname) || Boolean(document.querySelector('.category-breadcrumb .badge-category__name')?.textContent?.includes('福利羊毛'));

            document.querySelectorAll('.topic-list-item').forEach(el => {
                const match = isWelfare || Boolean(el.querySelector('.badge-category__name')?.textContent?.includes('福利羊毛'));
                if (!match) return;
                const closed = el.classList.contains('closed') || Boolean(el.querySelector('.d-icon-lock'));
                const title = el.querySelector('a.title, .raw-topic-link')?.textContent || '';
                if (closed || /已?(?:无|完|出|送|关|结)/.test(title)) {
                    el.style.setProperty('display', 'none', 'important');
                }
            });
        },

        mute(element) {
            if (element.dataset.autoplayDisabled) return;
            if (element.tagName === 'VIDEO') {
                element.autoplay = false;
                element.removeAttribute('autoplay');
                element.pause();
                element.dataset.autoplayDisabled = 'true';
            } else if (element.tagName === 'IFRAME') {
                const src = element.getAttribute('src');
                if (!src) return;
                try {
                    const url = new URL(src, location.origin);
                    if (url.searchParams.get('autoplay') !== 'false' && url.searchParams.get('autoplay') !== '0') {
                        url.searchParams.set('autoplay', 'false');
                        element.src = url.toString();
                    }
                    element.dataset.autoplayDisabled = 'true';
                } catch {}
            }
        },

        clarify(state) {
            const key = 'linuxdo-filter-spoiler-style';
            let tag = document.getElementById(key);
            if (state) {
                if (!tag) {
                    tag = document.createElement('style');
                    tag.id = key;
                    tag.textContent = `.spoiled, .spoiled *, .spoiler, .spoiler * { filter: none !important; opacity: 1 !important; }`;
                    document.head.appendChild(tag);
                }
            } else if (tag) tag.remove();
        },

        tip(target, text) {
            if (!target) return;
            target.title = text;
            let pop = target.parentElement?.querySelector('.lda-pop-tip');
            if (!pop && target.parentElement) {
                pop = document.createElement('div');
                pop.className = 'lda-pop-tip';
                target.parentElement.style.position = 'relative';
                target.parentElement.appendChild(pop);
            }
            if (pop) {
                pop.textContent = text;
                pop.classList.add('show');
                clearTimeout(target._tiptimer);
                target._tiptimer = setTimeout(() => pop.classList.remove('show'), 4000);
            }
        },

        async floors(btn) {
            const ident = Tool.identity();
            if (!ident) return;
            const ctx = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const user = ctx.Discourse?.User?.current()?.username || ctx.Discourse?.__container__?.lookup?.('service:current-user')?.username;

            try {
                let page = 1, collection = [], more = true;
                while (more) {
                    const res = await fetch(`/t/${ident}.json?username_filters=${encodeURIComponent(user)}&page=${page}`);
                    if (!res.ok) break;
                    const result = await res.json();
                    const list = result.post_stream?.posts || [];
                    list.forEach(p => { if (p.post_number > 1) collection.push(p.post_number); });
                    if (list.length < 20) more = false; else page++;
                    if (page > 15) break;
                }
                const msg = collection.length ? `共 ${collection.length} 条回复: ${collection.join(', ')} 楼` : '暂无回复';
                this.tip(btn, msg);
            } catch {
                this.tip(btn, '查询失败');
            }
        },

        control() {
            if (!GM_getValue('lda_opt_floors', false)) {
                document.querySelector('.lda-ownreply-btn')?.remove();
                return;
            }
            const box = document.querySelector('.timeline-controls');
            if (box && !document.querySelector('.lda-ownreply-btn')) {
                const btn = document.createElement('button');
                btn.className = 'btn no-text btn-icon icon btn-default lda-ownreply-btn';
                btn.type = 'button';
                btn.title = '查询我的回复';
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
                btn.onclick = () => Patch.floors(btn);
                box.appendChild(btn);
            }
        },

        bypass(e) {
            if (!GM_getValue('lda_opt_bypass', false)) return;
            const anchor = e?.target?.closest?.('a[href]');
            if (!anchor) return;

            try {
                const url = new URL(anchor.href, location.origin);
                if (url.protocol.startsWith('http') && url.host !== location.host) {
                    e.stopPropagation();
                }
            } catch {}
        },

        setup() {
            const cfg = {
                typeset: GM_getValue('lda_opt_typeset', false),
                stamp: GM_getValue('lda_opt_stamp', false),
                freeze: GM_getValue('lda_opt_freeze', false),
                purge: GM_getValue('lda_opt_purge', false),
                mute: GM_getValue('lda_opt_mute', false),
                clarify: GM_getValue('lda_opt_clarify', false),
                floors: GM_getValue('lda_opt_floors', false),
                bypass: GM_getValue('lda_opt_bypass', false),
                splash: GM_getValue('lda_opt_splash', false),
                style: GM_getValue('lda_opt_style', '')
            };

            this.inject(cfg.style);
            this.clarify(cfg.clarify);
            this.splash(cfg.splash);

            if (!this._bypassBound) {
                window.addEventListener('click', (e) => this.bypass(e), true);
                this._bypassBound = true;
            }

            if (cfg.typeset) {
                document.querySelectorAll('.cooked, #topic-title h1').forEach(el => this.typeset(el));
                this.button();
            } else {
                document.querySelector('.pangutext')?.remove();
            }
            if (cfg.stamp) document.querySelectorAll('.topic-list .age').forEach(el => this.stamp(el));
            if (cfg.freeze) document.querySelectorAll('.post-avatar .avatar, .avatar-flair-preview .avatar, img.avatar').forEach(el => this.freeze(el));
            if (cfg.purge) this.purge();
            if (cfg.mute) document.querySelectorAll('.cooked video, .cooked iframe').forEach(el => this.mute(el));
            if (cfg.floors) this.control(); else document.querySelector('.lda-ownreply-btn')?.remove();

            if (this.watcher) this.watcher.disconnect();
            this.watcher = new MutationObserver((mutations) => {
                const active = {
                    typeset: GM_getValue('lda_opt_typeset', false),
                    stamp: GM_getValue('lda_opt_stamp', false),
                    freeze: GM_getValue('lda_opt_freeze', false),
                    purge: GM_getValue('lda_opt_purge', false),
                    mute: GM_getValue('lda_opt_mute', false),
                    floors: GM_getValue('lda_opt_floors', false),
                    bypass: GM_getValue('lda_opt_bypass', false),
                    splash: GM_getValue('lda_opt_splash', false)
                };

                if (active.splash) {
                    const splashElement = document.getElementById('d-splash');
                    if (splashElement) splashElement.remove();
                }
                if (active.purge) this.purge();

                for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;

                        if (active.typeset) {
                            if (node.classList?.contains('cooked')) this.typeset(node);
                            else node.querySelectorAll?.('.cooked').forEach(el => this.typeset(el));
                        }
                        if (active.stamp) {
                            if (node.classList?.contains('age')) this.stamp(node);
                            else node.querySelectorAll?.('.topic-list .age:not([data-created-time-done])').forEach(el => this.stamp(el));
                        }
                        if (active.freeze) {
                            if (node.matches?.('.avatar')) this.freeze(node);
                            else node.querySelectorAll?.('.avatar').forEach(el => this.freeze(el));
                        }
                        if (active.mute) {
                            if (node.matches?.('video, iframe')) this.mute(node);
                            else node.querySelectorAll?.('video, iframe').forEach(el => this.mute(el));
                        }
                    }
                }

                this.button();
                this.control();
            });

            this.watcher.observe(document.body, { childList: true, subtree: true });
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
                #lda-header { display:flex; justify-content:space-between; align-items:center; font-size:11px; height:16px; padding:0 2px }
                #lda-header a { font-weight:600; color:#0f766e; text-decoration:none }
                #lda-bottom-bar { display:flex; align-items:center; justify-content:flex-end; gap:8px; width:100%; height:32px }
                #lda-gear { width:32px; height:32px; display:flex; align-items:center; justify-content:center; color:#0d9488; cursor:pointer; background:transparent; border:none; border-radius:8px }
                #lda-box .lda-icon-close, #lda-box.expanded .lda-icon-gear { display:none }
                #lda-box.expanded .lda-icon-close { display:block }
                #lda-box.expanded #lda-gear { background:#f0fdfa; border:1px solid #ccfbf1 }
                #lda-box:not(.expanded) #lda-panel-content { gap:0 }
                #lda-box:not(.expanded) #lda-bottom-bar { width:32px; height:32px; margin:0 auto }
                #lda-box:not(.expanded) #lda-header, #lda-box:not(.expanded) .lda-group, #lda-box:not(.expanded) .lda-extra-group, #lda-box:not(.expanded) #lda-quick-settings { display:none !important }
                .lda-group, .lda-extra-group { display:flex; flex-direction:column; gap:6px; width:100% }
                .lda-row { display:flex; justify-content:space-between; align-items:center; font-size:13px; color:#1e293b; height:26px }
                .lda-ctrl { display:flex; align-items:center; justify-content:flex-end; width:64px }
                .lda-inp { background:#f0fdfa; border:1px solid #99f6e4; color:#0f766e; border-radius:8px; padding:0 4px; font-size:12px; outline:none; text-align:center; width:64px; height:24px }
                .lda-checkbox { cursor:pointer; width:16px; height:16px; accent-color:#0d9488; margin:0 }
                #lda-threshold-label { cursor:pointer }
                #lda-box details summary { list-style:none; outline:none; cursor:pointer }
                #lda-box details summary::-webkit-details-marker, #lda-box details summary::marker { display:none !important }
                #lda-box details summary.lda-row { display:flex !important; justify-content:space-between !important; align-items:center !important; width:100% !important; height:26px !important }
                .lda-action-btn { background:#f0fdfa; border:1px solid #99f6e4; color:#0f766e; border-radius:6px; padding:0 8px; font-size:11px; height:22px; cursor:pointer; line-height:20px; outline:none; white-space:nowrap }
                .lda-action-btn.stop, .lda-action-btn.pause { color:#fff; border:none; line-height:22px }
                .lda-action-btn.stop { background:linear-gradient(135deg,#14b8a6,#10b981) }
                .lda-action-btn.pause { background:linear-gradient(135deg,#f59e0b,#d97706) }
                .lda-grid-content { display:grid; grid-template-columns:1fr 1fr; gap:4px 8px; background:#f0fdfa; border:1px solid #ccfbf1; border-radius:8px; padding:6px 8px; margin-top:4px }
                .lda-grid-item { display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#334155 }
                .lda-grid-item .lda-val { font-weight:600; color:#0f766e; margin-left:4px }
                .lda-empty-tip { grid-column:span 2; text-align:center; color:#94a3b8; font-size:11px; padding:4px 0 }
                #lda-log-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:6px 8px; font-size:11px; color:#475569; height:150px; overflow-y:auto; font-family:ui-monospace,monospace; display:flex; flex-direction:column; gap:3px; word-break:break-all }
                .lda-log-time { color:#94a3b8; margin-right:4px } .lda-log-text { color:#334155 }
                .lda-q-set { display:flex; align-items:center; gap:6px; cursor:pointer; color:#0d9488; margin:0; height:32px; padding:0 8px; background:#f0fdfa; border:1px solid #ccfbf1; border-radius:8px; box-sizing:border-box }
                #lda-quick-actions { position:fixed; right:22px; bottom:85px; display:flex; flex-direction:column; gap:8px; z-index:99998 }
                .lda-quick-btn { width:42px; height:42px; background:#fff; border-radius:21px; box-shadow:0 4px 12px rgba(13,148,136,.15); border:1px solid #ccfbf1; display:flex; align-items:center; justify-content:center; color:#0d9488; cursor:pointer; transition:all .2s; user-select:none }
                .lda-quick-btn:hover { background:#f0fdfa; transform:translateY(-2px); box-shadow:0 6px 16px rgba(13,148,136,.2) }
                .lda-quick-btn:active { transform:translateY(0) }
                .lda-quick-btn.act { background:linear-gradient(135deg,#14b8a6,#059669) !important; color:#fff !important; border:none; box-shadow:0 4px 12px rgba(5,150,105,.3) }
                .post-stream.lookopwrapactive .topic-post { display:none !important }
                .post-stream.lookopwrapactive .topic-post.topic-owner { display:block !important }
                .lda-pop-tip { position:absolute; bottom:115%; right:0; background:rgba(15,23,42,0.92); color:#fff; padding:5px 10px; border-radius:6px; font-size:12px; white-space:nowrap; pointer-events:none; opacity:0; transform:translateY(4px); transition:all .2s ease; z-index:10000; box-shadow:0 4px 12px rgba(0,0,0,.2); backdrop-filter:blur(4px) }
                .lda-pop-tip.show { opacity:1; transform:translateY(0) }
                .lda-modal-mask { position:fixed; inset:0; background:rgba(15,23,42,0.45); z-index:100000; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px) }
                .lda-modal-wrap { background:#fff; border-radius:12px; width:92%; max-width:540px; box-shadow:0 8px 30px rgba(13,148,136,.2); border:1px solid #ccfbf1; display:flex; flex-direction:column; padding:14px; gap:8px; box-sizing:border-box }
                .lda-modal-head { display:flex; justify-content:space-between; align-items:center; font-size:13px; font-weight:600; color:#0f766e }
                .lda-modal-close { cursor:pointer; background:transparent; border:none; color:#64748b; display:flex; align-items:center; justify-content:center; padding:2px; border-radius:4px; font-size:18px; line-height:1 }
                .lda-modal-close:hover { color:#0f766e }
                .lda-modal-wrap textarea { width:100%; height:260px; box-sizing:border-box; background:#f8fafc; border:1px solid #99f6e4; border-radius:8px; font-family:ui-monospace,monospace; font-size:12px; padding:8px; outline:none; resize:vertical; color:#0f766e }
            `);
        }
        
        construct() {
            this.box = document.createElement('div');
            this.box.id = 'lda-box';
            this.box.innerHTML = `
                <div id="lda-panel-content">
                    <div id="lda-header">
                        <a id="lda-header-title" href="https://github.com/YisRime/AutoLD" target="_blank">Auto LD v3.4.0 By Yis_Rime</a>
                    </div>
                    <div class="lda-group">
                        <details style="width:100%">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起"><span>自动阅读</span><div class="lda-ctrl"><button class="lda-action-btn" id="lda-execute">开始</button></div></summary>
                            <div style="display:flex;flex-direction:column;gap:6px;padding-top:4px">
                                <div class="lda-row" title="手动进行 CF 验证"><span>CF 验证</span><div class="lda-ctrl"><button id="lda-cf-btn" class="lda-inp" style="cursor:pointer">验证</button></div></div>
                                <div class="lda-row" title="自动跳过已经阅读过的话题"><span>跳过已读</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-skip"></div></div>
                                <div class="lda-row" title="完整阅读每个话题未读内容"><span>完整阅读</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-full"></div></div>
                                <div class="lda-row" title="保持不被浏览器休眠"><span>后台保活</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-keep"></div></div>
                                <div class="lda-row" title="设置本次阅读话题数量上限"><span>阅读限额</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-limit" min="0"></div></div>
                                <div class="lda-row" title="设置本次阅读话题时长上限"><span>阅读限时</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-duration" min="0"></div></div>
                                <div class="lda-row" title="阅读总数少于设定值的话题"><span>最大楼层</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-maximum" min="0"></div></div>
                                <div class="lda-row" title="自动点赞的赞数阈值 | 点击文字可重置冷却"><span id="lda-threshold-label">点赞阈值</span><div class="lda-ctrl"><input type="number" class="lda-inp" id="lda-threshold" min="-1"></div></div>
                                <div id="lda-log-box" style="margin-top:4px;"></div>
                            </div>
                        </details>
                    </div>
                    <div class="lda-extra-group">
                        <details style="width:100%" id="lda-custom-detail">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起"><span>功能配置</span><div class="lda-ctrl"><button class="lda-action-btn" id="lda-btn-custom-style">样式定义</button></div></summary>
                            <div style="display:flex;flex-direction:column;gap:6px;padding-top:4px">
                                <div class="lda-row" title="彻底移除页面加载过渡动画"><span>移除加载动画</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-opt-splash"></div></div>
                                <div class="lda-row" title="智能排版添加中英字符间隙"><span>中英混排优化</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-opt-typeset"></div></div>
                                <div class="lda-row" title="对列表中话题显示创建时间"><span>创建时间显示</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-opt-stamp"></div></div>
                                <div class="lda-row" title="修改动态头像改为静态显示"><span>动态转静态图</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-opt-freeze"></div></div>
                                <div class="lda-row" title="自动过滤羊毛区已结束主题"><span>隐藏已领福利</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-opt-purge"></div></div>
                                <div class="lda-row" title="关闭媒体资源后台自动播放"><span>禁止自动播放</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-opt-mute"></div></div>
                                <div class="lda-row" title="直接显示帖子中的模糊文字"><span>移除文字模糊</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-opt-clarify"></div></div>
                                <div class="lda-row" title="查询当前话题统计自身发言"><span>查看个人回复</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-opt-floors"></div></div>
                                <div class="lda-row" title="点击外部链接跳过确认弹窗"><span>跳过外链确认</span><div class="lda-ctrl"><input type="checkbox" class="lda-checkbox" id="lda-opt-bypass"></div></div>
                            </div>
                        </details>
                        <details style="width:100%" id="lda-user-detail">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起"><span>用户信息</span><div class="lda-ctrl"><button class="lda-action-btn" id="lda-fetch-user">刷新</button></div></summary>
                            <div class="lda-grid-content" id="lda-user-list"><div class="lda-empty-tip">正在获取</div></div>
                        </details>
                        <details style="width:100%" id="lda-credit-detail">
                            <summary class="lda-row" style="cursor:pointer" title="展开/收起"><span>用户 LDC</span><div class="lda-ctrl"><button class="lda-action-btn" id="lda-fetch-credit">刷新</button></div></summary>
                            <div class="lda-grid-content" id="lda-credit-list"><div class="lda-empty-tip">正在获取</div></div>
                        </details>
                    </div>
                    <div id="lda-bottom-bar">
                        <div id="lda-quick-settings" style="display:flex;gap:8px;align-items:center;flex:1;">
                            <label title="只看楼主" class="lda-q-set">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                <input type="checkbox" id="lda-show-lookop" class="lda-checkbox">
                            </label>
                            <label title="回复话题" class="lda-q-set">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 9L5 14L10 19"></path><path d="M5 14H14C17.3137 14 20 11.3137 20 8V5"></path></svg>
                                <input type="checkbox" id="lda-show-reply" class="lda-checkbox">
                            </label>
                            <label title="直达一楼" class="lda-q-set">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                                <input type="checkbox" id="lda-show-floor" class="lda-checkbox">
                            </label>
                        </div>
                        <div id="lda-gear" title="展开/收起">
                            <svg class="lda-icon-gear" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.485.485 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                            <svg class="lda-icon-close" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(this.box);
            Logger.setup(document.getElementById('lda-log-box'));

            this.quickActions = document.createElement('div');
            this.quickActions.id = 'lda-quick-actions';
            this.quickActions.innerHTML = `
                <div id="lda-btn-lookop" class="lda-quick-btn" title="只看楼主">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                </div>
                <div id="lda-btn-reply" class="lda-quick-btn" title="回复话题">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 9L5 14L10 19"></path><path d="M5 14H14C17.3137 14 20 11.3137 20 8V5"></path></svg>
                </div>
                <div id="lda-btn-floor" class="lda-quick-btn" title="直达一楼">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                </div>
            `;
            document.body.appendChild(this.quickActions);
        }
        
        events() {
            this.box.onclick = () => { if (!this.box.classList.contains('expanded')) this.box.classList.add('expanded'); };
            document.getElementById('lda-gear').onclick = (event) => { event.stopPropagation(); this.box.classList.toggle('expanded'); };
            
            const bindQuickToggle = (key, btnId, defaultVal) => {
                const checkbox = document.getElementById(`lda-show-${key}`);
                const btn = document.getElementById(btnId);
                const isShow = GM_getValue(`lda_show_${key}`, defaultVal);
                checkbox.checked = isShow;
                btn.style.display = isShow ? 'flex' : 'none';
                
                checkbox.onchange = (event) => {
                    const checked = event.target.checked;
                    GM_setValue(`lda_show_${key}`, checked);
                    btn.style.display = checked ? 'flex' : 'none';
                };
            };
            bindQuickToggle('lookop', 'lda-btn-lookop', true);
            bindQuickToggle('reply', 'lda-btn-reply', true);
            bindQuickToggle('floor', 'lda-btn-floor', true);

            document.getElementById('lda-btn-lookop').onclick = (event) => {
                event.stopPropagation();
                const btn = document.getElementById('lda-btn-lookop');
                btn.classList.toggle('act');
                const stream = document.querySelector('.post-stream');
                if (stream) stream.classList.toggle('lookopwrapactive');
            };

            document.getElementById('lda-btn-reply').onclick = (event) => {
                event.stopPropagation();
                document.getElementById('topic-footer-buttons')?.querySelector('.topic-footer-main-buttons button')?.click();
            };

            document.getElementById('lda-btn-floor').onclick = (event) => {
                event.stopPropagation();
                const match = location.href.match(/^(https?:\/\/[^\/]+\/t\/[^\/]+\/\d+)/);
                if (match) {
                    const url = match[1];
                    if (location.href !== url) {
                        const context = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                        const router = context.Discourse?.__container__?.lookup('service:router');
                        if (router) router.transitionTo(new URL(url).pathname);
                        else location.href = url;
                    } else {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                } else if (document.querySelector('h1.header-title a')) {
                    location.href = document.querySelector('h1.header-title a').href;
                } else {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            };
            
            [['limit', 0, false], ['duration', 0, false], ['maximum', 128, false], ['threshold', 5, false], ['skip', true, true], ['full', false, true]].forEach(([key, fallback, boolean]) => {
                const element = document.getElementById(`lda-${key}`);
                if (boolean) { element.checked = GM_getValue(`lda_${key}`, fallback); element.onchange = event => GM_setValue(`lda_${key}`, event.target.checked); }
                else { element.value = GM_getValue(`lda_${key}`, fallback); element.onchange = event => GM_setValue(`lda_${key}`, event.target.value); }
            });

            const options = [
                ['splash', false],
                ['typeset', false],
                ['stamp', false],
                ['freeze', false],
                ['purge', false],
                ['mute', false],
                ['clarify', false],
                ['floors', false],
                ['bypass', false]
            ];
            options.forEach(([key, fallback]) => {
                const element = document.getElementById(`lda-opt-${key}`);
                if (!element) return;
                element.checked = GM_getValue(`lda_opt_${key}`, fallback);
                element.onchange = (e) => {
                    GM_setValue(`lda_opt_${key}`, e.target.checked);
                    Patch.setup();
                };
            });

            const btnStyle = document.getElementById('lda-btn-custom-style');
            if (btnStyle) {
                btnStyle.onclick = (event) => {
                    event.stopPropagation();
                    let modal = document.getElementById('lda-style-modal');
                    if (!modal) {
                        modal = document.createElement('div');
                        modal.id = 'lda-style-modal';
                        modal.className = 'lda-modal-mask';
                        modal.innerHTML = `
                            <div class="lda-modal-wrap" onclick="event.stopPropagation()">
                                <div class="lda-modal-head">
                                    <span>自定义 CSS 样式</span>
                                    <button type="button" class="lda-modal-close">&times;</button>
                                </div>
                                <textarea></textarea>
                            </div>
                        `;
                        document.body.appendChild(modal);

                        const textarea = modal.querySelector('textarea');
                        textarea.value = GM_getValue('lda_opt_style', '');
                        textarea.oninput = (e) => {
                            GM_setValue('lda_opt_style', e.target.value);
                            Patch.inject(e.target.value);
                        };

                        const closeModal = () => { modal.style.display = 'none'; };
                        modal.querySelector('.lda-modal-close').onclick = closeModal;
                        modal.onclick = closeModal;
                    } else {
                        modal.querySelector('textarea').value = GM_getValue('lda_opt_style', '');
                        modal.style.display = 'flex';
                    }
                };
            }
            
            const keep = document.getElementById('lda-keep');
            keep.checked = GM_getValue('lda_keep', true);
            keep.onchange = event => { GM_setValue('lda_keep', event.target.checked); if (event.target.checked && this.button.classList.contains('stop')) Stealth.keep(); else Stealth.suspend(); };
            
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
            this.button.className = `lda-action-btn ${active ? 'stop' : (paused ? 'pause' : 'start')}`;
            this.button.innerText = paused ? '暂停' : (active ? `已读: ${sessionStorage.getItem('lda_count') || 0}` : '开始');
        }
        
        cooldown() {
            const label = document.getElementById('lda-threshold-label');
            if (label) { const cooling = GM_getValue('lda_cooldown', 0) > Date.now(); label.style.color = cooling ? '#ef4444' : ''; label.innerText = cooling ? '点赞上限' : '点赞阈值'; }
        }
        
        update(count) { if (this.button.classList.contains('stop') && !this.button.classList.contains('pause')) this.button.innerText = `已读: ${count}`; }
    }

    const view = new View();
    Interceptor.setup(view);
    const runner = new Runner(new Liker(view), view);
    Interceptor.runner = runner;
    Patch.setup();
    window.addEventListener('lda_route_change', () => Patch.setup());
    window.addEventListener('scroll', () => Patch.purge(), { passive: true });

    view.button.onclick = (event) => {
        event.stopPropagation();
        if (runner.active) return runner.stop('停止');
        if (parseInt(sessionStorage.getItem('lda_pause_until') || '0', 10) > Date.now()) return runner.stop('停止 - 限流');
        runner.start();
    };
})();