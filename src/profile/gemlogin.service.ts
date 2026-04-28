import axios from '../axios-fetch';
import { Injectable } from '@nestjs/common';
import { CreateProfileDto } from './dto/create-profile.dto';
import { calcGridByDisplay } from './window-layout.util';
import { ProfileStateService } from './profile-state.service';
import { ChromeService } from '../automation/browser/chrome.service';
import { AutomationService } from '../automation/automation.service';
import { exec } from 'child_process';

@Injectable()
export class GemloginService {
    private readonly baseUrl = process.env.GEMLOGIN_BASE_URL;

    constructor(
        private readonly profileState: ProfileStateService,
        private readonly chromeService: ChromeService,
        private readonly automationService: AutomationService,
    ) { }

    async createProfile(dto: CreateProfileDto = {}) {
        const count = dto.count && dto.count > 0 ? dto.count : 1;
        const results: any[] = [];

        const browserVersion = process.env.BROWSER_VERSION;
        if (!browserVersion) {
            throw new Error('Missing BROWSER_VERSION in .env');
        }

        for (let i = 0; i < count; i++) {
            const payload = {
                profile_name:
                    dto.profileName
                        ? `${dto.profileName}_${i + 1}`
                        : `profile_${Date.now()}_${i + 1}`,

                group_name: 'All',

                // ✅ PROXY: Lấy từ .env mặc định
                raw_proxy: process.env.PROXY_HTTP || '',

                startup_urls: '',

                // ===== Fingerprint (giữ nguyên) =====
                is_masked_font: true,
                is_noise_canvas: false,
                is_noise_webgl: false,
                is_noise_client_rect: false,
                is_noise_audio_context: true,
                is_random_screen: false,
                is_masked_webgl_data: true,
                is_masked_media_device: true,

                // ✅ KHÓA OS
                is_random_os: false,
                os: {
                    type: 'Windows',
                    version: 'win10',
                },

                webrtc_mode: 2,

                // ✅ LẤY TỪ .env
                browser_version: String(browserVersion),

                // ⚠️ User-Agent PHẢI KHỚP browser_version
                user_agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion}.0.0.0 Safari/537.36`,

                language: 'vi,en',
                time_zone: 'Asia/Bangkok',
                country: 'Vietnam',
            };

            const res = await axios.post(
                `${this.baseUrl}/profiles/create`,
                payload,
            );

            results.push(res.data);
        }

        return {
            total: results.length,
            profiles: results,
        };
    }

    async deleteProfile(profileId: string) {
        const res = await axios.delete(
            `${this.baseUrl}/profiles/delete/${profileId}`,
        );
        return res.data;
    }
    async listProfiles() {
        const res = await axios.get(`${this.baseUrl}/profiles`);

        // GemLogin trả về { status, data }
        return res.data?.data ?? [];
    }


    async deleteAllProfiles() {
        const res = await axios.get(`${this.baseUrl}/profiles`);
        const profiles = res.data?.data ?? [];

        const deleted: any[] = [];

        for (const p of profiles) {
            if (!p?.id) continue;

            // 1️⃣ STOP TRƯỚC (BẮT BUỘC)
            try {
                await axios.get(
                    `${this.baseUrl}/profiles/stop/${p.id}`,
                );
                await new Promise(r => setTimeout(r, 400));
            } catch { }

            // 2️⃣ DELETE
            await axios.get(
                `${this.baseUrl}/profiles/delete/${p.id}`,
            );

            deleted.push({ id: p.id, status: 'deleted' });

            await new Promise(r => setTimeout(r, 400));
        }

        // 3️⃣ VERIFY LẠI
        const verify = await axios.get(`${this.baseUrl}/profiles`);

        return {
            requested: profiles.length,
            remaining: verify.data?.data?.length ?? null,
            deleted,
        };
    }

    async startAllProfiles() {
        // 1️⃣ Lấy danh sách profile
        const listRes = await axios.get(`${this.baseUrl}/profiles`);
        const profiles = listRes.data?.data ?? [];

        // 2️⃣ Start TẤT CẢ profiles SONG SONG
        const results = await Promise.all(
            profiles.map((profile: any, i: number) => {
                return (async () => {
                    const layout = calcGridByDisplay(i, {
                        rows: 4,
                        cols: 5,
                        screenWidth: 3840,
                        screenHeight: 2160,
                        displayScale: 0.8,
                    });

                    const params = new URLSearchParams({
                        win_pos: layout.win_pos,
                        win_size: layout.win_size,
                        win_scale: String(layout.win_scale),
                    });

                    const url = `${this.baseUrl}/profiles/start/${profile.id}?${params.toString()}`;

                    try {
                        // Fire the request immediately
                        const res = await axios.get(url);

                        const profileInfo = {
                            profile_id: profile.id,
                            remote_debugging_address:
                                res.data?.data?.remote_debugging_address || res.data?.remote_debugging_address,
                            win_pos: layout.win_pos,
                            win_size: layout.win_size,
                        };

                        // 💾 Lưu vào state
                        this.profileState.setProfileOpened(profile.id, profileInfo);

                        // 🔄 Restore URL nếu có (chạy ngầm, không block)
                        const savedUrl = this.profileState.getProfileUrl(profile.id);
                        if (savedUrl && profileInfo.remote_debugging_address) {
                            this.chromeService.connect(profileInfo.remote_debugging_address)
                                .then(browser => this.chromeService.getOrCreatePage(browser))
                                .then(page => page.goto(savedUrl, { waitUntil: 'networkidle2', timeout: 10000 }))
                                .catch(() => { });
                        }

                        return profileInfo;
                    } catch (err: any) {
                        console.error(`[Gemlogin] Failed to start profile ${profile.id}:`, err?.message);
                        return null;
                    }
                })();
            })
        );

        const validProfiles = results.filter(p => p !== null);

        return {
            total: validProfiles.length,
            profiles: validProfiles,
        };
    }
    async closeAllProfiles() {
        // 1️⃣ Lấy danh sách profile đang mở từ state
        const openedProfiles = this.profileState.getOpenedProfiles();

        // 2️⃣ Capture URLs trước khi đóng
        await Promise.all(
            openedProfiles.map(async (profileInfo) => {
                try {
                    if (profileInfo.remote_debugging_address) {
                        const url = await this.chromeService.getCurrentUrl(profileInfo.remote_debugging_address);
                        if (url) {
                            this.profileState.setProfileUrl(profileInfo.profile_id, url);
                        }
                    }
                } catch (err) {
                    // Could not capture URL
                }
            })
        );

        // 3️⃣ Close tất cả profiles
        const results = await Promise.all(
            openedProfiles.map(async (profileInfo) => {
                try {
                    await axios.get(
                        `${this.baseUrl}/profiles/close/${profileInfo.profile_id}`,
                    );
                    // 🗑️ Xóa khỏi state
                    this.profileState.setProfileClosed(profileInfo.profile_id);
                    return {
                        profile_id: profileInfo.profile_id,
                        status: 'closed',
                    };
                } catch (err: any) {
                    // Dọn dẹp profile lỗi để không bị kẹt mãi mãi (Zombie Profiles)
                    this.profileState.setProfileClosed(profileInfo.profile_id);
                    return {
                        profile_id: profileInfo.profile_id,
                        status: 'error',
                        message: err?.message,
                    };
                }
            })
        );

        return {
            total: openedProfiles.length,
            results,
        };
    }

    getProfilesState() {
        return {
            profiles: this.profileState.getOpenedProfiles(),
            count: this.profileState.getOpenedCount(),
        };
    }

    async freeRam() {
        // 1️⃣ Dừng tất cả automation ngầm
        try {
            this.automationService.stopAutomation();
        } catch (e) { }

        // 2️⃣ Cố gắng đóng profiles qua API (Graceful attempt)
        try {
            await this.closeAllProfiles();
        } catch (e) { }

        // 3️⃣ Xóa sạch state nội bộ
        const opened = this.profileState.getOpenedProfiles();
        for (const p of opened) {
            this.profileState.setProfileClosed(p.profile_id);
        }

        // 4️⃣ FORCE KILL tất cả browser processes (Surgical Purge)
        // Chỉ giết những chrome.exe có chứa "GemLogin" trong command line
        // để không làm sập trình duyệt đang xem Dashboard của người dùng.
        const commands = [
            'powershell -Command "Get-CimInstance Win32_Process -Filter \'Name = \'\'chrome.exe\'\'\' | Where-Object { $_.CommandLine -like \'*GemLogin*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
            'taskkill /F /IM chromedriver.exe /T',
            'taskkill /F /IM Gembrowser.exe /T',
        ];

        for (const cmd of commands) {
            exec(cmd, (err) => {
                // Ignore errors (e.g. process not found)
            });
        }

        return {
            success: true,
            message: 'All browser processes terminated and memory released.',
        };
    }


}
