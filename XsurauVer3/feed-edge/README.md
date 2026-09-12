# Microsoft Edge Emulation for Feed Manager (Phương án 1)

Thư mục này chứa toàn bộ logic giả lập trình duyệt Microsoft Edge trên nhân Chromium hiện tại của Loopy (dành riêng cho Feed Manager `H:\Loopy feed`).

### Các thành phần:
1. `index.js`:
   - **User-Agent Edge**: Danh sách các User-Agent Edge Windows mới nhất (Edge 136, 137, 138, 149, 150).
   - **Client Hints (Network)**: Gán header `sec-ch-ua` gửi `"Microsoft Edge"`, `"Chromium"`, `"Not?A_Brand"`.
   - **DOM Navigator (JS)**: Gán `navigator.userAgentData.brands` trả về `Microsoft Edge`.
   - **Bing Default Search**: Cấu hình mẫu tìm kiếm Bing dành riêng cho Edge desktop (`FORM=EDGE8N`, `PC=EUPP_`).

### Hướng dẫn Rollback (Khi muốn xóa bỏ hoàn toàn):
Nếu thử nghiệm thất bại hoặc không muốn dùng nữa, bạn chỉ cần:
1. Xóa thư mục `k:\Surau\Loopy\feed-edge\`
2. Xóa vài dòng import và gọi `feed-edge` trong `manager.js` và `server.js`.
3. Xóa trường `<select id="feedBrowserType">` trong `ui/index.html`.
Mọi profile cũ và hệ thống Chrome thông thường sẽ trở lại nguyên trạng 100%.
