const http = require('http');
const { URL } = require('url');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { probeIsSocks5 } = require('./socks-bridge');

// Bảng ánh xạ Country Code sang Locale chuẩn
const COUNTRY_LOCALES = {
    US: 'en-US', GB: 'en-GB', VN: 'vi-VN', DE: 'de-DE', FR: 'fr-FR',
    JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW', SG: 'en-SG',
    TH: 'th-TH', ID: 'id-ID', PH: 'en-PH', IN: 'en-IN', AU: 'en-AU',
    CA: 'en-CA', BR: 'pt-BR', RU: 'ru-RU', IT: 'it-IT', ES: 'es-ES',
    NL: 'nl-NL', PL: 'pl-PL', TR: 'tr-TR', MX: 'es-MX', AR: 'es-AR',
    MY: 'ms-MY', HK: 'zh-HK', SE: 'sv-SE', CH: 'de-CH', AT: 'de-AT'
};

class GeoService {
    constructor() {
        // Cache: proxyOrIp -> { data, expireAt }
        this.cache = new Map();
        this.cacheTtlMs = 2 * 60 * 60 * 1000; // 2 giờ
    }

    /**
     * Phân tích chuỗi proxy thành các thành phần chuẩn
     */
    parseProxy(raw) {
        if (!raw) return null;
        let t = raw.trim();
        if (!t) return null;

        let protocol = 'http';
        let host = '';
        let port = 80;
        let username = '';
        let password = '';

        if (t.includes('://')) {
            try {
                const u = new URL(t);
                protocol = u.protocol.replace(':', '');
                host = u.hostname;
                port = parseInt(u.port || '80', 10);
                username = decodeURIComponent(u.username || '');
                password = decodeURIComponent(u.password || '');
                return { host, port, username, password, protocol, formatted: t };
            } catch (e) {
                t = t.replace(/^(http|https|socks5):\/\//i, '');
            }
        }

        const p = t.split(':');
        if (p.length === 4) {
            // Check nếu p[0] là IP/host
            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p[0]) || (p[0].includes('.') && /^\d+$/.test(p[1]))) {
                host = p[0];
                port = parseInt(p[1], 10);
                username = p[2];
                password = p[3];
            } else {
                // user:pass:ip:port
                username = p[0];
                password = p[1];
                host = p[2];
                port = parseInt(p[3], 10);
            }
        } else if (p.length === 2) {
            host = p[0];
            port = parseInt(p[1], 10);
        } else {
            host = t;
        }

        const formatted = username
            ? `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`
            : `http://${host}:${port}`;

        return { host, port, username, password, protocol, formatted };
    }

    /**
     * Map quốc gia sang Locale
     */
    getLocaleForCountry(countryCode) {
        if (!countryCode) return 'en-US';
        return COUNTRY_LOCALES[countryCode.toUpperCase()] || 'en-US';
    }

    /**
     * Thêm độ lệch tọa độ ngẫu nhiên nhưng cố định theo profile seed
     * (tránh việc 20 profile cùng 1 proxy bị gom chung vào 1 tọa độ chính xác từng mét)
     */
    applyRealisticJitter(lat, lon, seed) {
        if (!lat || !lon) return { lat, lon };
        let s = 12345;
        if (typeof seed === 'number') {
            s = Math.abs(seed);
        } else if (typeof seed === 'string' && seed.length > 0) {
            let hash = 0;
            for (let i = 0; i < seed.length; i++) {
                hash = ((hash << 5) - hash) + seed.charCodeAt(i);
                hash |= 0;
            }
            s = Math.abs(hash);
        }

        // Tạo độ lệch bán kính khoảng 500m - 1.5km (~0.005 - 0.015 độ)
        const latOffset = (((s % 1000) / 1000) - 0.5) * 0.02;
        const lonOffset = ((((s >> 4) % 1000) / 1000) - 0.5) * 0.02;

        return {
            lat: Math.round((lat + latOffset) * 10000) / 10000,
            lon: Math.round((lon + lonOffset) * 10000) / 10000
        };
    }

    /**
     * Query thông tin Geo trực tiếp bằng HTTP request qua proxy
     */
    async _queryGeoViaProxy(parsedProxy, timeoutMs = 3500) {
        let isSocks = parsedProxy.protocol === 'socks5' || parsedProxy.protocol === 'socks';
        if (!isSocks && parsedProxy.host && parsedProxy.port) {
            isSocks = await probeIsSocks5(parsedProxy.host, parsedProxy.port, 800);
        }

        if (isSocks) {
            return new Promise((resolve, reject) => {
                const authPart = parsedProxy.username
                    ? `${encodeURIComponent(parsedProxy.username)}:${encodeURIComponent(parsedProxy.password || '')}@`
                    : '';
                const socksUrl = `socks5://${authPart}${parsedProxy.host}:${parsedProxy.port}`;
                const agent = new SocksProxyAgent(socksUrl);

                const timer = setTimeout(() => {
                    req.destroy();
                    reject(new Error('SOCKS5 Proxy Geo query timeout'));
                }, timeoutMs);

                const req = http.get('http://ip-api.com/json', { agent, timeout: timeoutMs }, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        clearTimeout(timer);
                        try {
                            const json = JSON.parse(body);
                            if (json && json.status === 'success') {
                                resolve(json);
                            } else {
                                reject(new Error(json.message || 'Invalid Geo response'));
                            }
                        } catch (err) {
                            reject(new Error(`Failed to parse Geo JSON: ${body.substring(0, 50)}`));
                        }
                    });
                });

                req.on('error', (err) => {
                    clearTimeout(timer);
                    reject(err);
                });
            });
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                req.destroy();
                reject(new Error('Proxy Geo query timeout'));
            }, timeoutMs);

            const reqOptions = {
                hostname: parsedProxy.host,
                port: parsedProxy.port,
                path: 'http://ip-api.com/json',
                method: 'GET',
                headers: {
                    'Host': 'ip-api.com',
                    'User-Agent': 'curl/7.88.1'
                }
            };

            if (parsedProxy.username) {
                const auth = Buffer.from(`${parsedProxy.username}:${parsedProxy.password || ''}`).toString('base64');
                reqOptions.headers['Proxy-Authorization'] = `Basic ${auth}`;
            }

            const req = http.request(reqOptions, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    clearTimeout(timer);
                    try {
                        const json = JSON.parse(body);
                        if (json && json.status === 'success') {
                            resolve(json);
                        } else {
                            reject(new Error(json.message || 'Invalid Geo response'));
                        }
                    } catch (err) {
                        reject(new Error(`Failed to parse Geo JSON: ${body.substring(0, 50)}`));
                    }
                });
            });

            req.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });

            req.end();
        });
    }

    /**
     * Query Geo trực tiếp bằng Fetch (hoặc tra cứu theo IP cụ thể)
     */
    async _queryGeoDirect(targetIp = null, timeoutMs = 3500) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const url = targetIp
                ? `http://ip-api.com/json/${targetIp}`
                : `http://ip-api.com/json`;
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data && data.status === 'success') {
                return data;
            }
            throw new Error(data?.message || 'Geo response not successful');
        } catch (e) {
            clearTimeout(timer);
            // Fallback sang ipwho.is nếu ip-api lỗi
            try {
                const fallbackUrl = targetIp ? `https://ipwho.is/${targetIp}` : `https://ipwho.is/`;
                const fRes = await fetch(fallbackUrl);
                const fData = await fRes.json();
                if (fData && (fData.success !== false)) {
                    return {
                        query: fData.ip,
                        timezone: fData.timezone?.id || 'Asia/Ho_Chi_Minh',
                        lat: fData.latitude,
                        lon: fData.longitude,
                        city: fData.city || '',
                        country: fData.country || '',
                        countryCode: fData.country_code || 'VN'
                    };
                }
            } catch (err2) { /* ignore fallback error */ }
            throw e;
        }
    }

    /**
     * Hàm chính: Tự động xác định IP, Múi giờ, Tọa độ, Quốc gia & Ngôn ngữ
     * @param {string|null} proxyRaw - Chuỗi proxy hoặc null (nếu kết nối trực tiếp)
     * @param {string|number|null} seed - Noise seed để tạo jitter tọa độ
     * @param {object} options - Tùy chọn { applyJitter: boolean }
     */
    async resolveProxyGeo(proxyRaw, seed = null, options = {}) {
        const applyJitter = options.applyJitter !== false;
        const cacheKey = (proxyRaw || 'DIRECT').trim();
        const now = Date.now();

        // 1. Kiểm tra RAM cache
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expireAt > now) {
            const base = cached.data;
            const finalCoords = applyJitter
                ? this.applyRealisticJitter(base.baseLat, base.baseLon, seed)
                : { lat: base.baseLat, lon: base.baseLon };
            return {
                ...base,
                lat: finalCoords.lat,
                lon: finalCoords.lon,
                cached: true
            };
        }

        const parsedProxy = this.parseProxy(proxyRaw);
        let geoRaw = null;
        let querySource = 'direct';

        // 2. Tra cứu
        if (parsedProxy && parsedProxy.host) {
            // Thử query qua Proxy trước
            try {
                geoRaw = await this._queryGeoViaProxy(parsedProxy, 3500);
                querySource = 'proxy-tunnel';
            } catch (proxyErr) {
                console.warn(`[GeoService] ⚠️ Query qua proxy [${parsedProxy.host}:${parsedProxy.port}] thất bại (${proxyErr.message}), thử tra cứu IP trực tiếp...`);
                // Fallback: Tra cứu IP của proxy host
                try {
                    geoRaw = await this._queryGeoDirect(parsedProxy.host, 3500);
                    querySource = 'proxy-host-ip';
                } catch (directErr) {
                    console.error(`[GeoService] ❌ Tra cứu IP proxy host [${parsedProxy.host}] cũng thất bại: ${directErr.message}`);
                }
            }
        } else {
            // Không có proxy -> Query mạng thật của máy
            try {
                geoRaw = await this._queryGeoDirect(null, 3500);
                querySource = 'direct-ip';
            } catch (err) {
                console.error(`[GeoService] ❌ Tra cứu direct IP thất bại: ${err.message}`);
            }
        }

        // 3. Fallback mặc định an toàn nếu mất mạng hoặc API die
        if (!geoRaw) {
            geoRaw = {
                query: '127.0.0.1',
                timezone: 'Asia/Ho_Chi_Minh',
                lat: 10.822,
                lon: 106.6257,
                city: 'Ho Chi Minh City',
                country: 'Vietnam',
                countryCode: 'VN'
            };
            querySource = 'fallback-default';
        }

        const outgoingIp = geoRaw.query || parsedProxy?.host || '127.0.0.1';
        const timezone = geoRaw.timezone || 'Asia/Ho_Chi_Minh';
        const countryCode = (geoRaw.countryCode || 'VN').toUpperCase();
        const country = geoRaw.country || countryCode;
        const city = geoRaw.city || '';
        const locale = this.getLocaleForCountry(countryCode);
        const baseLat = parseFloat(geoRaw.lat) || 10.822;
        const baseLon = parseFloat(geoRaw.lon) || 106.6257;

        const resultBase = {
            ip: outgoingIp,
            timezone,
            country,
            countryCode,
            city,
            locale,
            baseLat,
            baseLon,
            source: querySource
        };

        // Lưu Cache
        this.cache.set(cacheKey, {
            data: resultBase,
            expireAt: now + this.cacheTtlMs
        });

        // Áp dụng Jitter cho tọa độ
        const finalCoords = applyJitter
            ? this.applyRealisticJitter(baseLat, baseLon, seed)
            : { lat: baseLat, lon: baseLon };

        return {
            ...resultBase,
            lat: finalCoords.lat,
            lon: finalCoords.lon,
            cached: false
        };
    }
}

module.exports = new GeoService();
