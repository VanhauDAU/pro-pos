# Deploy runbook

1. `pnpm verify` xanh.
2. Xác nhận D1/R2/secrets đúng environment.
3. Chạy migration staging và staging smoke.
4. Release PR `dev → main`; ghi migration/rollback note.
5. Lưu D1 Time Travel bookmark/export nếu có migration.
6. Merge main để Workers Builds deploy production.
7. Smoke health, login, device context, catalog, open/cancel test order và invoice read.
8. Tạo tag/GitHub Release sau smoke thành công.

## Bootstrap lần đầu

Sau khi staging Worker, D1, R2, secrets và Access application đã sẵn sàng, chạy
`pnpm bootstrap:staging`. CLI đọc `SYSTEM_BOOTSTRAP_SECRET` từ file ignored và hỏi email/display
name. Email phải trùng exact-email Allow policy của Cloudflare Access. Endpoint chỉ tạo SUPER_ADMIN
khi hệ thống chưa có tài khoản platform; Pro POS không nhận password.
