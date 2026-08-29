# PRO POS Print Agent v0.2.0

Ngày chuẩn bị: 2026-08-29

## Điểm mới

- Dashboard desktop mới, hiển thị trạng thái cloud/máy in bằng tiếng Việt thay vì raw runtime enum.
- Wizard ghép nối 6 số có countdown, tạo mã mới và hướng dẫn trực tiếp trong ứng dụng.
- Cài đặt nâng cao cho Server URL, IP/port máy in, K58/K80, autostart, diagnostics, ghép nối lại và reset.
- Trạng thái lệnh in gần nhất được chiếu từ các event runtime sẵn có, không thêm polling hoặc print lifecycle mới.
- Loading, chống double-click, toast và lỗi thân thiện; chi tiết kỹ thuật chỉ mở khi cần.
- Tray icon hiển thị rõ trên Windows và menu dùng nhãn trạng thái thân thiện.
- Mặc định desktop mới kết nối production PRO POS; cấu hình vẫn có thể chỉnh trước khi pairing.
- Package version và workflow Windows được khóa khớp tag `print-agent-v0.2.0`.

## Tương thích và bảo mật

- Giữ một `AgentRuntime`, một WebSocket và queue/TCP ESC/POS hiện có.
- Giữ `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Renderer chỉ nhận cấu hình không nhạy cảm; `agentSecret` tiếp tục được lưu qua OS credential protection và không đi qua preload.
- Giữ single-instance, close-to-tray, reconnect và autostart do người dùng điều khiển.

## Automated gates

- Print Agent TypeScript typecheck.
- Unit tests runtime, queue/printing, credential store, autostart và UI state presentation.
- Electron main/preload/renderer bundle.
- Windows NSIS + portable build và SHA-256 checksums trên GitHub Actions.

## Manual Windows/device gates

Các bước T01–T16 trong [Print Agent Windows release acceptance](../runbooks/print-agent-release-acceptance.md) vẫn là checklist nghiệm thu trên Windows/máy in vật lý. Automated build không thay thế kiểm tra K58/K80, lỗi giữa lúc TCP write, upgrade và burn-in 8–12 giờ.
