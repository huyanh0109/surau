# Xsurau Antidetect Browser - C++ Native Patch Log

Tài liệu này ghi chú lại toàn bộ những thay đổi ở tầng lõi C++ (Chromium Source Code) và kiến trúc của hệ thống Xsurau nhằm biến trình duyệt thành một Antidetect Browser thực thụ, vượt qua Cloudflare Turnstile và các hệ thống anti-bot khó tính nhất.

## 1. Triết lý thiết kế (Design Philosophy)
- **Từ bỏ JS Injection (CDP)**: Việc dùng JavaScript (`Object.defineProperty`) hoặc Chrome DevTools Protocol (CDP) để đè các giá trị như `navigator.userAgent`, `timezone`, `locale`, `WebRTC` rất dễ bị phát hiện. Cloudflare Turnstile có thể kiểm tra qua `Intl.DateTimeFormat`, iframe, hoặc worker.
- **Can thiệp sâu vào C++ (Native Spoofing)**: Mọi thông số fingerprint phải được thay đổi từ gốc (Engine Blink / V8 / ICU / WebRTC) bằng cách truyền cờ (Command Line Flags) khi khởi chạy.

## 2. Các Patch C++ Đã Thực Hiện

### 2.1. H.264 & Proprietary Codecs
- **File**: `out\Xsurau\args.gn`
- **Mục đích**: Trình duyệt Chromium biên dịch mặc định sẽ thiếu codec H.264 (do bản quyền). Các hệ thống bot-detection dùng `video.canPlayType('video/mp4; codecs="avc1.42E01E"')` để bắt thóp Chromium custom.
- **Giải pháp**: Bật `proprietary_codecs = true` và `ffmpeg_branding = "Chrome"`.

### 2.2. Timezone & Locale Spoofing (ICU Engine)
- **File**: `base/i18n/icu_util.cc`
- **Cờ (Flags)**: `--spoof-timezone`, `--spoof-locale`
- **Chi tiết**: Can thiệp vào hàm `InitializeIcuTimeZone()`. Sử dụng thư viện ICU (`icu::TimeZone::adoptDefault` và `icu::Locale::setDefault`) để thiết lập múi giờ và ngôn ngữ mặc định toàn cầu cho toàn bộ tiến trình. Các hàm JavaScript như `new Date()` hay `Intl.DateTimeFormat().resolvedOptions().timeZone` sẽ tự động ăn theo múi giờ này một cách tự nhiên nhất mà không cần JS override.

### 2.3. Navigator Language Spoofing (Blink Engine)
- **File**: `third_party/blink/renderer/core/frame/navigator_language.cc`
- **Chi tiết**: Can thiệp hàm khởi tạo ngôn ngữ của Blink để ưu tiên đọc cờ `--spoof-locale`. Giúp `navigator.language` và `navigator.languages` trả về ngôn ngữ khớp với proxy ngay trong C++.

### 2.4. WebRTC IP Leak Protection & Spoofing
- **Mục đích**: Ngăn chặn leak IP Public thật (qua STUN) và IP Local (qua Host candidates) khi dùng WebRTC.
- **File 1 (Local IP)**: `third_party/blink/renderer/platform/p2p/ipc_network_manager.cc`. Ghi đè danh sách card mạng, trả về một card mạng ảo với IP Local fake dựa trên `--spoof-webrtc-ip`.
- **File 2 (STUN Block)**: `third_party/webrtc/p2p/base/stun_port.cc`. Chặn hàm `MaybePrepareStunCandidate()` nếu có cờ spoofing. Điều này chặn hoàn toàn STUN requests (srflx candidates), giúp WebRTC không bao giờ lộ IP thật ngay cả khi proxy liên tục đổi IP (rotating proxy). WebRTC vẫn hoạt động qua host/relay (turn) candidates.

### 2.5. Forwarding Flags
- **File**: `content/browser/renderer_host/render_process_host_impl.cc`
- **Chi tiết**: Cho phép các cờ tự chế (`--spoof-timezone`, `--spoof-locale`, `--spoof-webrtc-ip`, `--clientrects-noise-seed`,...) truyền từ tiến trình chính (Browser Process) xuống tiến trình render (Renderer Process).

### 2.6. DOM Geometry Noise (ClientRects) *[Đã làm trước đó]*
- **File**: `third_party/blink/renderer/core/dom/element.cc`
- **Chi tiết**: Chèn nhiễu (noise) cố định (dựa trên seed) vào các API như `getBoundingClientRect` và `getClientRects` để tránh bị fingerprint qua việc render text/box.

---

## 3. Những Yếu Tố Cần Cải Thiện Để "Ẩn Mình" Hoàn Toàn (Ultimate Stealth)

Mặc dù hệ thống hiện tại đã vượt qua Cloudflare Turnstile, để đối phó với các hệ thống anti-fraud cấp độ ngân hàng (Akamai, DataDome, Shape Security), chúng ta cần đào sâu thêm vào C++:

### 3.1. Font Fingerprinting
- **Vấn đề**: JS có thể đo kích thước của các thẻ `<span>` với các font khác nhau để liệt kê chính xác các font được cài đặt trên máy thật.
- **Giải pháp (C++)**: Patch thư viện font của Blink/Skia để giới hạn danh sách font được load, hoặc chèn một độ nhiễu siêu nhỏ vào metrics (chiều cao, rộng) của text khi render.

### 3.2. WebGL Fingerprinting (Sâu hơn)
- **Vấn đề**: Hiện tại mình mới fake chuỗi Vendor/Renderer (`--webgl-vendor`). Tuy nhiên bot có thể vẽ một khối 3D phức tạp (WebGL Image) và đọc mã hash (pixel array qua `glReadPixels`). Mỗi GPU/Driver render ra ảnh lệch nhau một chút (chỉ khác ở vài pixel).
- **Giải pháp (C++)**: Patch hàm `glReadPixels` trong Blink, cộng thêm các giá trị RGB nhiễu (+1/-1) dựa trên `noiseSeed` để băm nát fingerprint hình ảnh WebGL.

### 3.3. Canvas Fingerprinting (Sâu hơn)
- **Vấn đề**: Giống WebGL, vẽ 2D Context rồi `toDataURL()`.
- **Giải pháp (C++)**: Patch hàm trích xuất ảnh canvas của Blink để chèn nhiễu (noise) theo nguyên tắc tương tự WebGL.

### 3.4. Hardware Concurrency & Device Memory
- **Vấn đề**: Số luồng CPU (`navigator.hardwareConcurrency`) và RAM (`navigator.deviceMemory`).
- **Giải pháp (C++)**: Tạo cờ `--spoof-cpu-cores` và `--spoof-device-memory`, patch trực tiếp tại `third_party/blink/renderer/core/frame/navigator.cc`.

### 3.5. TLS Fingerprinting (JA3 / JA4)
- **Vấn đề**: Cloudflare không chỉ nhìn vào Browser, nó nhìn vào tầng mạng (Network). Handshake TLS của Chrome có một chữ ký (Cipher suites, Extensions order) cố định. Nếu dùng Puppeteer/Node, chữ ký TLS có thể bị nhận diện là bot.
- **Giải pháp**: Rất khó, cần patch thư viện `BoringSSL` (trong thư mục `third_party/boringssl`) để tráo đổi thứ tự cipher suites dựa trên seed. Tuy nhiên, Chromium hiện nay đã có cơ chế TLS Client Hello Randomization (mặc định), nên mức độ ưu tiên không cao bằng các mục trên.

### 3.6. Client Hints (Sec-CH-UA)
- **Vấn đề**: Trình duyệt gửi các header `Sec-CH-UA`, `Sec-CH-UA-Platform`. Khi thay đổi User-Agent, nếu các header này không khớp, bot sẽ phát hiện ngay.
- **Giải pháp (C++)**: Đảm bảo cờ `--user-agent` đồng bộ với các giá trị Client Hints trong lõi C++ (thường ở `components/embedder_support/user_agent_utils.cc`).

---
**Kết luận**: Với cấu trúc hiện tại, Xsurau đã sở hữu **Core C++ Antidetect Engine** cực kỳ vững chắc, vượt trội hoàn toàn so với các tool dùng Puppeteer/Playwright tiêm JS thuần. Việc bổ sung WebGL/Canvas Noise ở mức C++ sẽ là bước đi tối thượng cuối cùng.
