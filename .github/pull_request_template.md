## Kết quả

<!-- Mô tả ngắn kết quả nghiệp vụ/kỹ thuật. -->

## Phạm vi

- [ ] Client/UI
- [ ] Worker/API
- [ ] D1 migration
- [ ] R2
- [ ] Auth/device/RBAC
- [ ] Pricing/POS/checkout
- [ ] Docs/CI/release

## Trust boundary

- [ ] Không tin `store_id`, actor, permission, giá hoặc tổng tiền từ client.
- [ ] Đã kiểm tra cross-store và permission nếu liên quan.
- [ ] Không đưa credential vào JSON, log hoặc localStorage.

## Migration và rollback

- [ ] Không đổi schema.
- [ ] Migration forward-only và tương thích version trước.
- [ ] Rollback/forward-fix đã được mô tả.

## Validation

- [ ] `pnpm verify`
- [ ] Staging smoke
- [ ] UI reference + screenshot, nếu có UI

## Docs

- [ ] Docs/ADR/OpenAPI đã cập nhật hoặc `N/A` có giải thích.
