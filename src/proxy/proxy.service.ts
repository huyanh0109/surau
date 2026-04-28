import { Injectable, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as ProxyChain from 'proxy-chain';
import Database = require('better-sqlite3');
import axios from '../axios-fetch';
import { ProfileStateService } from '../profile/profile-state.service';
import { ChromeService } from '../automation/browser/chrome.service';

@Injectable()
export class ProxyService implements OnModuleInit, OnModuleDestroy {
    private proxy1: string = process.env.PROXY_HTTP || '';
    private proxy2: string = '';
    private captchaProxy: string = '';
    private rotateUrl: string = '';
    private activeProxyIndex: 1 | 2 = 1;
    private readonly configPath = path.join(process.cwd(), 'proxy-config.json');
    private readonly localPort = 8888;
    private server: any;
    private gatewayApplied = false;

    private readonly gemloginDbPath = path.join(
        process.env.USERPROFILE || process.env.HOME || '',
        '.gemlogin', 'db.db',
    );

    constructor(
        @Inject(forwardRef(() => ProfileStateService))
        private readonly profileState: ProfileStateService,
        @Inject(forwardRef(() => ChromeService))
        private readonly chromeService: ChromeService,
    ) { }

    async onModuleInit() {
        this.loadConfig();
        await this.startLocalProxy();
        // Ghi gateway vào SQLite ngay khi khởi động
        this.applyGatewayToSqlite();
    }

    async onModuleDestroy() {
        if (this.server) {
            await this.server.close(true);
        }
    }

    // ═══════════════════════════════
    //  PROXY-CHAIN: Local gateway
    // ═══════════════════════════════

    private async startLocalProxy() {
        this.server = new ProxyChain.Server({
            port: this.localPort,
            prepareRequestFunction: () => {
                const upstream = this.getActiveProxy();
                if (!upstream) return {};
                return { upstreamProxyUrl: this.toProxyUrl(upstream) };
            },
        });
        await this.server.listen();
        console.log(`[Proxy] Gateway running on 127.0.0.1:${this.localPort}`);
        console.log(`[Proxy] Active upstream: ${this.getActiveProxy()}`);
    }

    private toProxyUrl(raw: string): string {
        if (!raw) return '';
        const t = raw.trim();
        if (t.startsWith('http://') || t.startsWith('https://')) return t;
        const p = t.split(':');
        if (p.length === 4) return `http://${p[2]}:${p[3]}@${p[0]}:${p[1]}`;
        if (p.length === 2) return `http://${p[0]}:${p[1]}`;
        return `http://${t}`;
    }

    // ═══════════════════════════════
    //  SQLITE: Set gateway trực tiếp vào Gemlogin DB
    // ═══════════════════════════════

    /**
     * Ghi proxy gateway (127.0.0.1:8888) vào profile_data.proxy trong SQLite.
     * Chromium Gemlogin đọc field này khi khởi động.
     * Chỉ cần chạy 1 lần — sau đó mọi profile luôn qua gateway.
     */
    private applyGatewayToSqlite() {
        try {
            const db = new Database(this.gemloginDbPath);
            try {
                const gatewayProxy = {
                    type: 'http',
                    host: '127.0.0.1',
                    port: String(this.localPort),
                    user_name: '',
                    password: '',
                };

                const rows = db.prepare('SELECT id, profile_data FROM profiles').all() as any[];
                let updated = 0;

                for (const row of rows) {
                    try {
                        const data = JSON.parse(row.profile_data);
                        // Chỉ update nếu chưa trỏ tới gateway
                        if (data.proxy?.host !== '127.0.0.1' || data.proxy?.port !== String(this.localPort)) {
                            data.proxy = gatewayProxy;
                            db.prepare('UPDATE profiles SET proxy = ?, profile_data = ? WHERE id = ?')
                                .run(`http://127.0.0.1:${this.localPort}`, JSON.stringify(data), row.id);
                            updated++;
                        }
                    } catch { }
                }

                if (updated > 0) {
                    console.log(`[Proxy] ✅ Applied gateway to ${updated} profiles in SQLite`);
                    console.log(`[Proxy] ⚠️  Cần restart Chrome (Mở tất cả) để áp dụng gateway lần đầu`);
                    this.gatewayApplied = false;
                } else {
                    console.log(`[Proxy] Gateway already applied to all profiles`);
                    this.gatewayApplied = true;
                }
            } finally {
                db.close();
            }
        } catch (err: any) {
            console.error('[Proxy] Failed to apply gateway to SQLite:', err.message);
        }
    }

    // ═══════════════════════════════
    //  SWITCH PROXY: Đổi upstream tức thì
    // ═══════════════════════════════

    getActiveProxy(): string {
        return this.activeProxyIndex === 1 ? this.proxy1 : this.proxy2;
    }

    /**
     * Đổi proxy TỨC THÌ:
     * 1. Thay upstream của proxy-chain
     * 2. Restart proxy-chain (cắt tunnel cũ)
     * 3. CDP: buộc Chrome drop kết nối + reload
     * KHÔNG CẦN đóng/mở Chrome!
     */
    async switchProxy(index: 1 | 2) {
        this.activeProxyIndex = index;
        this.saveConfig();
        const activeProxy = this.getActiveProxy();
        console.log(`[Proxy] Switching to Proxy ${index}: ${activeProxy}`);

        // Nếu gateway chưa được áp dụng (lần đầu), cần restart Chrome
        if (!this.gatewayApplied) {
            console.log('[Proxy] Gateway chưa áp dụng, cần restart Chrome...');
            await this.restartAllProfiles();
            this.gatewayApplied = true;
        } else {
            // Đổi proxy tức thì: restart proxy-chain + CDP
            await this.restartProxyServer();
            await this.forceDropChromeConnections();
        }

        console.log(`[Proxy] ✅ Switched to Proxy ${index}: ${activeProxy}`);
        return { success: true, activeIndex: index, currentProxy: activeProxy };
    }

    private async restartProxyServer() {
        if (this.server) {
            await this.server.close(true);
            this.server = null;
        }
        await new Promise(r => setTimeout(r, 300));
        await this.startLocalProxy();
    }

    /**
     * CDP: Tắt mạng → bật lại → reload, buộc Chrome dùng upstream mới
     */
    private async forceDropChromeConnections() {
        const profiles = this.profileState.getOpenedProfiles();
        if (profiles.length === 0) return;

        console.log(`[Proxy] Forcing ${profiles.length} Chrome instances to reconnect...`);

        await Promise.all(
            profiles.map(async (profile) => {
                try {
                    if (!profile.remote_debugging_address) return;
                    const browser = await this.chromeService.connect(profile.remote_debugging_address);
                    const page = await this.chromeService.getOrCreatePage(browser);

                    const cdp = await page.createCDPSession();
                    await cdp.send('Network.enable');
                    await cdp.send('Network.emulateNetworkConditions', {
                        offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
                    });
                    await new Promise(r => setTimeout(r, 300));
                    await cdp.send('Network.emulateNetworkConditions', {
                        offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
                    });
                    await cdp.detach();
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => { });

                    console.log(`[Proxy] ✅ Reconnected profile ${profile.profile_id}`);
                } catch (err: any) {
                    console.error(`[Proxy] ⚠️  Profile ${profile.profile_id}:`, err.message);
                }
            }),
        );
    }

    /**
     * Restart tất cả Chrome (chỉ dùng lần đầu khi gateway chưa áp dụng)
     */
    private async restartAllProfiles() {
        const baseUrl = process.env.GEMLOGIN_BASE_URL || 'http://127.0.0.1:1010/api';
        const listRes = await axios.get(`${baseUrl}/profiles`);
        const profiles = listRes.data?.data || [];

        // Stop all
        for (const p of profiles) {
            try { await axios.get(`${baseUrl}/profiles/stop/${p.id}`); } catch { }
            await new Promise(r => setTimeout(r, 300));
        }
        this.profileState.clearAll();

        // Start all
        for (const p of profiles) {
            try {
                const startRes = await axios.get(`${baseUrl}/profiles/start/${p.id}`);
                const rda = startRes.data?.data?.remote_debugging_address;
                if (rda) {
                    this.profileState.setProfileOpened(p.id, {
                        profile_id: p.id,
                        remote_debugging_address: rda,
                    });
                }
            } catch { }
        }
    }

    // ═══════════════════════════════
    //  CONFIG
    // ═══════════════════════════════

    getConfig() {
        return {
            proxy1: this.proxy1,
            proxy2: this.proxy2,
            captchaProxy: this.captchaProxy,
            rotateUrl: this.rotateUrl,
            activeIndex: this.activeProxyIndex,
            gatewayApplied: this.gatewayApplied,
        };
    }

    async updateConfig(dto: { proxy1?: string; proxy2?: string; captchaProxy?: string; rotateUrl?: string; activeIndex?: 1 | 2 }) {
        if (dto.proxy1 !== undefined) this.proxy1 = dto.proxy1;
        if (dto.proxy2 !== undefined) this.proxy2 = dto.proxy2;
        if (dto.captchaProxy !== undefined) this.captchaProxy = dto.captchaProxy;
        if (dto.rotateUrl !== undefined) this.rotateUrl = dto.rotateUrl;
        if (dto.activeIndex !== undefined) this.activeProxyIndex = dto.activeIndex;
        this.saveConfig();
        return this.getConfig();
    }

    /**
     * Xoay proxy: gọi rotate URL rồi restart proxy-chain + CDP reconnect.
     */
    async rotateProxy() {
        if (!this.rotateUrl) {
            return { success: false, message: 'Chưa nhập link xoay proxy' };
        }
        try {
            console.log(`[Proxy] Calling rotate URL: ${this.rotateUrl}`);
            const axios = require('../axios-fetch').default;
            const res = await axios.get(this.rotateUrl, { timeout: 15000 });
            console.log(`[Proxy] Rotate response:`, typeof res.data === 'string' ? res.data.substring(0, 200) : JSON.stringify(res.data));

            // Restart proxy-chain + CDP
            await this.restartProxyServer();
            await this.forceDropChromeConnections();

            return { success: true, message: `Proxy đã xoay! Response: ${typeof res.data === 'string' ? res.data.substring(0, 100) : JSON.stringify(res.data).substring(0, 100)}` };
        } catch (err: any) {
            console.error('[Proxy] Rotate failed:', err.message);
            return { success: false, message: err.message };
        }
    }

    private saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify({
                proxy1: this.proxy1,
                proxy2: this.proxy2,
                captchaProxy: this.captchaProxy,
                rotateUrl: this.rotateUrl,
                activeIndex: this.activeProxyIndex,
            }, null, 2));
        } catch { }
    }

    private loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const c = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                if (c.proxy1 !== undefined) this.proxy1 = c.proxy1;
                if (c.proxy2 !== undefined) this.proxy2 = c.proxy2;
                if (c.captchaProxy !== undefined) this.captchaProxy = c.captchaProxy;
                if (c.rotateUrl !== undefined) this.rotateUrl = c.rotateUrl;
                if (c.activeIndex !== undefined) this.activeProxyIndex = c.activeIndex;
            }
        } catch { }
    }
}
