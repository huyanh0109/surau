# SMS Lookup API

Lightweight API để lookup SMS verification codes từ Google Sheets với Owner-based filtering.

## ✨ Features

- 🔍 **SMS Lookup**: Tìm kiếm mã xác minh SMS từ phone number
- 🔐 **Owner Filtering**: Hỗ trợ multiple owners với dấu `|` (ví dụ: `donalroy|kvmaster`)
- 📊 **Google Sheets Integration**: Tự động đọc và cập nhật data
- ⚡ **Lightweight**: Plain JavaScript, chỉ 4 dependencies, ~230 lines code
- 🚀 **Deploy-ready**: Tối ưu cho Railway, Render, Vercel

## 📦 Installation

```bash
npm install
```

## 🔧 Configuration

1. Copy `.env.example` thành `.env`:
```bash
cp .env.example .env
```

2. Điền thông tin trong `.env`:
```env
PORT=3000
GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_SHEET_NAME=RentPhone
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

3. Copy Google Service Account credentials vào thư mục root với tên `service-account.json`

## 🚀 Usage

**Development:**
```bash
npm start
```

**Production:**
```bash
npm start
```

Server sẽ chạy trên `http://localhost:3000`

## 📡 API Endpoints

### GET /sms

Lookup SMS verification code cho phone number với Owner filtering.

**Query Parameters:**
- `Owner` (required): Owner identifier (hỗ trợ multiple owners với `|`)
- `phone` (required): Phone number

**Example:**
```bash
curl "http://localhost:3000/sms?Owner=boss$$&phone=1234567890"
```

**Success Response (200):**
```json
{
  "text": "Your verification code is G-123456",
  "code": "123456",
  ...
}
```

**Error Responses:**
- `400`: Missing parameters hoặc no API configured
- `403`: Owner mismatch - phone tồn tại nhưng không thuộc owner này
- `404`: Phone number not found
- `500`: API call failed

### GET /

Health check endpoint.

**Example:**
```bash
curl "http://localhost:3000/"
```

## 📊 Google Sheet Structure

Sheet cần có các cột sau (A-E):

| Column | Name | Description |
|--------|------|-------------|
| A | PhoneNumber | Số điện thoại (digits only) |
| B | Api | API URL để lấy SMS |
| C | DateTime | Ngày tạo |
| D | LastUse | Lần dùng cuối (auto-update) |
| E | Owner | Owner(s), ngăn cách bởi `\|` |

**Example data:**
```
PhoneNumber | Api                  | DateTime            | LastUse             | Owner
1234567890  | https://api.sms.com  | 2026-01-01 10:00:00 | 2026-01-20 21:00:00 | boss$$
9876543210  | https://api.sms.com  | 2026-01-01 10:00:00 | 2026-01-19 15:00:00 | donalroy|kvmaster
```

## 🧪 Testing

**Test 1: Valid request**
```bash
curl "http://localhost:3000/sms?Owner=boss$$&phone=1234567890"
```

**Test 2: Missing parameters**
```bash
curl "http://localhost:3000/sms?phone=123"
# Expected: 400 error
```

**Test 3: Wrong owner**
```bash
curl "http://localhost:3000/sms?Owner=wrongowner&phone=1234567890"
# Expected: 403 error
```

**Test 4: Multiple owners**
- Sheet có Owner = `donalroy|kvmaster`
- Request với `Owner=donalroy` → ✅ Success
- Request với `Owner=kvmaster` → ✅ Success
- Request với `Owner=other` → ❌ 403 error

## 🌍 Deployment

### Railway
```bash
railway login
railway init
railway up
```

### Render
1. Connect GitHub repository
2. Set environment variables
3. Deploy

### Vercel
```bash
vercel
```

**Important**: Nhớ set environment variables trên platform!

## 📝 Project Structure

```
look-phone/
├── services/
│   ├── sheets.js      # Google Sheets client
│   └── sms.js         # SMS lookup logic
├── server.js          # Express server
├── .env.example       # Environment template
├── .gitignore
├── package.json
└── README.md
```

## 🔒 Security

- ⚠️ **NEVER** commit file `.env` hoặc `service-account.json` lên Git
- ✅ Luôn sử dụng environment variables cho sensitive data
- ✅ File `.gitignore` đã được cấu hình sẵn

## 📄 License

ISC
