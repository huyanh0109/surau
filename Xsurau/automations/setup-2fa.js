const { sleep, generate2FACode } = require('./helpers');

/**
 * Setup 2FA Authenticator cho tài khoản Google.
 * Trả về secretKey và cập nhật cột C trong Google Sheet qua Surau API.
 */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    try {
        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 1. Mở trang setup 2FA
        await page.goto('https://myaccount.google.com/two-step-verification/authenticator', {
            waitUntil: 'networkidle', timeout: 30000,
        });
        await sleep(2000);

        // 2. Click "Set up authenticator"
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
            const btn = buttons.find(b =>
                b.textContent?.includes('Set up') || b.textContent?.includes('Thiết lập') ||
                b.textContent?.includes('GET STARTED') || b.textContent?.includes('BẮT ĐẦU')
            );
            if (btn) btn.click();
        });
        await sleep(2000);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 3. Click "Can't scan it?" — thử nhiều cách
        let clicked = false;

        // Cách 1: XPath
        try {
            const xpath = '/html/body/div[12]/div/div[2]/span/div/div/div/div[2]/center/div';
            const found = await page.evaluate((xp) => {
                const result = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const el = result.singleNodeValue;
                if (el) { el.scrollIntoView({ block: 'center' }); return true; }
                return false;
            }, xpath);

            if (found) {
                await sleep(5000);
                await page.evaluate((xp) => {
                    const result = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    const el = result.singleNodeValue;
                    if (el) {
                        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        el.click(); el.click();
                    }
                }, xpath);
                clicked = true;
                await sleep(2000);
            }
        } catch { }

        // Cách 2: jsname
        if (!clicked) {
            try {
                const el = await page.$('[jsname="VdrAGc"]');
                if (el) { await el.scrollIntoView(); await sleep(500); await el.click(); clicked = true; }
            } catch { }
        }

        // Cách 3: text content
        if (!clicked) {
            clicked = await page.evaluate(() => {
                const all = Array.from(document.querySelectorAll('span, a, button, [role="button"]'));
                const el = all.find(e => e.textContent?.includes("Can't scan") || e.textContent?.includes("Không thể quét"));
                if (el) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
                return false;
            });
        }

        if (!clicked) throw new Error('Không thể click "Can\'t scan it?"');
        await sleep(2000);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 4. Lấy secret key
        await sleep(5000);
        const secretKey = await page.evaluate(() => {
            // Method 0: XPath
            try {
                const xpath = '/html/body/div[12]/div/div[2]/span/div/div/ol/li[2]/div/strong';
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const el = result.singleNodeValue;
                if (el?.textContent) {
                    const text = el.textContent.trim().replace(/\s/g, '');
                    if (text.length >= 16) return text;
                }
            } catch { }

            // Method 1: Common selectors
            for (const sel of ['code', 'pre', 'span.X0o8Tb', 'div.XO8yef', '[role="code"]']) {
                for (const el of document.querySelectorAll(sel)) {
                    const text = el.textContent?.trim();
                    if (text && text.length >= 16 && /^[A-Z2-7\s]+$/.test(text)) return text.replace(/\s/g, '');
                }
            }

            // Method 2: All elements
            for (const el of document.querySelectorAll('*')) {
                const text = el.textContent?.trim();
                if (text && text.length >= 16 && text.length <= 40 && /^[A-Z2-7\s]+$/.test(text) && el.children.length === 0)
                    return text.replace(/\s/g, '');
            }

            // Method 3: Regex fallback
            const match = document.body.innerText.match(/\b([A-Z2-7]{16,})\b/);
            return match ? match[1] : '';
        });

        if (!secretKey) throw new Error('Không tìm thấy 2FA secret key');
        log(`🔑 Secret key: ${secretKey}`);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 5. Click Next
        await clickNextButton(page);
        await sleep(2000);

        // 6. Điền mã TOTP
        const code = generate2FACode(secretKey);
        await page.waitForSelector('input[type="tel"], input[type="text"]', { state: 'visible', timeout: 10000 });
        await page.locator('input[type="tel"], input[type="text"]').first().type(code, { delay: 100 });
        await sleep(1000);
        await clickNextButton(page);
        await sleep(3000);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 7. Click "Turn on"
        try {
            await sleep(3000);
            let turnOnClicked = false;
            try {
                await page.waitForSelector('[aria-label="Turn on"], [aria-label="Bật"]', { state: 'visible', timeout: 5000 });
                await page.locator('[aria-label="Turn on"], [aria-label="Bật"]').first().click();
                turnOnClicked = true;
            } catch { }

            if (!turnOnClicked) {
                turnOnClicked = await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button, [role="button"]'))
                        .find(b => b.textContent?.trim() === 'Turn on' || b.textContent?.trim() === 'Bật');
                    if (btn) { btn.click(); return true; } return false;
                });
            }

            if (turnOnClicked) {
                await sleep(2000);
                try {
                    await page.waitForSelector('[aria-label="Turn on 2-Step Verification"]', { timeout: 5000 });
                    const finalBtn = page.locator('[aria-label="Turn on 2-Step Verification"]').first();
                    await finalBtn.scrollIntoViewIfNeeded();
                    await sleep(1000);
                    await finalBtn.click();
                } catch { }

                await sleep(2000);
                try {
                    await page.waitForSelector('[aria-label="Skip"], [aria-label="Bỏ qua"]', { timeout: 5000 });
                    await page.locator('[aria-label="Skip"], [aria-label="Bỏ qua"]').first().click();
                } catch { }
            }
        } catch { }

        // 8. Lấy email và cập nhật Google Sheet
        let associatedEmail = '';
        let sheetUpdateStatus = 'Skipped';
        try {
            const profileEmail = await page.evaluate(() => {
                const xpath = '//*[@id="gb"]/div[2]/div[3]/div[1]/div[2]/div/a';
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const el = result.singleNodeValue;
                if (el) {
                    const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
                    const match = ariaLabel.match(/\(([^)]+@gmail\.com)\)/);
                    if (match) return match[1];
                }
                // Fallback: aria-label selector
                const accountEl = document.querySelector('a[aria-label*="Google Account"], a[aria-label*="Tài khoản Google"]');
                if (accountEl) {
                    const match = accountEl.getAttribute('aria-label')?.match(/\(([^)]+@gmail\.com)\)/);
                    if (match) return match[1];
                }
                return null;
            });

            if (profileEmail) {
                associatedEmail = profileEmail;
                // Cập nhật qua Surau Sheet API (localhost:3500)
                const resp = await fetch('http://localhost:1337/api/sheet/update-2fa-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gmail: associatedEmail, secretKey }),
                });
                sheetUpdateStatus = resp.ok ? 'Updated' : `Failed (${resp.status})`;
            } else {
                // Fallback: dùng email từ sheetRow nếu có
                if (job.sheetRow?.Gmail) {
                    associatedEmail = job.sheetRow.Gmail;
                    const resp = await fetch('http://localhost:1337/api/sheet/update-2fa-key', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ gmail: associatedEmail, secretKey }),
                    });
                    sheetUpdateStatus = resp.ok ? 'Updated (from sheetRow)' : `Failed (${resp.status})`;
                } else {
                    sheetUpdateStatus = 'Email not found';
                }
            }
        } catch (e) { sheetUpdateStatus = `Error: ${e.message}`; }

        log(`✅ Setup 2FA xong! Email: ${associatedEmail} | Sheet: ${sheetUpdateStatus}`);
        return {
            profileId: job.profileId, success: true,
            data: { message: 'Setup 2FA thành công!', secretKey, email: associatedEmail, sheetUpdateStatus },
        };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

async function clickNextButton(page) {
    const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b =>
            b.textContent?.includes('Next') || b.textContent?.includes('Tiếp theo') ||
            b.textContent?.includes('Done') || b.textContent?.includes('Xong')
        );
        if (btn) { btn.click(); return true; } return false;
    });
    if (!clicked) {
        for (const sel of ['[jsname="LgbsSe"]', 'button[type="button"]']) {
            try { await page.locator(sel).first().click(); return; } catch { }
        }
    }
}

module.exports = { name: 'setup-2fa', run };
