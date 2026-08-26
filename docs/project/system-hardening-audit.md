# System hardening audit

Cập nhật: 2026-08-26. Đây là audit tĩnh và automated-test local sau POS consistency hardening;
staging UAT/benchmark và drill vận hành vẫn là gate riêng.

## Kết quả theo module

| Module             | Bằng chứng hiện có                                                                                    | Trạng thái / việc còn lại                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Auth, device, RBAC | Tenant lấy từ session server-side; activation/revoke/rate-limit và cross-store tests                  | Không thấy Sev-1/2 trong suite local; còn staging OTP/device revoke smoke                        |
| Catalog/import     | Validation/command, tenant repository, import preview/idempotency và integration tests                | Các vòng lặp import hiện có lint warning hiệu năng; Sev-3, cần benchmark file lớn                |
| Customer/debt      | Store-scoped service/repository, debt/payment tests và mutation invalidation                          | Danh mục tỉnh/nhóm cache dài; cần cross-device freshness test, hiện xếp Sev-3                    |
| POS/payment        | Stable quote/version, optimistic concurrency, idempotency, frozen snapshot, realtime replay/full-sync | Local hardening hoàn tất; staging E2E/benchmark là gate trước pilot                              |
| Invoice/printing   | Frozen accounting snapshot, allocation and QZ/browser receipt tests                                   | Cấu hình in cache `Infinity`; cần event/invalidation cross-device trước GA, Sev-3                |
| Owner/PWA          | Mutation invalidation, controlled service-worker update, Owner integration coverage                   | Cần mobile/Safari/accessibility và stale-settings smoke, Sev-3                                   |
| Operations         | Structured request/realtime logs, request ID, backup/rollback/incident runbooks                       | Chưa có alert dashboard và biên bản restore/rollback drill; chặn GA nhưng không chặn local merge |

## Phân loại release

- Không ghi nhận Sev-1 hoặc Sev-2 mới trong phạm vi code/test local sau thay đổi POS.
- Các mục Sev-3 đã biết: bundle POS lớn, lint warning ở import/customer repository, một số cấu hình
  ít thay đổi cache dài, browser/printer matrix và dashboard cảnh báo.
- Không được kết luận production-ready chỉ từ audit này. Authenticated E2E staging, POS benchmark,
  backup bookmark, rollback target và smoke 30 phút là gate bắt buộc.

## Thứ tự tiếp tục

1. Chạy authenticated E2E staging theo chế độ serial và benchmark 1/5/10/20 active orders.
2. Thêm freshness event/invalidation cho print settings và customer/static-reference caches nếu UAT
   có thao tác đồng thời nhiều thiết bị.
3. Thiết lập dashboard/alert cho 409/422/5xx, quote retry, realtime reconnect/full-sync và p95.
4. Hoàn tất mobile viewport, Safari/iPhone, printer matrix, restore và Worker rollback drill.
