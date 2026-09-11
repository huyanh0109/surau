const http = require('http');
const net = require('net');
const { SocksClient } = require('socks');

// Cache kết quả probe: "host:port" -> boolean
const probeCache = new Map();

/**
 * Kiểm tra nhanh trong tối đa 1.2 giây xem proxy có phải là giao thức SOCKS5 không
 */
function probeIsSocks5(host, port, timeoutMs = 1200) {
    const key = `${host}:${port}`;
    if (probeCache.has(key)) return Promise.resolve(probeCache.get(key));

    return new Promise((resolve) => {
        const socket = new net.Socket();
        let decided = false;

        const done = (isSocks) => {
            if (decided) return;
            decided = true;
            probeCache.set(key, isSocks);
            try { socket.destroy(); } catch (_) {}
            resolve(isSocks);
        };

        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => done(false));
        socket.on('error', () => done(false));

        socket.connect(port, host, () => {
            // Greet SOCKS5: version 5, 2 methods (0x00: no auth, 0x02: user/pass)
            socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
        });

        socket.on('data', (buf) => {
            if (buf && buf.length >= 2 && buf[0] === 0x05) {
                done(true);
            } else {
                done(false);
            }
        });
    });
}

/**
 * Phân tích chuỗi proxy thành object chuẩn
 */
function parseProxyDetails(raw) {
    if (!raw) return null;
    let t = String(raw).trim();
    if (!t) return null;

    let isExplicitSocks = false;
    if (/^socks[45]?:\/\//i.test(t)) {
        isExplicitSocks = true;
        t = t.replace(/^socks[45]?:\/\//i, '');
    } else if (/^https?:\/\//i.test(t)) {
        t = t.replace(/^https?:\/\//i, '');
    }

    let host = '';
    let port = 80;
    let username = '';
    let password = '';

    if (t.includes('@')) {
        // user:pass@host:port
        const [auth, hostPort] = t.split('@');
        const [u, p] = auth.split(':');
        const [h, prt] = hostPort.split(':');
        username = decodeURIComponent(u || '');
        password = decodeURIComponent(p || '');
        host = h;
        port = parseInt(prt, 10) || 80;
    } else {
        const p = t.split(':');
        if (p.length === 4) {
            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p[0]) || (p[0].includes('.') && /^\d+$/.test(p[1]))) {
                // ip:port:user:pass
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
    }

    return { host, port, username, password, isExplicitSocks };
}

/**
 * Tạo HTTP Local Bridge chuyển đổi HTTPS/HTTP sang SOCKS5 proxy upstream có User/Password
 */
function createSocksBridge(proxyDetails) {
    return new Promise((resolve, reject) => {
        const socksConfig = {
            host: proxyDetails.host,
            port: proxyDetails.port,
            type: 5
        };
        if (proxyDetails.username) socksConfig.userId = proxyDetails.username;
        if (proxyDetails.password) socksConfig.password = proxyDetails.password;

        const activeSockets = new Set();

        const server = http.createServer((req, res) => {
            const hostHeader = req.headers['host'] || '';
            const [h, p] = hostHeader.split(':');
            const port = parseInt(p, 10) || 80;

            SocksClient.createConnection({
                proxy: socksConfig,
                command: 'connect',
                destination: { host: h, port }
            }).then(info => {
                info.socket.on('error', () => {});
                activeSockets.add(info.socket);
                info.socket.on('close', () => activeSockets.delete(info.socket));

                let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
                for (let i = 0; i < req.rawHeaders.length; i += 2) {
                    if (req.rawHeaders[i].toLowerCase() === 'proxy-connection') continue;
                    raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}\r\n`;
                }
                raw += '\r\n';
                info.socket.write(raw);
                req.pipe(info.socket);
                info.socket.pipe(res.socket);
            }).catch(() => {
                try {
                    res.writeHead(502);
                    res.end('Bad Gateway');
                } catch (_) {}
            });
        });

        server.on('connection', socket => {
            socket.on('error', () => {});
            activeSockets.add(socket);
            socket.on('close', () => activeSockets.delete(socket));
        });

        server.on('connect', (req, clientSocket, head) => {
            clientSocket.on('error', () => {});
            const [destHost, destPort] = req.url.split(':');
            SocksClient.createConnection({
                proxy: socksConfig,
                command: 'connect',
                destination: { host: destHost, port: parseInt(destPort, 10) || 443 }
            }).then(info => {
                info.socket.on('error', () => {});
                activeSockets.add(info.socket);
                info.socket.on('close', () => activeSockets.delete(info.socket));

                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head && head.length) info.socket.write(head);
                clientSocket.pipe(info.socket);
                info.socket.pipe(clientSocket);
            }).catch(() => {
                try {
                    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                } catch (_) {}
            });
        });

        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const bridgeUrl = `http://127.0.0.1:${port}`;
            resolve({
                url: bridgeUrl,
                port,
                server,
                close: () => {
                    for (const s of activeSockets) {
                        try { s.destroy(); } catch (_) {}
                    }
                    activeSockets.clear();
                    try { server.close(); } catch (_) {}
                }
            });
        });

        server.on('error', reject);
    });
}

module.exports = {
    probeIsSocks5,
    parseProxyDetails,
    createSocksBridge
};
