# PRO POS Print Agent 🖨️

Ứng dụng in ấn độc lập dành cho **Pro POS**. Print Agent chạy ngầm trên máy tính quầy thu ngân (Mac / Windows), kết nối Outbound WebSocket với máy chủ Pro POS và in trực tiếp đến máy in nhiệt LAN (Cổng TCP 9100).

---

## 🚀 Tính Năng Chính

- **Không cần QZ Tray**: Không cài đặt phần mềm bên thứ 3 phức tạp, không cần chứng chỉ số (Certificate), không hiện popup "Allow".
- **In tự động hoàn toàn**: Điện thoại / iPad / Web POS bấm In → Máy in tại quầy tự động in ngay lập tức (<0.5 giây).
- **An toàn mạng**: Print Agent chủ động tạo kết nối Outbound tới máy chủ, không mở cổng công khai (không NAT, không cấu hình Router phức tạp).
- **Hàng đợi chống nghẽn (FIFO)**: Đảm bảo in tuần tự từng hóa đơn, không bị chồng đè byte khi nhiều nhân viên bấm in cùng lúc.
- **Ghép nối 1 lần bằng mã 6 số**: Cấu hình được lưu vĩnh viễn trên máy tính quầy.

---

## 🛠️ HƯỚNG DẪN CÀI ĐẶT & CHẠY TRÊN MÁY TÍNH MỚI (Windows / Mac)

### Bước 1: Chuẩn bị

1. Cài đặt **Node.js LTS** (miễn phí tại [nodejs.org](https://nodejs.org)) nếu máy chưa có.
2. Chép thư mục `apps/print-agent` (hoặc toàn bộ dự án) sang máy tính quầy.

### Bước 2: Cài đặt và Khởi động

Mở **Terminal** (trên Mac) hoặc **Command Prompt / PowerShell** (trên Windows):

```bash
# 1. Đi vào thư mục print-agent trên máy mới
cd apps/print-agent

# 2. Cài đặt thư viện (rất nhẹ, chỉ mất 5 giây)
npm install

# 3. Khởi động Print Agent
npx tsx src/index.ts --server https://pro-pos-production.vanhau-laravel.workers.dev --ip 192.168.1.73
```

> **Lưu ý:** Thay `192.168.1.73` bằng địa chỉ IP của máy in nhiệt tại quán của bạn.

---

### Bước 3: Ghép nối với Cửa hàng (Chỉ làm 1 lần duy nhất)

1. Khi khởi chạy lần đầu, màn hình sẽ hiển thị mã ghép nối gồm **6 chữ số**:
   ```text
   ========================================
      PRO POS PRINT AGENT - GHÉP NỐI THIẾT BỊ
   ========================================
   ----------------------------------------
     MÃ GHÉP NỐI:   748 - 291
   ----------------------------------------
   ```
2. Trên điện thoại hoặc máy tính, mở **Pro POS**:
   - Vào: **Cài đặt** → **Máy in** → Bấm **"Thêm Print Agent"**.
   - Nhập mã 6 chữ số (ví dụ: `748291`) và nhấn **Xác nhận ghép nối**.
3. Print Agent lập tức chuyển sang trạng thái:
   ```text
   ========================================
       PRO POS PRINT AGENT (v0.1.0)
   ========================================
   ● Trạng thái : ĐANG HOẠT ĐỘNG (ONLINE)
   Cửa hàng     : Pro POS Billiards Club
   Máy in LAN   : 192.168.1.73:9100 (K80)
   Máy chủ      : https://pro-pos-production.vanhau-laravel.workers.dev
   ----------------------------------------
   Tự động in tất cả yêu cầu in từ Điện thoại / iPad / Web POS.
   Không mở popup, không cần xác nhận trên máy tính.
   ========================================
   ```
4. Cấu hình được lưu tự động tại `~/.propos-print-agent/config.json`. Các lần bật máy sau sẽ **tự động ONLINE** mà không cần ghép nối lại.

---

## ⚡ HƯỚNG DẪN TỰ ĐỘNG CHẠY KHI MỞ MÁY TÍNH (Autostart)

### Dành cho Windows (Startup):

1. Tạo 1 file tên là `ChayMayIn.bat` trong thư mục `print-agent` với nội dung:
   ```bat
   @echo off
   cd /d "%~dp0"
   npx tsx src/index.ts
   ```
2. Nhấn tổ hợp phím `Windows + R`, gõ `shell:startup` rồi nhấn **Enter** để mở thư mục Startup của Windows.
3. Tạo lối tắt (**Shortcut**) của file `ChayMayIn.bat` và dán vào thư mục Startup này.

> **Kết quả:** Mỗi khi bật máy tính thu ngân, Print Agent sẽ tự động chạy ngầm.

### Dành cho macOS (PM2):

```bash
# 1. Cài đặt PM2 toàn cục
npm install -g pm2

# 2. Khởi chạy Print Agent ngầm
pm2 start "npx tsx src/index.ts" --name "propos-print-agent"

# 3. Lưu cấu hình tự chạy cùng hệ điều hành
pm2 save
pm2 startup
```

---

## 📖 DANH SÁCH THAM SỐ DÒNG LỆNH (CLI Options)

| Tham số          | Mô tả                                     | Ví dụ                                       |
| :--------------- | :---------------------------------------- | :------------------------------------------ |
| `--ip <IP>`      | Đặt địa chỉ IP của máy in LAN             | `npx tsx src/index.ts --ip 192.168.1.200`   |
| `--port <PORT>`  | Cổng kết nối máy in (mặc định: 9100)      | `npx tsx src/index.ts --port 9100`          |
| `--server <URL>` | Địa chỉ máy chủ Pro POS                   | `npx tsx src/index.ts --server https://...` |
| `--test`         | In thử 1 hóa đơn mẫu ngay khi khởi động   | `npx tsx src/index.ts --test`               |
| `--reset`        | Xóa thông tin ghép nối cũ để ghép nối lại | `npx tsx src/index.ts --reset`              |

---

## 🧪 CHẠY KIỂM THỬ TỰ ĐỘNG (Tests)

```bash
# Tại thư mục gốc của repo
pnpm test          # Chạy toàn bộ unit tests
pnpm typecheck     # Kiểm tra kiểu dữ liệu TypeScript
```
