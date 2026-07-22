const { chromium } = require('patchright');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (err) => {
    console.error('[Inspector] Unhandled Rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
    console.error('[Inspector] Uncaught Exception:', err?.message || err);
});

const PROFILES_DATA_DIR = 'G:\\XsurauDataVer3\\profiles_data';
const DUMP_FILE = path.join(__dirname, 'dom_dump.txt');

async function inspectProfile(profileId, port) {
    console.log(`[Inspector] Checking profile ${profileId} on port ${port}...`);
    let browser;
    try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        console.log(`[Inspector] Connected to ${profileId}`);
    } catch (e) {
        // Failed to connect, probably not running yet or already closed
        return;
    }

    try {
        const contexts = browser.contexts();
        for (const context of contexts) {
            const pages = context.pages();
            for (const page of pages) {
                const frames = page.frames();
                console.log(`[Inspector] Page: ${page.url()} has ${frames.length} frames`);
                for (const frame of frames) {
                    const url = frame.url();
                    console.log(`  - Frame: ${url}`);
                    if ((url.includes('hand-gestures') || url.includes('recaptcha')) && !url.includes('accounts.google.com')) {
                        console.log(`[Inspector] Found captcha frame in page: ${page.url()}`);
                        
                        const html = await frame.content().catch(() => '');
                        const info = await frame.evaluate(() => {
                            const tags = [];
                            document.querySelectorAll('*').forEach(el => {
                                const tag = el.tagName.toLowerCase();
                                const attrs = {};
                                for (let i = 0; i < el.attributes.length; i++) {
                                    const attr = el.attributes[i];
                                    attrs[attr.name] = attr.value;
                                }
                                
                                // Clean text
                                const text = el.children.length === 0 ? el.textContent.trim() : '';
                                
                                if (['img', 'image', 'svg', 'object', 'embed', 'source', 'iframe', 'canvas'].includes(tag) || text) {
                                    tags.push({ tag, attrs, text, outerHTML: el.outerHTML.substring(0, 500) });
                                }
                            });
                            return {
                                bodyText: document.body?.innerText || '',
                                elements: tags
                            };
                        }).catch(e => ({ error: e.message }));

                        const logContent = [
                            `=== DUMP FOR PROFILE ${profileId} ===`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Page URL: ${page.url()}`,
                            `Frame URL: ${url}`,
                            `--- Frame Body Text ---`,
                            info.bodyText,
                            `--- Frame Elements of Interest ---`,
                            JSON.stringify(info.elements, null, 2),
                            `--- Frame HTML ---`,
                            html,
                            `=====================================\n\n`
                        ].join('\n');

                        fs.writeFileSync(DUMP_FILE, logContent, 'utf8');
                        console.log(`[Inspector] Dump successfully written to ${DUMP_FILE}`);
                        
                        // Close connection and exit
                        await browser.close().catch(() => {});
                        process.exit(0);
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Inspector] Error during inspection:', err.message);
    } finally {
        await browser.close().catch(() => {});
    }
}

async function main() {
    console.log('[Inspector] Starting auto-inspector...');
    console.log(`[Inspector] Monitoring directory: ${PROFILES_DATA_DIR}`);
    console.log(`[Inspector] Dump file path: ${DUMP_FILE}`);

    while (true) {
        try {
            if (fs.existsSync(PROFILES_DATA_DIR)) {
                const dirs = fs.readdirSync(PROFILES_DATA_DIR).filter(n => n.startsWith('profile_'));
                for (const d of dirs) {
                    const portFile = path.join(PROFILES_DATA_DIR, d, 'DevToolsActivePort');
                    if (fs.existsSync(portFile)) {
                        const content = fs.readFileSync(portFile, 'utf8').trim();
                        const port = parseInt(content.split('\n')[0].trim());
                        if (!isNaN(port)) {
                            await inspectProfile(d, port);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[Inspector] Loop error:', e.message);
        }
        await new Promise(r => setTimeout(r, 1000));
    }
}

main().catch(console.error);
