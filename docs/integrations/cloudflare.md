# Cloudflare integration

## Resources

| Environment | Worker               | D1                      | R2                         |
| ----------- | -------------------- | ----------------------- | -------------------------- |
| staging     | `pro-pos-staging`    | `pro-pos-staging-db`    | `pro-pos-staging-media`    |
| production  | `pro-pos-production` | `pro-pos-production-db` | `pro-pos-production-media` |

Binding names giống nhau (`DB`, `MEDIA`), nhưng resource IDs và secrets phải khác.

Trước deploy phải thay placeholder D1 IDs trong `wrangler.jsonc`, đặt Worker Secrets qua
`wrangler secret put`, migrate staging, smoke, sau đó mới production.

Workers Builds:

- Production connection theo dõi `main`, non-production build tắt.
- Staging connection theo dõi `dev`, preview bật cho `feat/*`.
- Build command chạy `pnpm verify` trước deploy.
- `CLOUDFLARE_ENV` được chọn lúc Vite build, không chỉ lúc `wrangler deploy`.
