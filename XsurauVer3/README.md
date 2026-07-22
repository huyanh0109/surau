# Xsurau Antidetect Manager v2.1.0

Phần mềm quản lý Profile Antidetect chuyên nghiệp, hỗ trợ nuôi tài khoản và tự động hóa (Automation).

## 🚀 Hướng dẫn cài đặt trên máy mới

### 1. Yêu cầu hệ thống
- Đã cài đặt **Node.js** (Phiên bản mới nhất khuyến nghị v20+).
- Đã có mã nguồn (Git clone).

### 2. Cài đặt thư viện
Mở Terminal (cmd/PowerShell) tại thư mục `Xsurau` và chạy lệnh:
```bash
npm install
```

### 3. Cấu hình biến môi trường (.env)
Copy tệp `.env` của bạn vào thư mục `Xsurau`. Đảm bảo các biến sau đã được thiết lập:
- `GOOGLE_CREDENTIALS_JSON` (Cho Google Sheets)
- `GOOGLE_SHEET_ID`
- `GOOGLE_SHEET_NAME2`
- Các API Key cần thiết khác.

### 4. Cách chạy phần mềm

#### Chế độ Phát triển (Development)
Để chạy giao diện và server đồng thời:
```bash
npm run app
```

#### Chế độ Server thuần (Không giao diện)
```bash
npm start
```

### 5. Đóng gói thành file .exe (Portable)
Nếu bạn muốn tạo file chạy độc lập để mang sang máy khác mà không cần cài Node.js:
```bash
npx electron-packager . "Xsurau Manager" --platform=win32 --arch=x64 --icon=icon.png --overwrite --out=dist
```
*Lưu ý: Sau khi đóng gói, hãy copy tệp `.env` vào cùng thư mục với file `.exe` vừa tạo trong thư mục `dist`.*

## 🛠 Tính năng chính
- Quản lý Profile Antidetect (Browser Fingerprinting).
- Tích hợp Google Sheets để đồng bộ dữ liệu tài khoản.
- Hệ thống Automation Scripts (Login, Verify, Appeal...).
- Proxy Gateway (Port 8888) hỗ trợ xoay IP nóng.
- Giao diện Dashboard hiện đại, chuyên nghiệp.
