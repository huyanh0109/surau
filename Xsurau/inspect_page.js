const { chromium } = require('patchright');

async function main() {
    const port = 55043;
    console.log(`Connecting to CDP port ${port}...`);
    let browser;
    try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        console.log('Connected successfully!');
    } catch (e) {
        console.error('Failed to connect:', e.message);
        return;
    }

    const contexts = browser.contexts();
    for (const context of contexts) {
        const pages = context.pages();
        console.log(`Context has ${pages.length} pages:`);
        for (const page of pages) {
            console.log(`  - Page URL: ${page.url()}`);
            const frames = page.frames();
            console.log(`    Has ${frames.length} frames:`);
            for (const frame of frames) {
                const url = frame.url();
                console.log(`      - Frame URL: ${url}`);
                if (url.includes('recaptcha') || url.includes('hand-gestures')) {
                    console.log('      *** FOUND RECAPTCHA/GESTURE FRAME ***');
                    try {
                        const html = await frame.content();
                        console.log('\n--- FRAME HTML CONTENT START ---');
                        console.log(html);
                        console.log('--- FRAME HTML CONTENT END ---\n');

                        // Evaluate elements in frame
                        const info = await frame.evaluate(() => {
                            const tags = [];
                            document.querySelectorAll('*').forEach(el => {
                                const tag = el.tagName.toLowerCase();
                                if (['img', 'image', 'svg', 'object', 'embed', 'source'].includes(tag)) {
                                    const attrs = {};
                                    for (let i = 0; i < el.attributes.length; i++) {
                                        const attr = el.attributes[i];
                                        attrs[attr.name] = attr.value;
                                    }
                                    tags.push({ tag, attrs, outerHTML: el.outerHTML.substring(0, 300) });
                                }
                            });
                            return tags;
                        });
                        console.log('Frame elements of interest:', JSON.stringify(info, null, 2));

                    } catch (err) {
                        console.error('Error reading frame content:', err.message);
                    }
                }
            }
        }
    }
    await browser.close().catch(() => {});
}

main().catch(console.error);
