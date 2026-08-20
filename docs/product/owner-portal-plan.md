# Kế hoạch Owner Operations Portal

## Mục tiêu

Cho phép Owner đã đăng nhập cấu hình đầy đủ dữ liệu tối thiểu để một POS device và Employee có thể
bắt đầu bán hàng: thông tin cửa hàng, nhân viên, khu vực, bàn, danh mục, đơn vị, sản phẩm/biến thể
và bảng giá giờ.

## Điều kiện bắt đầu

- PRO-009 đã merge `dev`; Owner OTP và session staging hoạt động.
- Có UI reference được duyệt cho desktop/mobile. Không tự suy đoán visual cuối.
- Dữ liệu staging có ít nhất một store ACTIVE và một Owner ACTIVE.

## Phạm vi màn hình

| Màn hình       | Chức năng tối thiểu                                                | Trạng thái bắt buộc       |
| -------------- | ------------------------------------------------------------------ | ------------------------- |
| Owner shell    | Navigation, store identity, logout, session expiry                 | loading/ready/403/expired |
| Dashboard      | Checklist cấu hình và shortcut                                     | empty/partial/ready/error |
| Store settings | Tên, điện thoại, địa chỉ, cutoff, tài khoản ngân hàng              | view/edit/saving/error    |
| Staff          | List, create, permission, enable/disable, reset PIN                | empty/list/form/error     |
| Areas & tables | Create/list area và bàn, gán time product                          | empty/list/form/error     |
| Catalog        | Category, unit, product, variant và giá bán                        | empty/list/form/error     |
| Time pricing   | Mode, base price/duration, first period, special windows, rounding | view/edit/invalid/error   |
| Audit          | 100 sự kiện gần nhất                                               | empty/list/error          |

## API hiện có và khoảng trống

Đã có baseline:

- `GET/PUT /api/v1/owner/store/settings`, `GET /audit-logs`.
- `GET/POST /api/v1/owner/staff`, status và reset PIN.
- List/create areas, categories, units, products và tables; unit settings có pagination, usage count,
  edit/delete an toàn và danh sách mặt hàng đang sử dụng.
- Upsert pricing config.

Cần hoàn thiện trong giai đoạn:

- Update/disable cho named resources, products/variants và tables.
- Read pricing config để edit an toàn; optimistic concurrency/version nếu cần.
- Permission catalog chuẩn cho form tạo Employee; không nhận permission key ngoài store policy.
- Pagination/search cho danh sách có thể tăng lớn.
- Audit events cho mọi mutation Owner và error contract nhất quán.

## Work breakdown đề xuất

1. **PRO-010 — Owner shell và route guard**: auth context, layout, accordion navigation, logout,
   401/403, dashboard khung và settings landing hub.
2. **PRO-011 — Area/table settings**: khu vực, bàn/phòng, sắp xếp và trạng thái sử dụng.
3. **PRO-012 — Staff, roles và permissions**: employee lifecycle, vai trò, quyền và reset PIN.
4. **PRO-013 — Catalog items và categories MVP**: danh sách/tìm kiếm, form thêm/sửa mặt hàng,
   phiên bản giá số lượng/trọng lượng, giá cơ bản theo thời gian và danh mục.
5. **PRO-014 — Unit settings**: danh sách đơn vị có phân trang, thêm/sửa, usage count, danh sách
   mặt hàng sử dụng và xóa có bảo vệ.
6. **PRO-015 — Product pricing completion**: giờ đặc biệt, overlap validation và avatar media.
7. **PRO-016 — POS sales portal**: table board, order workspace, quote và checkout.
8. **PRO-017 — Owner E2E và staging hardening**: cross-store/RBAC, audit, responsive E2E, smoke.


Mỗi ticket giữ migration additive/forward-only và cập nhật OpenAPI, screen registry, tests,
changelog cùng PR.

## Acceptance criteria

- Owner chỉ thấy và sửa dữ liệu của store trong session; cross-store luôn bị từ chối.
- Refresh/deep link giữ đúng route; session hết hạn quay về Owner login với thông báo rõ ràng.
- Có thể tạo Employee, kích hoạt POS, tạo cấu hình tối thiểu và Employee đăng nhập để thấy dữ liệu.
- Pricing form dùng cùng validation/domain rules với backend; lỗi field hiển thị được.
- Mutation quan trọng có loading, retry-safe behavior và audit event.
- Desktop/mobile đạt visual approval; keyboard và label cơ bản hoạt động.
- Unit/integration/E2E, production build, staging smoke và rollback note đều đạt.

## Kế hoạch tài liệu trong giai đoạn

- Cập nhật [UI screen registry](../ui-screen-registry.md) ngay khi nhận reference và sau visual
  approval.
- Mở rộng [OpenAPI](../api/openapi.yaml) với schema/request/response/error thực tế cho Owner APIs.
- Ghi mọi migration vào [migration policy](../database/migrations.md).
- Bổ sung Owner happy path/cross-store vào [test strategy](../testing.md).
- Cập nhật deploy/rollback/incident runbook nếu thêm binding, migration hoặc operational step.
- Cập nhật [status-roadmap](../project/status-roadmap.md) và changelog trong từng PR.

## Ngoài phạm vi

- POS table board và order operations.
- Checkout/payment/receipt printing.
- Inventory, promotion, CRM, QR Order và báo cáo nâng cao.
