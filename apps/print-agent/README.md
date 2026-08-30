# PRO POS Print Agent

Ứng dụng desktop chạy tại quầy thu ngân, nhận lệnh in từ PRO POS qua kết nối outbound WebSocket an toàn và gửi trực tiếp tới máy in nhiệt ESC/POS:

1. **USB trên Windows**: Gửi RAW ESC/POS bytes trực tiếp vào Windows Print Spooler (`winspool.drv`), tương thích mọi máy in có driver Windows mà không cần cài Zadig hay libusb.
2. **Mạng LAN / Wi-Fi**: Kết nối qua giao thức TCP cổng 9100.

Không yêu cầu cài đặt Node.js hay QZ Tray, không cần mở cổng Internet trên máy tính quầy.

---

## Phân Định Quyền Hạn & Nguồn Sự Thật (Source of Truth)

- **Owner (Chủ quán)**: Quản lý toàn bộ chính sách in cấp cửa hàng (số bản in khi thanh toán, số bản in khi in tạm tính, quyền in tạm tính, mẫu in, logo, footer, VietQR).
- **POS Nhân viên**: Quản lý thiết bị nhận lệnh tại quầy (xem trạng thái Online/Offline, ghép nối mã 6 số, xóa Agent, gửi lệnh in thử từ xa, in dự phòng qua trình duyệt).
- **Print Agent Desktop**: Nguồn sự thật duy nhất cho kết nối phần cứng máy in (`connectionType`, `printerIp`, `printerPort`, `printerName`, khổ giấy `K80`/`K58`, cân chỉnh printable dots, auto cut, cash drawer).

---

## Cài đặt trên Windows 10/11

### 1. Chuẩn bị

- Máy tính Windows 10/11 64-bit có kết nối Internet.
- **Nếu dùng máy in USB**: Đã cắm cáp USB và cài driver máy in (Windows đã nhận máy in trong Control Panel / Settings).
- **Nếu dùng máy in LAN**: Máy in và máy tính nằm cùng mạng nội bộ.

### 2. Tải bản phát hành

Mở trang [PRO POS Print Agent Releases](https://github.com/VanhauDAU/pro-pos/releases), chọn bản `print-agent-v0.4.0` hoặc mới hơn và tải file:

- `PRO POS Print Agent Setup 0.4.0.exe`: Bản cài đặt NSIS tự động tạo shortcut Desktop & Start Menu.
- `PRO POS Print Agent-0.4.0-x64-Portable.exe`: Bản Portable chạy trực tiếp không cần cài đặt.

Tải thêm `SHA256SUMS.txt` nếu cần xác minh file:

```powershell
(Get-FileHash '.\PRO POS Print Agent Setup 0.4.0.exe' -Algorithm SHA256).Hash.ToLower()
```

### 3. Cấu hình máy in lần đầu (First-Run Wizard)

1. Mở ứng dụng **PRO POS Print Agent**.
2. **Bước 1 — Kết nối máy in**:
   - Chọn **Máy in trên Windows**: Chọn tên máy in từ dropdown (ví dụ `POS-80 Printer`) và chọn khổ giấy `K80` / `K58`.
   - Hoặc chọn **Mạng LAN**: Nhập địa chỉ IP máy in và cổng `9100`.
   - Nhấn **Kiểm tra & In thử**. Khi máy in in ra phiếu thử thành công, xuất hiện thông báo `✓ Máy in hoạt động tốt`.
   - Nhấn **Tiếp tục kết nối PRO POS**.
3. **Bước 2 — Ghép nối với PRO POS**:
   - Màn hình hiển thị mã 6 số to rõ ràng (ví dụ `842 165`) kèm countdown thời gian hiệu lực.
   - Mở màn hình POS của cửa hàng: **Cài đặt máy in → Print Agent → Thêm Print Agent**.
   - Nhập mã 6 số để hoàn tất ghép nối.

### 4. Vận hành hằng ngày

- Dashboard hiển thị trạng thái tối giản: Trạng thái kết nối PRO POS, thông tin máy in vật lý, lệnh in gần nhất.
- Bật **Khởi động cùng Windows** để Print Agent tự chạy ngầm sau khi mở máy tính.
- Đóng cửa sổ ứng dụng sẽ tự động thu nhỏ xuống System Tray (khay hệ thống).

---

## Cài đặt trên macOS (Apple Silicon & Intel)

### 1. Tải bản phát hành

- `PRO POS Print Agent-0.4.0-arm64.dmg`: Dành cho chip Apple Silicon (M1/M2/M3/M4).
- `PRO POS Print Agent-0.4.0-x64.dmg`: Dành cho máy Mac dùng chip Intel.

### 2. Cài đặt và cấp quyền mạng cục bộ

1. Nhấp đúp vào file `.dmg` và kéo **PRO POS Print Agent** vào thư mục **Applications**.
2. Nếu macOS hiện cảnh báo chưa xác minh nhà phát triển, mở Terminal và chạy lệnh gỡ quarantine:
   ```bash
   xattr -cr "/Applications/PRO POS Print Agent.app"
   ```
   (hoặc vào **System Settings → Privacy & Security** và chọn **Open Anyway**).
3. Mở ứng dụng từ Finder và chọn **Allow** khi macOS hỏi quyền truy cập mạng cục bộ (Local Network).

---

## Xử lý sự cố

### Không thể kết nối máy in USB

- Kiểm tra nguồn và dây cáp USB máy in.
- Kiểm tra Windows Printer Queue trong Settings / Control Panel xem máy in có bị Offline không.
- Nhấn **Làm mới danh sách** trong cài đặt Print Agent.

### Không thể kết nối máy in LAN

- Kiểm tra nguồn, dây mạng và đèn tín hiệu trên máy in.
- In phiếu self-test trên máy in để kiểm tra lại IP.
- Kiểm tra cổng từ máy tính quầy: `Test-NetConnection <IP-máy-in> -Port 9100`.

### Mất kết nối máy chủ Cloud

- Kiểm tra kết nối Internet trên máy tính quầy.
- Ứng dụng sẽ tự động kết nối lại khi Internet phục hồi.

---

## Phát triển và đóng gói

Yêu cầu Node.js 24 và pnpm 11:

```bash
pnpm install --frozen-lockfile
pnpm --filter @propos/print-agent typecheck
pnpm exec vitest run tests/unit/print-agent.test.ts tests/unit/print-agent-runtime.test.ts tests/unit/print-agent-windows-transport.test.ts tests/unit/print-agent-usb-integration.test.ts tests/unit/print-rbac-source-of-truth.test.ts
pnpm --filter @propos/print-agent build:desktop
pnpm --filter @propos/print-agent dev:desktop
```

### Đóng gói phát hành (Dist)

```bash
# Đóng gói cho macOS (DMG & ZIP cho arm64 và x64):
pnpm --filter @propos/print-agent dist:mac

# Đóng gói cho Windows (NSIS Installer & Portable EXE):
pnpm --filter @propos/print-agent dist:win
```
