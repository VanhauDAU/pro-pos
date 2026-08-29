# PRO POS Print Agent

Ứng dụng desktop chạy tại quầy thu ngân, nhận lệnh in từ PRO POS qua kết nối outbound WebSocket và gửi trực tiếp tới máy in nhiệt ESC/POS trong mạng LAN qua TCP 9100. Không cần cài Node.js, QZ Tray hoặc mở cổng Internet trên máy tính quầy.

## Cài đặt trên Windows 10/11

### 1. Chuẩn bị

- Máy tính Windows 10/11 64-bit có kết nối Internet.
- Máy tính và máy in nhiệt nằm cùng mạng LAN.
- Máy in dùng giao thức ESC/POS qua TCP, thường ở cổng `9100`.
- Nên đặt IP tĩnh hoặc DHCP reservation cho máy in để địa chỉ không đổi sau khi khởi động router.

### 2. Tải bản phát hành

Mở trang [PRO POS Print Agent Releases](https://github.com/VanhauDAU/pro-pos/releases), chọn bản `print-agent-v0.2.0` hoặc mới hơn và tải một trong hai file:

- `PRO.POS.Print.Agent.Setup.0.2.0.exe`: bản cài đặt, phù hợp cho sử dụng hằng ngày.
- `PRO.POS.Print.Agent-0.2.0-x64-Portable.exe`: bản chạy trực tiếp, phù hợp để kiểm tra nhanh.

Tải thêm `SHA256SUMS.txt` nếu cần xác minh file. Trong PowerShell:

```powershell
(Get-FileHash '.\PRO.POS.Print.Agent.Setup.0.2.0.exe' -Algorithm SHA256).Hash.ToLower()
```

Giá trị phải trùng với dòng tương ứng trong `SHA256SUMS.txt`. Bản hiện tại chưa ký code-signing; Windows SmartScreen có thể hiện cảnh báo. Chỉ chọn **More info → Run anyway** khi file được tải từ trang GitHub chính thức ở trên và checksum khớp.

### 3. Cài và cấu hình máy in

1. Chạy file Setup, hoàn tất trình cài đặt rồi mở **PRO POS Print Agent** từ Desktop hoặc Start Menu.
2. Ở màn hình đầu tiên, chọn **Cài đặt kết nối**.
3. Giữ nguyên Server URL production; nhập IP máy in, port `9100` và chọn khổ giấy K58/K80.
4. Chọn **Lưu & khởi động lại**.

Giá trị IP mặc định là `192.168.1.73`; cần thay bằng địa chỉ thực tế nếu máy in của cửa hàng dùng IP khác.

### 4. Ghép nối với cửa hàng

1. Chọn **Bắt đầu ghép nối**. Print Agent hiển thị mã 6 số và thời gian còn hiệu lực.
2. Mở PRO POS → **Cài đặt máy in → Print Agent**.
3. Nhập mã 6 số đang hiển thị trên máy tính quầy.
4. Khi dashboard báo **Đã kết nối**, chọn **In thử**.
5. Khi máy in nhận phiếu test, trạng thái chuyển thành **Sẵn sàng**.

Thông tin ghép nối được mã hóa bằng cơ chế bảo vệ credential của hệ điều hành. UI không hiển thị hoặc gửi `agentSecret` cho renderer.

### 5. Chạy nền và tự khởi động

- Đóng cửa sổ chỉ ẩn Print Agent xuống khay hệ thống; ứng dụng vẫn nhận lệnh in.
- Nhấp icon máy in trong system tray để mở lại.
- Bật **Khởi động cùng Windows** trên dashboard nếu muốn Print Agent tự chạy ẩn sau khi đăng nhập.
- Chọn **Thoát** trong menu tray khi cần dừng hoàn toàn.

## Nâng cấp

1. Tải Setup của bản mới từ trang Releases.
2. Chọn **Thoát** trong menu tray của phiên bản đang chạy.
3. Chạy Setup mới. Không cần gỡ bản cũ trước.
4. Mở Print Agent và xác nhận cửa hàng, IP máy in, trạng thái autostart vẫn được giữ.
5. Chạy **In thử** sau nâng cấp.

## Xử lý sự cố

### Không thể kết nối máy in

- Kiểm tra nguồn, giấy và dây mạng của máy in.
- In trang self-test của máy in để xác nhận IP hiện tại.
- Từ máy tính quầy, kiểm tra cổng: `Test-NetConnection <IP-máy-in> -Port 9100`.
- Mở **Cài đặt nâng cao**, sửa IP/port rồi chạy **In thử**.

### Print Agent mất kết nối máy chủ

- Kiểm tra Internet và firewall/proxy của Windows.
- Chọn **Kết nối lại**; runtime cũng tự reconnect khi mạng phục hồi.
- Mở **Cài đặt nâng cao → Mở thư mục nhật ký** để thu thập diagnostics.

### Ghép nối lại hoặc chuyển cửa hàng

Mở **Cài đặt nâng cao → Ghép nối lại**, xác nhận thao tác, rồi nhập mã mới trên PRO POS. Tùy chọn này giữ nguyên IP/port máy in. **Xóa cấu hình** sẽ xóa cả liên kết cửa hàng lẫn cài đặt máy in và luôn yêu cầu xác nhận.

## Phát triển và kiểm thử

Yêu cầu Node.js 24 và pnpm 11:

```bash
pnpm install --frozen-lockfile
pnpm --filter @propos/print-agent typecheck
pnpm exec vitest run tests/unit/print-agent.test.ts tests/unit/print-agent-runtime.test.ts tests/unit/print-agent-credential-store.test.ts tests/unit/print-agent-autostart.test.ts tests/unit/print-agent-presentation.test.ts
pnpm --filter @propos/print-agent build:desktop
pnpm --filter @propos/print-agent dev:desktop
```

Build installer Windows trên Windows runner:

```bash
pnpm --filter @propos/print-agent dist:win
```

Workflow `.github/workflows/print-agent-release.yml` build NSIS, portable executable, checksum và chỉ publish GitHub Release khi tag `print-agent-v<package-version>` khớp chính xác.
