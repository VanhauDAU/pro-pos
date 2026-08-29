# PRO POS Print Agent

Ứng dụng desktop chạy tại quầy thu ngân, nhận lệnh in từ PRO POS qua kết nối outbound WebSocket và gửi trực tiếp tới máy in nhiệt ESC/POS trong mạng LAN qua TCP 9100. Không cần cài Node.js, QZ Tray hoặc mở cổng Internet trên máy tính quầy.

## Cài đặt trên Windows 10/11

### 1. Chuẩn bị

- Máy tính Windows 10/11 64-bit có kết nối Internet.
- Máy tính và máy in nhiệt nằm cùng mạng LAN.
- Máy in dùng giao thức ESC/POS qua TCP, thường ở cổng `9100`.
- Nên đặt IP tĩnh hoặc DHCP reservation cho máy in để địa chỉ không đổi sau khi khởi động router.

### 2. Tải bản phát hành

Mở trang [PRO POS Print Agent Releases](https://github.com/VanhauDAU/pro-pos/releases), chọn bản `print-agent-v0.3.1` hoặc mới hơn và tải một trong hai file:

- `PRO POS Print Agent Setup 0.3.1.exe`: bản cài đặt, phù hợp cho sử dụng hằng ngày.
- `PRO POS Print Agent-0.3.1-x64-Portable.exe`: bản chạy trực tiếp, phù hợp để kiểm tra nhanh.

Tải thêm `SHA256SUMS.txt` nếu cần xác minh file. Trong PowerShell:

```powershell
(Get-FileHash '.\PRO POS Print Agent Setup 0.3.1.exe' -Algorithm SHA256).Hash.ToLower()
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
- Nếu lệnh trên thất bại, kiểm tra Windows Firewall, antivirus và việc máy tính/máy in có bị tách VLAN hoặc client isolation hay không.
- Mở **Cài đặt nâng cao**, sửa IP/port rồi chạy **In thử**.

### Print Agent mất kết nối máy chủ

- Kiểm tra Internet và firewall/proxy của Windows.
- Runtime tự reconnect khi mạng phục hồi. Có thể dùng **Kết nối lại** trong menu tray để yêu cầu kết nối Cloud ngay.
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

### Đóng gói cho macOS (.dmg / .zip)

Build trực tiếp trên máy macOS:

```bash
# Build cả Apple Silicon (arm64) và Intel (x64)
pnpm --filter @propos/print-agent dist:mac

# Hoặc chỉ build cho Apple Silicon (M1/M2/M3/M4)
pnpm --filter @propos/print-agent dist:mac:arm64

# Hoặc chỉ build cho máy Mac dùng chip Intel
pnpm --filter @propos/print-agent dist:mac:x64
```

File `.dmg` và `.zip` xuất ra tại thư mục `apps/print-agent/release/`.

Các lệnh `dist:mac*` tự kiểm tra app đã đóng gói và sẽ fail nếu `Info.plist` không có đúng:

- `CFBundleIdentifier = com.propos.print-agent`
- `NSLocalNetworkUsageDescription = PRO POS Print Agent cần truy cập mạng nội bộ để kết nối và gửi dữ liệu tới máy in hóa đơn trong cửa hàng.`

Có thể kiểm tra thủ công bản ARM64:

```bash
plutil -p "apps/print-agent/release/mac-arm64/PRO POS Print Agent.app/Contents/Info.plist"
pnpm --filter @propos/print-agent verify:mac:plist -- arm64
```

Bundle ID production luôn là `com.propos.print-agent`; không đổi ID giữa các release vì cấu hình người dùng và Local Network privacy cần nhận diện cùng một ứng dụng. Repo không dùng bundle ID development riêng.

#### Local Network permission trên macOS

macOS 15 trở lên kiểm soát kết nối trực tiếp tới IP nội bộ, bao gồm TCP 9100. Sau khi cài app:

1. Mở `.dmg`, kéo **PRO POS Print Agent** vào **Applications**.
2. Mở app từ Finder: **Applications → PRO POS Print Agent**, không chạy executable trong bundle từ Terminal để xác minh production.
3. Chọn **Allow** khi macOS hỏi quyền Local Network. Có thể kiểm tra lại tại **System Settings → Privacy & Security → Local Network**.
4. Bấm **In thử**. Chỉ khi TCP connect và gửi dữ liệu ESC/POS thành công, trạng thái máy in mới chuyển sang **Sẵn sàng**.
5. Quit hoàn toàn rồi mở lại từ Finder và in thử lần nữa để kiểm tra quyền được duy trì.

Terminal và app mở từ Finder có privacy context/identity khác nhau. Việc executable chạy thành công từ Terminal không chứng minh bundle `.app` đã được macOS cấp quyền Local Network đúng.

App development vẫn có thể build khi chưa có Apple Developer ID. Tuy nhiên, Local Network privacy theo dõi danh tính chương trình bằng code signature; app unsigned hoặc ad-hoc có thể bị nhận diện thiếu ổn định giữa các build. Cấu hình builder không còn ép `identity: null`, vì vậy release production nên cung cấp chứng thư **Developer ID Application** cho electron-builder và giữ cùng bundle ID để permission bền vững qua update. Developer ID không phải điều kiện để phát triển hoặc kiểm thử cục bộ, nhưng là khuyến nghị cho phân phối production lâu dài.

Khi máy build không có identity hợp lệ, hook đóng gói macOS sẽ ad-hoc sign toàn bộ `.app` sau khi Electron hoàn tất packaging và trước khi tạo DMG/ZIP. Cách này tạo code-signing identifier `com.propos.print-agent`, seal resources và ổn định hơn bundle thực sự unsigned trong development. Nếu electron-builder đã ký hợp lệ bằng Developer ID, hook không ký đè. Hook trả về ngay trên non-macOS nên Windows artifacts không bị thay đổi.

#### Cài đặt và mở file .dmg trên macOS:

1. Nhấp đúp vào file `.dmg` và kéo biểu tượng ứng dụng vào thư mục **Applications**.
2. Do app chưa ký Apple Developer ID, mở Terminal và chạy lệnh gỡ quarantine nếu macOS cảnh báo không mở được:
   ```bash
   xattr -cr "/Applications/PRO POS Print Agent.app"
   ```
   (hoặc vào **System Settings** → **Privacy & Security** → bấm **Open Anyway**).
3. Mở ứng dụng từ Finder và cho phép quyền truy cập mạng cục bộ (Local Network) khi được hỏi.

Nếu TCP 9100 vẫn lỗi sau khi đã cho phép, mở **Xem chi tiết** để xem `errorCode`, `host`, `port`, `failureStage` và `localAddress` (nếu Node cung cấp). Diagnostics chỉ chứa metadata kết nối, không chứa token hoặc `agentSecret`.

### Đóng gói cho Windows (.exe)

Build installer Windows trên Windows runner hoặc máy Windows:

```bash
pnpm --filter @propos/print-agent dist:win
```

Workflow `.github/workflows/print-agent-release.yml` build NSIS, portable executable, checksum và chỉ publish GitHub Release khi tag `print-agent-v<package-version>` khớp chính xác.

Windows không có Local Network permission tương tự macOS. Cấu hình `NSLocalNetworkUsageDescription` chỉ được đưa vào macOS `Info.plist`; NSIS, portable executable, TCP 9100, autostart, pairing và realtime trên Windows không thay đổi.
