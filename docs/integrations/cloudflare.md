# Cloudflare integration

## Resources

| Environment | Main Worker          | Auth bridge Worker        | D1                                                               | R2                         |
| ----------- | -------------------- | ------------------------- | ---------------------------------------------------------------- | -------------------------- |
| staging     | `pro-pos-staging`    | `pro-pos-auth-staging`    | `pro-pos-staging-db` (`7ec0c566-2bf4-48b9-a9e6-fd5b75b6dc31`)    | `pro-pos-staging-media`    |
| production  | `pro-pos-production` | `pro-pos-auth-production` | `pro-pos-production-db` (`651d7ec6-a2c8-4fa1-82d5-679b6e90c8ca`) | `pro-pos-production-media` |

Binding names giống nhau (`DB`, `MEDIA`), nhưng resource IDs và secrets phải khác.

D1 staging/production đã được tạo. Trước deploy còn phải kích hoạt R2, tạo hai bucket, đặt
Worker Secrets qua `wrangler secret put`, migrate staging, smoke, sau đó mới production.

Sinh file secrets một lần bằng `pnpm secrets:generate:staging`; script tạo file ignored với mode
0600 và không in giá trị. Upload bằng `wrangler deploy --env staging --secrets-file
.env.staging.secrets`. Không chạy lại nếu file đã tồn tại; dùng `wrangler secret put` khi rotate.

Workers Builds:

- Production connection theo dõi `main`, non-production build tắt.
- Staging connection theo dõi `dev`, preview bật cho `feat/*`.
- Build command chạy `pnpm verify` trước deploy.
- `CLOUDFLARE_ENV` được chọn lúc Vite build, không chỉ lúc `wrangler deploy`.

## Cloudflare Access email OTP — Free

Không bật Access cho main Worker. Chỉ bảo vệ auth bridge Worker tương ứng; bridge dùng cùng D1 với
main Worker và chỉ nhận path:

```text
/complete
```

Nếu bảo vệ toàn Worker, Employee PIN, health check và App Shell cũng bị buộc đăng nhập email, sai
invariant POS.

### Staging

1. Cloudflare Dashboard → Zero Trust → chọn Free plan.
2. Zero Trust → Integrations → Identity providers → Add new → One-time PIN.
3. Zero Trust → Access controls → Applications → Add an application → Self-hosted.
4. Deploy bridge bằng `pnpm deploy:auth:staging`, rồi tạo application name
   `Pro POS Staging OTP`.
5. Application domain/path:

   ```text
   pro-pos-auth-staging.vanhau-laravel.workers.dev
   ```

6. Policy action `Allow`; Include selector `Emails`; nhập từng email Owner/SUPER_ADMIN chính xác.
   Không dùng `Everyone`, không chỉ dùng `Login Methods: One-time PIN`, và không allow toàn
   `gmail.com`.
7. Session duration: 15 phút; giữ `HTTP Only` và `SameSite=Lax`, nhưng **không bật**
   `Enforce cookie path attribute`.
8. Lưu application, mở browser sạch và kiểm tra email OTP trước khi bootstrap.

### Production

Tạo application riêng, không dùng chung staging policy:

```text
pro-pos-auth-production.vanhau-laravel.workers.dev
```

Exact-email allowlist production chỉ chứa người dùng thật. Khi SUPER_ADMIN tạo Owner mới trong D1,
phải thêm email đó vào Access policy trước khi bàn giao đăng nhập.

### Local/test

Chạy main app bằng `pnpm dev` và chạy bridge ở terminal khác bằng `pnpm dev:auth`.
`wrangler.access.jsonc` dùng `access.dev` với identity giả `system.admin@example.com` để kiểm tra
SUPER_ADMIN local; email này phải tồn tại trong D1 local. Muốn kiểm tra Owner, đổi identity dev sang
đúng email Owner trong D1. Staging/production identity luôn do Cloudflare Access tạo. Integration
test mô phỏng bridge authorization rồi kiểm tra code exchange trên main Worker.

### Validation và rollback

- Email có trong Access + D1 → bridge redirect về main Worker và tạo đúng Owner/platform session.
- Email có trong Access nhưng không có D1 → `ACCESS_IDENTITY_DENIED`, không tạo session.
- Callback thiếu Access hoặc state cookie → 401, không có credential.
- Activation callback chỉ tạo grant 5 phút, không giữ Owner session.
- Tắt/xóa Access application là rollback edge; password login cũ không còn là fallback.
- Access authentication logs: Zero Trust → Insights → Logs → Access authentication logs.
