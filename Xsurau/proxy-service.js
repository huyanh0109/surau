const ProxyChain = require('proxy-chain');
const { chromium } = require('patchright');

class ProxyService {
    constructor() {
        this.localPort = 8888;
        this.server = null;
        this.activeUpstream = null; 
    }

    async startServer() {
        if (this.server) return;
        this.server = new ProxyChain.Server({
            port: this.localPort,
            prepareRequestFunction: () => {
                if (!this.activeUpstream) return {};
                return { upstreamProxyUrl: this.toProxyUrl(this.activeUpstream) };
            }
        });
        await this.server.listen();
        console.log(`[ProxyService] Gateway running on 127.0.0.1:${this.localPort}`);
    }

    toProxyUrl(raw) {
        if (!raw) return '';
        const t = raw.trim();
        if (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('socks5://')) return t;
        const p = t.split(':');
        if (p.length === 4) return `http://${p[2]}:${p[3]}@${p[0]}:${p[1]}`;
        if (p.length === 2) return `http://${p[0]}:${p[1]}`;
        return `http://${t}`;
    }

    async switchProxy(upstream, manager) {
        this.activeUpstream = upstream;
        console.log(`[ProxyService] Switched upstream to ${upstream}`);
        
        // Restart proxy chain to cut existing connections
        if (this.server) {
            await this.server.close(true);
            this.server = null;
        }
        await new Promise(r => setTimeout(r, 200));
        await this.startServer();

        // Drop CDP connections to force chromium to reload proxy
        if (manager) {
            await this.forceDropChromeConnections(manager);
        }
    }

    async forceDropChromeConnections(manager) {
        const runningProfiles = Object.keys(manager.runningProfiles).map(id => manager.runningProfiles[id]);
        if (runningProfiles.length === 0) return;

        console.log(`[ProxyService] Forcing ${runningProfiles.length} profiles to drop connections...`);

        await Promise.all(runningProfiles.map(async (pData) => {
            try {
                if (!pData.wsEndpoint) return;
                // Connect to browser via CDP
                const browser = await chromium.connectOverCDP(pData.wsEndpoint);
                const contexts = browser.contexts();
                if (contexts.length > 0) {
                    const pages = contexts[0].pages();
                    if (pages.length > 0) {
                        const page = pages[0];
                        const cdp = await page.context().newCDPSession(page);
                        await cdp.send('Network.enable');
                        await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
                        await new Promise(r => setTimeout(r, 200));
                        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
                        await cdp.detach();
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(()=>{});
                    }
                }
                await browser.close();
            } catch(e) {
                console.error(`[ProxyService] Error reconnecting CDP: ${e.message}`);
            }
        }));
    }
}

module.exports = new ProxyService();
