/**
 * solve-gesture-captcha.js (Xsurau Automation) v7
 *
 * Chien luoc voi Chromium switch-file patch:
 * Step 1: Launch voi hand_open.y4m -> Click Next -> Doi hand-gestures iframe
 *         Detect Start button (noto=hand_open) -> click Start -> step 1 chay
 * Step 2: Khi noto emoji doi sang gesture khac:
 *         -> Ghi path gesture.y4m vao hand_open.y4m.switch
 *         -> Chrome TU DONG switch fake camera (khong restart!)
 *         -> Click Start -> Detect "You can lower your hand now" -> success!
 *
 * Yeu cau: Chromium build voi patch switch-file trong file_video_capture_device.cc
 */

const path = require('path');
const fs = require('fs');

const RECORDINGS_DIR = path.join(__dirname, '..', 'recordings');

/**
 * Sleep co the bi cancel ngay khi signal bi abort (clearTimeout).
 * -> Dam bao PAUSE dung ngay lap tuc, khong doi 500ms.
 */
function abortableSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        if (signal?.aborted) { clearTimeout(timer); return reject(new Error('STOPPED')); }
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('STOPPED'));
        }, { once: true });
    });
}

function abortablePromise(promise, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('STOPPED'));
        const onAbort = () => reject(new Error('STOPPED'));
        signal?.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (val) => {
                signal?.removeEventListener('abort', onAbort);
                resolve(val);
            },
            (err) => {
                signal?.removeEventListener('abort', onAbort);
                reject(err);
            }
        );
    });
}

// Noto Emoji codepoint -> gesture name
const NOTO_MAP = {
    '270c': 'finger_2',
    '1f91e': 'finger_2',
    '261d': 'finger_1',
    '270a': 'fist',
    '1f44a': 'fist',
    '1f44e': 'thumbs_down',
    '1f44d': 'thumbs_up',
    '1f590': 'hand_open',
    '270b': 'hand_open',
    '1f44b': 'wave',
    '1f918': 'rock',
    '1f596': 'spock',
};

function detectGestureFromText(text) {
    if (!text) return null;
    const t = text.toLowerCase();
    if (t.includes('fist') || t.includes('nam dau') || t.includes('punch')) return 'fist';
    if (t.includes('thumbs up') || t.includes('like')) return 'thumbs_up';
    if (t.includes('thumbs down') || t.includes('dislike')) return 'thumbs_down';
    if (t.includes('two finger') || t.includes('peace') || t.includes('victory') || t.includes('2 finger')) return 'finger_2';
    if (t.includes('one finger') || t.includes('point') || t.includes('1 finger') || t.includes('index')) return 'finger_1';
    if (t.includes('wave') || t.includes('open hand') || t.includes('palm')) return 'hand_open';
    return null;
}

function getAvailableY4m() {
    if (!fs.existsSync(RECORDINGS_DIR)) return [];
    return fs.readdirSync(RECORDINGS_DIR)
        .filter(f => f.endsWith('.y4m'))
        .map(f => f.replace('.y4m', ''));
}

function getY4mPath(gesture) {
    const p = path.join(RECORDINGS_DIR, `${gesture}.y4m`);
    if (fs.existsSync(p)) return p;
    // Fallback to hand_open
    const fallback = path.join(RECORDINGS_DIR, 'hand_open.y4m');
    if (fs.existsSync(fallback)) return fallback;
    return null;
}

function getProfileHandOpenPath(job) {
    if (job && job.manager && job.profileId) {
        const profileDir = path.join(job.manager.profilesDataPath, job.profileId);
        const p = path.join(profileDir, 'fake_camera', 'hand_open.y4m');
        if (fs.existsSync(p)) return p;
    }
    return getY4mPath('hand_open');
}

async function detectGestureChallengePresent(page) {
    try {
        const url = page.url();
        if (url.includes('challenge') || url.includes('recaptcha')) {
            const frames = page.frames();
            return frames.some(f => f.url().includes('hand-gestures') || f.url().includes('recaptcha'));
        }
    } catch (e) {}
    return false;
}

async function findGestureFrame(page) {
    try {
        const frames = page.frames();
        for (const f of frames) {
            const url = f.url();
            if (url.includes('hand-gestures')) return f;
        }
        // Fallback: find recaptcha challenge frame (must not be main frame to avoid matching parent account challenge URL)
        for (const f of frames) {
            const url = f.url();
            if (f !== page.mainFrame() && url.includes('recaptcha') && (url.includes('challenge') || url.includes('bframe'))) return f;
        }
    } catch (e) {}
    return null;
}

/**
 * Inject floating gesture panel vao trang Google.
 * Panel hien thi 5 nut tat ca gesture Step 2.
 * Co nut toggle nho luon hien de bat/tat panel bat cu luc nao.
 */
async function injectGestureOverlay(page, profileId) {
    try {
        await page.evaluate((pId) => {
            // Da inject roi thi return luon, khong tu dong mo panel
            if (document.getElementById('__xsurau_toggle_btn')) {
                return;
            }

            const API = 'http://localhost:3333/api/gesture-watch/switch-cam';
            const GESTURES = [
                { key: 'fist',        label: '✊', name: 'FIST' },
                { key: 'thumbs_up',   label: '👍', name: 'LIKE' },
                { key: 'thumbs_down', label: '👎', name: 'DISLIKE' },
                { key: 'finger_1',    label: '☝️', name: '1 FINGER' },
                { key: 'finger_2',    label: '✌️', name: '2 FINGERS' },
            ];

            // ── PANEL CHINH ──────────────────────────────────────────────
            const panel = document.createElement('div');
            panel.id = '__xsurau_gesture_panel';
            panel.style.cssText = [
                'position:fixed', 'bottom:60px', 'right:16px', 'z-index:2147483647',
                'background:rgba(15,15,20,0.93)',
                'border:1px solid rgba(124,92,191,0.6)',
                'border-radius:10px', 'padding:6px 10px',
                'display:none', 'flex-direction:row', 'align-items:center', 'gap:6px',
                'box-shadow:0 4px 24px rgba(0,0,0,0.7)',
                'backdrop-filter:blur(8px)', 'font-family:monospace',
            ].join(';');

            // Title
            const title = document.createElement('div');
            title.textContent = '🖐 CAM STEP 2';
            title.style.cssText = 'color:#b08fff;font-size:10px;font-weight:bold;letter-spacing:0.5px;padding-right:6px;border-right:1px solid rgba(124,92,191,0.3);margin-right:2px;white-space:nowrap;cursor:default;';
            panel.appendChild(title);

            let activeKey = null;
            const btnEls = {};

            GESTURES.forEach(g => {
                const btn = document.createElement('button');
                btn.id = `__xsurau_gesture_${g.key}`;
                btn.textContent = `${g.label} ${g.name}`;
                btn.style.cssText = [
                    'background:transparent', 'border:1px solid rgba(124,92,191,0.5)',
                    'color:#b08fff', 'padding:5px 8px', 'border-radius:6px',
                    'cursor:pointer', 'font-size:11px', 'font-family:monospace',
                    'font-weight:bold', 'letter-spacing:0.5px',
                    'text-align:center', 'transition:all 0.15s', 'white-space:nowrap',
                ].join(';');

                btn.onmouseover = () => { if (activeKey !== g.key) btn.style.background = 'rgba(124,92,191,0.25)'; };
                btn.onmouseout  = () => { if (activeKey !== g.key) btn.style.background = 'transparent'; };

                btn.onclick = async () => {
                    Object.values(btnEls).forEach(b => {
                        b.style.background = 'transparent';
                        b.style.borderColor = 'rgba(124,92,191,0.5)';
                        b.style.color = '#b08fff';
                    });
                    btn.style.background = 'rgba(124,92,191,0.5)';
                    btn.style.borderColor = '#d4b8ff';
                    btn.style.color = '#fff';
                    activeKey = g.key;
                    try {
                        const res = await fetch(API, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ gesture: g.key, profileId: pId })
                        });
                        const data = await res.json();
                        if (!data.success) console.warn('[Xsurau] Switch cam fail:', data.error);
                    } catch(e) { console.error('[Xsurau]', e.message); }
                    setTimeout(() => {
                        if (activeKey === g.key) {
                            btn.style.background = 'transparent';
                            btn.style.borderColor = 'rgba(124,92,191,0.5)';
                            btn.style.color = '#b08fff';
                            activeKey = null;
                        }
                    }, 5000);
                };
                btnEls[g.key] = btn;
                panel.appendChild(btn);
            });

            // Nut an (HIDE - khong xoa)
            const hideBtn = document.createElement('button');
            hideBtn.textContent = '▼ HIDE';
            hideBtn.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.1);color:#666;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:10px;font-family:monospace;white-space:nowrap;';
            hideBtn.onmouseover = () => hideBtn.style.color = '#888';
            hideBtn.onmouseout  = () => hideBtn.style.color = '#666';
            hideBtn.onclick = () => { panel.style.display = 'none'; };
            panel.appendChild(hideBtn);

            document.body.appendChild(panel);

            // ── NUT TOGGLE NHO LUON HIEN ─────────────────────────────────
            const toggle = document.createElement('button');
            toggle.id = '__xsurau_toggle_btn';
            toggle.textContent = '🖐';
            toggle.title = 'CAM STEP 2 — Click để mở/đóng panel';
            toggle.style.cssText = [
                'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
                'width:36px', 'height:36px', 'border-radius:50%',
                'background:rgba(15,15,20,0.9)',
                'border:2px solid rgba(124,92,191,0.7)',
                'color:#b08fff', 'font-size:16px', 'cursor:pointer',
                'display:flex', 'align-items:center', 'justify-content:center',
                'box-shadow:0 2px 12px rgba(0,0,0,0.6)',
                'transition:all 0.2s', 'padding:0',
            ].join(';');
            toggle.onmouseover = () => {
                toggle.style.borderColor = '#d4b8ff';
                toggle.style.background = 'rgba(124,92,191,0.4)';
                toggle.style.transform = 'scale(1.1)';
            };
            toggle.onmouseout = () => {
                toggle.style.borderColor = 'rgba(124,92,191,0.7)';
                toggle.style.background = 'rgba(15,15,20,0.9)';
                toggle.style.transform = 'scale(1)';
            };
            toggle.onclick = () => {
                const p = document.getElementById('__xsurau_gesture_panel');
                if (!p) return;
                const visible = p.style.display !== 'none';
                p.style.display = visible ? 'none' : 'flex';
            };
            document.body.appendChild(toggle);
        }, profileId);
    } catch (e) {
        // Cross-origin hoac page dang navigate, bo qua
    }
}

async function findNextButton(page) {
    try {
        const frames = page.frames();
        for (const f of frames) {
            const btn = await f.evaluate(() => {
                const els = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]'));
                return els.some(e => {
                    const txt = (e.textContent || e.value || '').trim().toLowerCase();
                    return (txt === 'next' || txt === 'tiep theo' || txt.includes('next')) && e.getBoundingClientRect().width > 0;
                });
            }).catch(() => false);
            if (btn) return f;
        }
    } catch (e) {}
    return null;
}

async function clickNextInAnyFrame(page) {
    try {
        const frames = page.frames();
        for (const f of frames) {
            if (f === page.mainFrame()) continue; // Skip main frame to avoid clicking parent Next button
            const url = f.url();
            if (!url.includes('recaptcha') && !url.includes('hand-gestures')) continue;
            const clicked = await f.evaluate(() => {
                const els = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], div[jsname="LgbsSe"]'));
                for (const el of els) {
                    const jsname = el.getAttribute('jsname');
                    if (jsname === 'LgbsSe') { el.click(); return true; }
                    const txt = (el.textContent || el.value || '').trim().toLowerCase();
                    if ((txt === 'next' || txt === 'tiep theo' || txt === 'continue' || txt === 'weiter' || txt === 'suivant')
                        && el.getBoundingClientRect().width > 0) {
                        el.click(); return true;
                    }
                }
                return false;
            }).catch(() => false);
            if (clicked) return true;
        }
    } catch (e) {}
    return false;
}

async function clickButtonInFrame(frame, labels) {
    try {
        return await frame.evaluate((labels) => {
            const els = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]'));
            for (const el of els) {
                const txt = (el.textContent || el.value || '').trim().toLowerCase();
                if (labels.some(l => txt === l || txt.includes(l)) && el.getBoundingClientRect().width > 0) {
                    el.click(); return true;
                }
            }
            return false;
        }, labels);
    } catch (e) {}
    return false;
}

async function getGestureFrameInfo(frame) {
    return frame.evaluate(() => {
        const isVisible = (el) => {
            try {
                const tag = el.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'head', 'meta', 'link'].includes(tag)) return false;
                
                if (el.offsetWidth === 0 && el.offsetHeight === 0) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) return false;
                }
                
                let curr = el;
                while (curr && curr !== document.body) {
                    const style = window.getComputedStyle(curr);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                    curr = curr.parentElement;
                }
                return true;
            } catch(e) {
                return false;
            }
        };

        // Heading
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, [class*="heading"], [class*="title"]'));
        const heading = headings.map(h => h.textContent?.trim()).filter(Boolean)[0] || document.title || '';

        // Noto emoji -> gesture
        const NOTO_MAP_INLINE = {
            '270c': 'finger_2', '1f91e': 'finger_2',
            '261d': 'finger_1',
            '270a': 'fist', '1f44a': 'fist',
            '1f44e': 'thumbs_down',
            '1f44d': 'thumbs_up',
            '1f590': 'hand_open', '270b': 'hand_open',
            '1f44b': 'wave',
            '1f918': 'rock',
            '1f596': 'spock',
        };

        const EMOJI_CHAR_MAP = {
            '✌': 'finger_2',
            '✌️': 'finger_2',
            '🤞': 'finger_2',
            '☝': 'finger_1',
            '☝️': 'finger_1',
            '✊': 'fist',
            '👊': 'fist',
            '👎': 'thumbs_down',
            '👍': 'thumbs_up',
            '🖐': 'hand_open',
            '🖐️': 'hand_open',
            '✋': 'hand_open',
            '✋️': 'hand_open',
            '👋': 'wave',
            '🤘': 'rock',
            '🖖': 'spock',
        };

        const detectGestureFromTextInline = (text) => {
            if (!text) return null;
            const t = text.toLowerCase();
            if (t.includes('fist') || t.includes('nam dau') || t.includes('punch') || t.includes('nắm đấm') || t.includes('nắm tay')) return 'fist';
            // Check thumbs_down / dislike first to avoid matching "like" inside "dislike"
            if (t.includes('thumbs down') || t.includes('dislike') || t.includes('không thích')) return 'thumbs_down';
            if (t.includes('thumbs up') || t.includes('like') || t.includes('thích')) return 'thumbs_up';
            if (t.includes('two finger') || t.includes('peace') || t.includes('victory') || t.includes('2 finger') || t.includes('hòa bình')) return 'finger_2';
            if (t.includes('one finger') || t.includes('point') || t.includes('1 finger') || t.includes('index') || t.includes('1 ngón')) return 'finger_1';
            if (t.includes('wave') || t.includes('open hand') || t.includes('palm') || t.includes('bàn tay')) return 'hand_open';
            return null;
        };

        let resolvedGesture = null;
        let notoUrl = '';
        let detectionSource = '';
        const urls = [];

        // Filter elements under active consideration (excluding our own overlay widgets and invisible elements)
        const allElements = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.closest('[id^="__xsurau"]')) return false;
            return isVisible(el);
        });

        // 1. Scan attributes (alt, aria-label, title) of all elements
        for (const el of allElements) {
            const alt = el.getAttribute('alt') || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const title = el.getAttribute('title') || '';
            const id = el.id || '';
            const className = typeof el.className === 'string' ? el.className : '';

            const attrText = `${alt} ${ariaLabel} ${title}`.trim();
            if (attrText) {
                // Emoji in attributes
                for (const [emoji, gest] of Object.entries(EMOJI_CHAR_MAP)) {
                    if (attrText.includes(emoji)) {
                        resolvedGesture = gest;
                        detectionSource = `attr-emoji-[${emoji}]-in-${el.tagName.toLowerCase()}`;
                        break;
                    }
                }
                if (resolvedGesture) break;

                // Keyword in attributes
                const textGestAttr = detectGestureFromTextInline(attrText);
                if (textGestAttr) {
                    resolvedGesture = textGestAttr;
                    detectionSource = `attr-text-[${textGestAttr}]-in-${el.tagName.toLowerCase()}`;
                    break;
                }
            }

            // Keyword in class/ID names
            const classAndId = `${className} ${id}`.trim();
            if (classAndId) {
                const classGest = detectGestureFromTextInline(classAndId);
                if (classGest) {
                    resolvedGesture = classGest;
                    detectionSource = `class-id-[${classGest}]-in-${el.tagName.toLowerCase()}`;
                    break;
                }
            }
        }

        // 2. Scan URLs (images, style attributes, and computed styles)
        if (!resolvedGesture) {
            document.querySelectorAll('img, image, object, embed, source, iframe').forEach(el => {
                if (el.closest('[id^="__xsurau"]')) return;
                if (!isVisible(el)) return;
                const src = el.src || el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('href') || '';
                if (src) urls.push(src);
            });

            // Find elements with inline style or class to check styles
            const styledElements = allElements.filter(el => el.className || el.id || el.getAttribute('style'));
            styledElements.forEach(el => {
                const style = el.getAttribute('style') || '';
                if (style.includes('url(')) {
                    const match = style.match(/url\(['"]?([^'")]+)['"]?\)/);
                    if (match && match[1]) urls.push(match[1]);
                }
                try {
                    const compBg = window.getComputedStyle(el).backgroundImage;
                    if (compBg && compBg !== 'none' && compBg.includes('url(')) {
                        const match = compBg.match(/url\(['"]?([^'")]+)['"]?\)/);
                        if (match && match[1]) urls.push(match[1]);
                    }
                } catch (e) {}
            });

            const uniqueUrls = [...new Set(urls)];
            for (const src of uniqueUrls) {
                const lowercaseSrc = src.toLowerCase();
                if (lowercaseSrc.includes('notoemoji') || lowercaseSrc.includes('gstatic') || lowercaseSrc.includes('emoji')) {
                    notoUrl = src;
                    // Direct segment match
                    for (const [code, gest] of Object.entries(NOTO_MAP_INLINE)) {
                        if (lowercaseSrc.includes(`/${code}`) || 
                            lowercaseSrc.includes(`_${code}`) || 
                            lowercaseSrc.includes(`u${code}`) || 
                            lowercaseSrc.includes(`emoji_${code}`) ||
                            lowercaseSrc.includes(`/${code}.`)) {
                            resolvedGesture = gest;
                            detectionSource = `url-segment-[${code}]`;
                            break;
                        }
                    }
                    if (resolvedGesture) break;

                    // Regex fallback
                    const match = src.match(/\/notoemoji\/(?:[^/]+\/)?([0-9a-f_]+)(?:\/|$)/i);
                    if (match) {
                        const code = match[1].split('_')[0].toLowerCase();
                        if (NOTO_MAP_INLINE[code]) {
                            resolvedGesture = NOTO_MAP_INLINE[code];
                            detectionSource = `url-regex-[${code}]`;
                            break;
                        }
                    }
                }
            }
        }

        // 3. Scan inner text content (only on visible leaf elements)
        if (!resolvedGesture) {
            const leafElements = allElements.filter(el => el.children.length === 0 && el.textContent?.trim());
            for (const el of leafElements) {
                const txt = el.textContent.trim();
                // Emoji char in text
                for (const [emoji, gest] of Object.entries(EMOJI_CHAR_MAP)) {
                    if (txt.includes(emoji)) {
                        resolvedGesture = gest;
                        detectionSource = `text-emoji-[${emoji}]-in-${el.tagName.toLowerCase()}`;
                        break;
                    }
                }
                if (resolvedGesture) break;

                // Text keyword in text
                const textGest = detectGestureFromTextInline(txt);
                if (textGest) {
                    resolvedGesture = textGest;
                    detectionSource = `text-keyword-[${textGest}]-in-${el.tagName.toLowerCase()}`;
                    break;
                }
            }
        }

        // Buttons
        const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const labels = els.map(e => (e.textContent || '').trim().toLowerCase());
        const hasStart = labels.some(l => l === 'start') &&
            !!els.find((e, i) => labels[i] === 'start' && e.getBoundingClientRect().width > 0);
        const hasTryAgain = labels.some(l => l.includes('try again'));
        const hasNext = labels.some(l => l === 'next' || l === 'tiep theo') &&
            !!els.find((e, i) => (labels[i] === 'next' || labels[i] === 'tiep theo') && e.getBoundingClientRect().width > 0);

        // Success text
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const isSuccess = bodyText.includes('lower your hand') ||
                          bodyText.includes('you can lower') ||
                          bodyText.includes('verification complete') ||
                          bodyText.includes('verified') ||
                          bodyText.includes('ha tay');

        // Failure text
        const hasStoppedCamera = bodyText.includes("stopped using your camera") ||
                                 bodyText.includes("ngừng sử dụng máy ảnh");

        const isFailure = bodyText.includes("couldn't verify") ||
                          bodyText.includes("couldn’t verify") ||
                          bodyText.includes("could not verify") ||
                          bodyText.includes("không thể xác minh") ||
                          (hasStoppedCamera && !isSuccess);

        return { 
            heading, 
            notoGesture: resolvedGesture, 
            notoUrl: notoUrl.substring(0, 100), 
            detectionSource,
            hasStart, 
            hasTryAgain, 
            hasNext, 
            isSuccess, 
            isFailure, 
            bodyText: bodyText.substring(0, 300),
            allUrls: resolvedGesture ? [] : urls.map(u => u.substring(0, 120)).slice(0, 10)
        };
    }).catch(err => ({ heading: '', notoGesture: null, notoUrl: '', detectionSource: 'error-' + err.message, hasStart: false, hasTryAgain: false, hasNext: false, isSuccess: false, isFailure: false, bodyText: '', allUrls: [] }));
}

async function solveCaptchaProcess(currentPage, job, signal, log) {
    const sleep = (ms) => abortableSleep(ms, signal);

    if (!getAvailableY4m().includes('hand_open')) {
        return { success: false, error: 'Missing hand_open.y4m' };
    }

    // 1. Reset camera ve hand_open.y4m (profile-specific path)
    try {
        const y4mPath = getProfileHandOpenPath(job);
        const switchFile = y4mPath + '.switch';
        fs.writeFileSync(switchFile, y4mPath, 'utf8');
        log('Reset camera ve hand_open...');
        await sleep(1500);
        try { fs.unlinkSync(switchFile); } catch (e) {}
    } catch (e) {
        if (signal?.aborted) return { success: false, error: 'STOPPED' };
    }

    if (signal?.aborted) return { success: false, error: 'STOPPED' };

    // Auto-click reCAPTCHA checkbox if visible and unchecked
    try {
        const hasChallenge = await currentPage.evaluate(() => {
            return !!document.querySelector('iframe[src*="bframe"], iframe[src*="hand-gestures"]');
        }).catch(() => false);

        if (!hasChallenge) {
            const hasAnchorIframe = await currentPage.evaluate(() => {
                return !!document.querySelector('iframe[src*="anchor"]');
            }).catch(() => false);
            if (hasAnchorIframe) {
                const checkbox = currentPage.frameLocator('iframe[src*="anchor"]').locator('#recaptcha-anchor');
                if (await checkbox.isVisible({ timeout: 1000 }).catch(() => false)) {
                    const ariaChecked = await checkbox.getAttribute('aria-checked', { timeout: 1000 }).catch(() => 'false');
                    if (ariaChecked !== 'true') {
                        log('reCAPTCHA checkbox visible and unchecked. Clicking it...');
                        await checkbox.click({ timeout: 2000 });
                        await sleep(2500);
                    }
                }
            }
        }
    } catch (e) {}

    if (signal?.aborted) return { success: false, error: 'STOPPED' };

    // 2. Click Next (man hinh consent)
    log('Click Next...');
    for (let i = 0; i < 20 && !signal?.aborted; i++) {
        // Neu da co gesture frame thi bo qua Click Next luon
        const gf = await findGestureFrame(currentPage);
        if (gf) {
            break;
        }

        if (await clickNextInAnyFrame(currentPage)) {
            log('Next clicked -> gesture challenge loading...');
            break;
        }
        await sleep(500);
    }
    if (signal?.aborted) return { success: false, error: 'STOPPED' };

    // 3. Cho hand-gestures iframe
    log('Cho hand-gestures iframe...');
    let gestureFrame = null;
    for (let i = 0; i < 40 && !signal?.aborted; i++) {
        gestureFrame = await findGestureFrame(currentPage);
        if (gestureFrame) {
            log(`Gesture frame found: ${gestureFrame.url().substring(0, 70)}`);
            break;
        }
        await sleep(500);
    }
    if (!gestureFrame) return { success: false, error: 'hand-gestures frame not found' };
    if (signal?.aborted) return { success: false, error: 'STOPPED' };

    try {
        await currentPage.context().grantPermissions(['camera', 'microphone'], { origin: 'https://www.google.com' });
    } catch (e) {}

    // Inject floating gesture panel vao trang de nguoi dung co the tu switch cam
    await injectGestureOverlay(currentPage, job.profileId);

    let captchaCompleted = false;
    let finalStep2Gesture = null;

    // Vong lap giam sat noi bo (toi da 5 luot)
    solve_loop: for (let loopAttempt = 1; loopAttempt <= 5 && !signal?.aborted; loopAttempt++) {
        let step2Gesture = null;
        let step1Started = false;
        let wrongCount = 0;
        const step1Deadline = Date.now() + 90000;

        // === PHASE 1: Cho buoc 2 xuat hien (emoji khac hand_open) ===
        for (let attempt = 0; attempt < 180 && !signal?.aborted; attempt++) {
            await sleep(500);
            if (signal?.aborted) break;

            const gf = await findGestureFrame(currentPage);
            if (!gf || gf.isDetached()) {
                await sleep(500);
                continue;
            }

            const info = await getGestureFrameInfo(gf).catch(() => null);
            if (!info) continue;

            if (info.isFailure) {
                log("We couldn't verify your info");
                log("We've stopped using your camera");
                return { success: false, error: "We couldn't verify your info" };
            }

            const h = (info.heading || '').toLowerCase();

            // Buoc 2 detect qua emoji hoac text
            const textGesture = detectGestureFromText(info.heading) || detectGestureFromText(info.bodyText);
            const resolvedGesture = info.notoGesture || textGesture;

            if (resolvedGesture && resolvedGesture !== 'hand_open') {
                step2Gesture = resolvedGesture;
                log(`[STEP2] gesture="${step2Gesture}" src="${info.detectionSource||'-'}" heading="${info.heading}"`);
                break;
            }

            // Something went wrong
            if (h.includes('something went wrong') && info.hasStart) {
                wrongCount++;
                if (wrongCount > 5) return { success: false, error: 'Too many Something went wrong' };
                await clickButtonInFrame(gf, ['start']).catch(() => {});
                log(`Something went wrong (${wrongCount}/5) -> retry`);
                step1Started = false;
                await sleep(2000);
                continue;
            }

            // Man hinh intro / Next
            if (h.includes('gesture with your hand') || h.includes('gesture with') || (info.hasNext && !info.hasStart)) {
                if (info.hasNext) {
                    await clickButtonInFrame(gf, ['next', 'continue', 'start']).catch(() => {});
                    log('Next in gesture frame -> camera loading...');
                    await sleep(2000);
                }
                continue;
            }

            // Step 1: hand_open + Start
            if (!step1Started && info.notoGesture === 'hand_open' && info.hasStart) {
                await clickButtonInFrame(gf, ['start']).catch(() => {});
                log('Start step 1 (noto=hand_open)');
                step1Started = true;
                await sleep(2000);
                continue;
            }

            // Try Again
            if (info.hasTryAgain && info.hasStart) {
                await clickButtonInFrame(gf, ['start']).catch(() => {});
                log('Try Again -> Start');
                step1Started = false;
                await sleep(2000);
                continue;
            }

            if (Date.now() > step1Deadline) {
                log('Step 1 timeout 90s');
                return { success: false, error: 'Step 1 timeout' };
            }
        }

        if (signal?.aborted) return { success: false, error: 'STOPPED' };
        if (!step2Gesture) {
            log('Khong detect duoc gesture buoc 2!');
            step2Gesture = 'hand_open';
        }

        // === PHASE 2: Switch Y4M ===
        const newY4mPath = getY4mPath(step2Gesture);
        if (!newY4mPath) return { success: false, error: `No Y4M for ${step2Gesture}` };

        const handOpenPath = getProfileHandOpenPath(job);
        const switchFile = handOpenPath + '.switch';
        log(`Switch camera: hand_open -> ${step2Gesture}`);
        fs.writeFileSync(switchFile, newY4mPath, 'utf8');
        log('Switch file written -> Chrome switching...');
        await sleep(2000);
        if (signal?.aborted) return { success: false, error: 'STOPPED' };

        const step2Deadline = Date.now() + 60000;
        let resetDetected = false;
        let step2StartCount = 0;

        try {
            for (let attempt = 0; attempt < 120 && !captchaCompleted && !signal?.aborted; attempt++) {
                await sleep(500);
                if (signal?.aborted) break;

                const gf = await findGestureFrame(currentPage);
                if (!gf || gf.isDetached()) {
                    // Gesture frame mat -> co the da thanh cong, check URL
                    const url = currentPage.url();
                    if (!url.includes('challenge') && !url.includes('recaptcha') && url.includes('google')) {
                        log(`DONE (frame gone, URL ok): ${url.substring(0, 60)}`);
                        captchaCompleted = true;
                        finalStep2Gesture = step2Gesture;
                    }
                    await sleep(500);
                    continue;
                }

                const info = await getGestureFrameInfo(gf).catch(() => null);
                if (!info) continue;

                if (info.isFailure) {
                    log("We couldn't verify your info");
                    log("We've stopped using your camera");
                    return { success: false, error: "We couldn't verify your info" };
                }

                const h = (info.heading || '').toLowerCase();

                // Reset ve buoc 1
                if (h.includes('something went wrong') || info.notoGesture === 'hand_open' || h.includes('gesture with your hand') || h.includes('gesture with')) {
                    gestureFrame = gf;
                    resetDetected = true;
                    break;
                }

                // === DETECT THANH CONG: "You can lower your hand now" ===
                // Day la dong chu xuat hien TRUOC KHI URL thay doi
                // Check ca heading lan bodyText/isSuccess
                const successInHeading = h.includes('lower your hand') || h.includes('you can lower') ||
                                         h.includes('ha tay') || h.includes('verification complete');
                if (successInHeading || info.isSuccess) {
                    log('You can lower your hand now');
                    log("We've stopped using your camera");
                    captchaCompleted = true;
                    finalStep2Gesture = step2Gesture;
                    // Cho them 500ms de Google redirect
                    await sleep(500).catch(() => {});
                    break;
                }

                // Click Start neu can
                if (info.hasStart) {
                    step2StartCount++;
                    if (step2StartCount >= 3) {
                        log(`Start step 2 clicked ${step2StartCount} times. Stuck!`);
                        return { success: false, error: "Stuck at Step 2 Start" };
                    }
                    await clickButtonInFrame(gf, ['start']).catch(() => {});
                    log(`Start step 2 (${step2Gesture})`);
                    await sleep(3000);
                    continue;
                }

                // Fallback: check URL change
                const url = currentPage.url();
                if (!url.includes('challenge') && !url.includes('recaptcha') && url.includes('google')) {
                    log('You can lower your hand now');
                    log("We've stopped using your camera");
                    log(`DONE via URL: ${url.substring(0, 60)}`);
                    captchaCompleted = true;
                    finalStep2Gesture = step2Gesture;
                    break;
                }

                if (Date.now() > step2Deadline) { log('Step 2 timeout 60s'); break; }
            }
        } finally {
            // Reset camera ve hand_open
            try {
                const hp = getProfileHandOpenPath(job);
                if (hp) {
                    const sf = hp + '.switch';
                    fs.writeFileSync(sf, hp, 'utf8');
                    await sleep(300).catch(() => {});
                    try { fs.unlinkSync(sf); } catch (e) {}
                }
            } catch (e) {}
        }

        if (captchaCompleted) break;
        if (resetDetected) continue solve_loop;
        break;
    }

    if (captchaCompleted) return { success: true, gesture: finalStep2Gesture };
    return { success: false, error: 'Step 2 timeout/failure' };
}

// ============================================================================
// run() — Vong lap chinh: lien tuc giai captcha, khong can restart
// ============================================================================
async function run(page, job, signal, logger, options = {}) {
    const log = (msg) => {
        if (!signal?.aborted) { logger?.(msg); console.log(`[GestureCaptcha] ${msg}`); }
    };
    const sleep = options.sleep || ((ms) => abortableSleep(ms, signal));
    log(`Gesture Captcha Solver`);

    const manager = job.manager;
    const profileId = job.profileId;
    if (!manager) return { profileId, success: false, error: 'No manager' };

    if (!getAvailableY4m().includes('hand_open')) return { profileId, success: false, error: 'Missing hand_open.y4m' };

    let currentPage = page;
    await sleep(1000).catch(() => {});

    let success = false;
    while (!success && !signal?.aborted) {
        try {
            if (currentPage.isClosed()) {
                log('Trang web da dong -> Dung kịch bản.');
                break;
            }

            // Cap nhat page moi nhat
            const running = manager.runningProfiles?.get(profileId);
            if (running) {
                const pages = running.context?.pages?.() || [];
                const livePage = pages.find(p => !p.isClosed());
                if (livePage) currentPage = livePage;
            }

            const solveRes = await solveCaptchaProcess(currentPage, job, signal, log);
            
            if (signal?.aborted || solveRes.error === 'STOPPED') break;

            if (solveRes.success) {
                log(`Thanh cong! (${solveRes.gesture || ''})`);
                success = true;
            } else {
                if (solveRes.error === "We couldn't verify your info" || solveRes.error === "Stuck at Step 2 Start") {
                    log(`Phat hien loi (${solveRes.error}) -> F5/Reload trang va giai lai tu dau...`);
                    try {
                        await abortablePromise(currentPage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }), signal);
                    } catch (e) {
                        if (e.message === 'STOPPED' || signal?.aborted) throw e;
                        log(`Loi khi reload: ${e.message}`);
                    }
                    await sleep(1500);
                } else {
                    log(`That bai (${solveRes.error}) -> Dung kịch bản.`);
                    break;
                }
            }
        } catch (err) {
            if (signal?.aborted || err.message === 'STOPPED') break;
            const msg = err?.message || '';
            if (msg.includes('Target closed') || msg.includes('Session closed') || msg.includes('context destroyed')) break;
            log(`Loi ngoai le: ${msg} -> Dung kịch bản.`);
            break;
        }
    }

    log('Da dung.');
    return { profileId, success };
}

module.exports = {
    name: 'solve-gesture-captcha-copy',
    description: 'Vuot Google Gesture CAPTCHA: Y4M + Chromium switch-file patch (Copy)',
    icon: '🖐️',
    run,
    detectGestureFromText,
    solveCaptchaProcess,
    detectGestureChallengePresent,
    injectGestureOverlay,
    abortablePromise,
};
