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
            console.log(`[ProxyService] Manager found, triggering reload for ${manager.runningProfiles.size} profiles`);
            await this.forceDropChromeConnections(manager);
        } else {
            console.warn(`[ProxyService] No manager provided to switchProxy, cannot reload browsers.`);
        }
    }

    async forceDropChromeConnections(manager) {
        const profilesMap = manager.runningProfiles;
        const runningProfiles = [...profilesMap.values()];
        
        if (runningProfiles.length === 0) {
            console.log(`[ProxyService] No running profiles detected in manager.`);
            return;
        }

        console.log(`[ProxyService] Forcing reload on all tabs for ${runningProfiles.length} profiles...`);

        await Promise.all(runningProfiles.map(async (pData, profileIndex) => {
            try {
                const { context } = pData;
                if (!context) return;

                const pages = context.pages();
                console.log(`[ProxyService] Profile #${profileIndex + 1}: Found ${pages.length} tabs.`);

                for (const [pageIndex, page] of pages.entries()) {
                    try {
                        // "Bóp" kết nối cũ bằng CDP flicker (chỉ cần làm trên 1 page đại diện của context là đủ, nhưng làm hết cũng được)
                        const cdp = await page.context().newCDPSession(page);
                        await cdp.send('Network.enable');
                        await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
                        await new Promise(r => setTimeout(r, 100));
                        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
                        await cdp.detach();

                        // Force reload tab
                        console.log(`[ProxyService] Profile #${profileIndex + 1} - Tab #${pageIndex + 1}: Reloading...`);
                        
                        // Sử dụng cả page.reload và evaluate để đảm bảo trình duyệt thực hiện
                        await Promise.race([
                            page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 }),
                            page.evaluate(() => window.location.reload())
                        ]).catch(err => {
                            console.warn(`[ProxyService] Tab reload warning: ${err.message}`);
                        });
                    } catch (err) {
                        console.warn(`[ProxyService] Error on Tab #${pageIndex + 1}: ${err.message}`);
                    }
                }
            } catch(e) {
                console.error(`[ProxyService] Critical error refreshing profile #${profileIndex + 1}: ${e.message}`);
            }
        }));
        console.log(`[ProxyService] All reload commands executed.`);
    }
    async getCurrentIP(proxyUrl) {
        const url = proxyUrl || this.activeUpstream;
        if (!url) return 'NO_PROXY';
        
        const services = [
            'https://api.ipify.org?format=json',
            'https://icanhazip.com',
            'http://ip-api.com/json'
        ];

        try {
            const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
            const { HttpsProxyAgent } = require('https-proxy-agent');
            
            const formattedProxy = this.toProxyUrl(url);
            const agent = new HttpsProxyAgent(formattedProxy);
            
            for (const service of services) {
                try {
                    console.log(`[ProxyService] Checking IP via ${service}...`);
                    const res = await fetch(service, { agent, timeout: 5000 });
                    if (!res.ok) continue;
                    
                    if (service.includes('json')) {
                        const data = await res.json();
                        const ip = data.ip || data.query;
                        if (ip) return ip;
                    } else {
                        const text = await res.text();
                        const ip = text.trim();
                        if (ip) return ip;
                    }
                } catch (err) {
                    console.warn(`[ProxyService] Failed to check IP via ${service}: ${err.message}`);
                }
            }
            
            return 'FETCH_FAILED';
        } catch (e) {
            console.error(`[ProxyService] Critical error in getCurrentIP: ${e.message}`);
            return `ERROR: ${e.message}`;
        }
    }
}

module.exports = new ProxyService();
