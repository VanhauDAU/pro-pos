# Cloudflare integration

## Resources

| Environment | Worker               | D1                                                               | R2                         |
| ----------- | -------------------- | ---------------------------------------------------------------- | -------------------------- |
| staging     | `pro-pos-staging`    | `pro-pos-staging-db` (`7ec0c566-2bf4-48b9-a9e6-fd5b75b6dc31`)    | `pro-pos-staging-media`    |
| production  | `pro-pos-production` | `pro-pos-production-db` (`651d7ec6-a2c8-4fa1-82d5-679b6e90c8ca`) | `pro-pos-production-media` |

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
