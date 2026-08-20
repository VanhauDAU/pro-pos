# Quy trình phát triển, staging và production

Tài liệu này là quy trình chuẩn từ lúc nhận một hạng mục đến khi phát hành Pro POS. Các runbook
chuyên sâu vẫn là nguồn hướng dẫn khi cần rollback, backup/restore, xử lý incident hoặc rotate
secret.

## 1. Luồng nhánh và môi trường

```text
feat/PRO-<id>-<slug> ──PR + squash──> dev ──deploy──> staging
                                          │
                                          └──release PR + merge commit──> main ──deploy──> production

feat/hotfix-<slug> (tạo từ main) ──PR──> main ──PR đồng bộ──> dev
```

| Nhánh                  | Mục đích                        | Merge vào | Môi trường       |
| ---------------------- | ------------------------------- | --------- | ---------------- |
| `feat/PRO-<id>-<slug>` | Feature, fix hoặc docs ngắn hạn | `dev`     | Local/preview    |
| `dev`                  | Tích hợp và nghiệm thu          | `main`    | Staging          |
| `main`                 | Mã đã được phê duyệt phát hành  | —         | Production       |
| `feat/hotfix-<slug>`   | Sửa lỗi production, tạo từ main | `main`    | Production trước |

Quy tắc bắt buộc:

- Không direct push, force-push hoặc xóa `dev`/`main`; mọi thay đổi đi qua pull request.
- Feature PR vào `dev` dùng **squash merge**. Release PR `dev → main` dùng **merge commit**.
- Một nhánh chỉ giải quyết một mục tiêu. Commit dùng Conventional Commits: `feat:`, `fix:`,
  `test:`, `docs:`, `chore:`.
- Không commit `.dev.vars`, `.env*`, file secret, database export hoặc dữ liệu cửa hàng thật.
- Migration là forward-only; không sửa/xóa migration đã chạy trên staging hoặc production.
- Release phải cung cấp `BUILD_SHA` và `BUILD_TIME` (không phải secret) để `/api/version` truy nguyên
  đúng commit/build; script deploy tự truyền hai biến qua Wrangler. Local dùng `local-dev`/`local`.

## 2. Phân biệt CI và deployment

Có hai pipeline độc lập:

1. **GitHub Actions `quality`** kiểm tra format, lint, Wrangler type generation, TypeScript, unit,
   integration và build. Pipeline này không deploy.
2. **Cloudflare Workers Builds** theo dõi nhánh đã cấu hình và deploy Worker. Theo cấu hình dự án,
   staging theo dõi `dev`, production theo dõi `main`; preview có thể bật cho `feat/*`.

Mỗi môi trường có hai Worker dùng chung D1:

| Môi trường | Main Worker          | Auth bridge Worker        | D1                      | R2                         |
| ---------- | -------------------- | ------------------------- | ----------------------- | -------------------------- |
| Staging    | `pro-pos-staging`    | `pro-pos-auth-staging`    | `pro-pos-staging-db`    | `pro-pos-staging-media`    |
| Production | `pro-pos-production` | `pro-pos-auth-production` | `pro-pos-production-db` | `pro-pos-production-media` |

Nếu Workers Builds đang bật, không chạy deploy thủ công cho cùng commit trừ khi build tự động thất
bại hoặc release cần kiểm soát thứ tự. D1 migration không nằm trong `pnpm verify` và phải được
release operator chạy riêng.

## 3. Chuẩn bị máy phát triển

Yêu cầu Node.js 24, pnpm 11 và Wrangler đã đăng nhập đúng Cloudflare account.

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm cf-typegen
pnpm cf-typegen:auth
pnpm db:migrate:local
```

Chạy main app và auth bridge ở hai terminal:

```bash
pnpm dev
```

```bash
pnpm dev:auth
```

Kiểm tra nhanh:

```bash
curl http://localhost:5173/api/health
curl http://localhost:5173/api/version
```

`/api/version` trả `environment`, `version`, `commit` và `builtAt`. Khi deploy thủ công, cập nhật
hai biến build identity trong environment trước khi smoke; không đưa token, pepper hoặc session vào
response/log.

## 4. Quy trình code một hạng mục

### Bước 1 — Tạo nhánh từ `dev`

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feat/PRO-123-ten-ngan
```

Không tạo feature branch từ `main`. Nếu nhánh tồn tại lâu và `dev` đã thay đổi, cập nhật trước khi
mở PR:

```bash
git fetch origin
git merge origin/dev
```

### Bước 2 — Code, test và cập nhật contract

Trong cùng PR, cập nhật các phần liên quan:

- Code client/Worker và regression test.
- `docs/api/openapi.yaml` nếu API contract thay đổi.
- Migration mới trong `migrations/` nếu schema thay đổi; không chỉnh migration cũ đã chạy remote.
- ADR/runbook/tài liệu nghiệp vụ nếu thay đổi kiến trúc, trust boundary hoặc vận hành.
- UI reference và screenshot nếu thay đổi giao diện.

Nếu thêm hoặc đổi binding trong `wrangler.jsonc`/`wrangler.access.jsonc`, sinh lại type trước khi
typecheck:

```bash
pnpm cf-typegen
pnpm cf-typegen:auth
```

Nếu có migration, kiểm tra local từ database phù hợp và chạy:

```bash
pnpm db:migrate:local
```

### Bước 3 — Chạy quality gate

```bash
pnpm verify
```

`pnpm verify` phải xanh trước khi push. Khi cần khoanh vùng lỗi có thể chạy riêng:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

### Bước 4 — Commit, push và mở PR vào `dev`

```bash
git add <cac-file-thuoc-pham-vi>
git commit -m "feat: mo ta ngan gon"
git push -u origin feat/PRO-123-ten-ngan
```

PR phải ghi rõ:

- Kết quả nghiệp vụ và acceptance criteria.
- Contract/schema thay đổi.
- Ảnh hưởng tenant, auth, device và RBAC.
- Migration, khả năng tương thích với version cũ và phương án rollback/forward-fix.
- Test đã chạy; tài liệu và screenshot đã cập nhật.

Chỉ merge khi status check `quality` xanh, review conversation đã giải quyết và reviewer phê
duyệt. Dùng squash merge rồi xóa feature branch.

## 5. Cập nhật staging sau khi merge `dev`

### Không có D1 migration

1. Squash merge PR vào `dev`.
2. Theo dõi GitHub Actions `quality` và Workers Builds của cả main Worker/auth bridge có thay đổi.
3. Nếu auto deploy không được cấu hình hoặc thất bại, dùng quy trình thủ công bên dưới.
4. Chạy staging smoke và ghi kết quả vào PR/release note.

### Có D1 migration

Migration phải additive để code staging hiện tại vẫn chạy được. Khi PR đã được duyệt và ngay trước
khi merge:

```bash
pnpm db:migrate:staging
```

Sau đó merge vào `dev`, theo dõi deploy và smoke. Nếu migration thất bại, không merge/deploy code
phụ thuộc schema mới; sửa migration bằng một migration forward mới.

### Deploy staging thủ công

Chỉ dùng khi không có auto deploy hoặc cần deploy có kiểm soát. Thứ tự chuẩn:

```bash
pnpm verify
pnpm db:migrate:staging
pnpm deploy:auth:staging
pnpm deploy:staging
```

Có thể bỏ bước migration nếu xác nhận không còn migration pending. Nếu auth bridge không thay đổi,
có thể bỏ deploy auth; khi có thay đổi phối hợp, deploy auth bridge trước main Worker và giữ hai
version tương thích ngược.

Staging smoke tối thiểu:

- `/api/health` và `/api/version` trả đúng environment/version.
- SUPER_ADMIN/Owner đăng nhập OTP qua auth bridge.
- Email có trong Access nhưng không có trong D1 bị từ chối.
- Employee PIN chỉ đăng nhập trên device `ACTIVE`.
- Đọc/ghi catalog; mở/hủy test order; đọc invoice.
- Kiểm tra logs theo request ID và không có secret/token trong log.

Nếu tạo Owner/SUPER_ADMIN mới, cập nhật exact-email Allow policy của Cloudflare Access trước khi
bàn giao nghiệm thu.

## 6. Release `dev` lên `main` và production

### Bước 1 — Chuẩn bị release PR

Mở PR trực tiếp `dev → main`, ví dụ tiêu đề `release: 2026-08-20`. PR phải chứa:

- Danh sách thay đổi và link các feature PR.
- Kết quả staging smoke trên đúng commit của `dev`.
- Danh sách migration pending và xác nhận backward compatibility.
- Kế hoạch deploy hai Worker, rollback/forward-fix và người thực hiện.
- Rủi ro, thời gian theo dõi sau deploy và tiêu chí dừng release.

Không merge nếu `dev` chưa xanh, staging chưa smoke hoặc production prerequisites chưa sẵn sàng.

### Bước 2 — Chuẩn bị production

Trước release có migration:

1. Ghi lại D1 Time Travel bookmark và lưu export ở nơi riêng có kiểm soát truy cập.
2. Xác nhận code production hiện tại tương thích với schema additive mới.
3. Chạy migration khi release PR đã được duyệt và sẵn sàng merge:

   ```bash
   pnpm db:migrate:production
   ```

4. Nếu migration thất bại, dừng release; không sửa migration đã chạy một phần một cách thủ công nếu
   chưa đánh giá trạng thái database.

Xác nhận thêm R2 bucket, Worker bindings, secrets và Cloudflare Access policy đều thuộc đúng
production. Không dùng secrets hoặc exact-email allowlist của staging.

### Bước 3 — Merge và deploy production

Merge release PR bằng **merge commit**. Push vào `main` sẽ kích hoạt Workers Builds production khi
connection đang bật. Theo dõi cả:

- `pro-pos-auth-production` nếu auth bridge thay đổi.
- `pro-pos-production` cho SPA/API chính.

Nếu auto deploy không được cấu hình hoặc release cần kiểm soát thứ tự, chạy thủ công từ commit
`main` đã pull về:

```bash
git switch main
git pull --ff-only origin main
pnpm verify
pnpm deploy:auth:production
pnpm deploy:production
```

Không chạy lại `pnpm db:migrate:production` nếu migration đã được áp dụng ở bước chuẩn bị. Khi chỉ
main Worker thay đổi, có thể bỏ deploy auth bridge.

### Bước 4 — Production smoke và đóng release

Smoke ngay sau deploy:

- Health/version và app shell.
- SUPER_ADMIN/Owner OTP qua đúng production auth bridge.
- Employee PIN/device context.
- Critical read/mutation: catalog, order, checkout/invoice theo dữ liệu test được phê duyệt.
- D1/R2 binding, Access authentication logs và Workers logs.

Nếu smoke đạt, tạo tag/GitHub Release theo version đã thống nhất và ghi lại commit, migration,
deployment/version ID cùng người xác nhận. Nếu smoke không đạt, thực hiện mục rollback bên dưới.

## 7. Hotfix production

Hotfix luôn tạo từ `main`, không từ `dev`:

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/hotfix-ten-ngan
```

Chạy `pnpm verify`, mở PR vào `main`, review và phát hành theo checklist production. Sau khi
production ổn định, mở PR `main → dev` để đồng bộ hotfix; không để hai nhánh phân kỳ.

## 8. Rollback và dừng release

Dừng release khi quality gate đỏ, migration lỗi, binding/secret sai, smoke critical fail hoặc log
cho thấy lỗi auth/cross-tenant/data integrity.

- Nếu chỉ code/assets sai và schema vẫn tương thích: rollback đúng Worker về version trước bằng
  Cloudflare Dashboard hoặc Wrangler.
- Nếu auth bridge và main Worker cùng thay đổi: đánh giá và rollback theo thứ tự tương thích, không
  mặc định chỉ rollback một Worker.
- Worker rollback không hoàn tác D1/R2. Với schema additive, ưu tiên forward-fix.
- D1 Time Travel restore ghi đè dữ liệu mới và chỉ được thực hiện sau phê duyệt, đánh giá RPO và
  đối soát giao dịch.
- Khi có nguy cơ sai dữ liệu tài chính, khóa mutation nhạy cảm, lưu request/audit ID và theo
  [incident runbook](../runbooks/incident.md).

Chi tiết: [deploy runbook](../runbooks/deploy.md),
[rollback runbook](../runbooks/rollback.md),
[backup/restore](../runbooks/backup-restore.md),
[D1 migration policy](../database/migrations.md),
[Cloudflare integration](../integrations/cloudflare.md) và
[GitHub integration](../integrations/github.md).

## 9. Checklist nhanh

### Feature → staging

- [ ] Nhánh tạo từ `dev`, đúng một phạm vi.
- [ ] Test/docs/OpenAPI/migration cập nhật.
- [ ] `pnpm verify` xanh local và CI `quality` xanh.
- [ ] PR squash merge vào `dev`.
- [ ] Migration staging đã chạy nếu có.
- [ ] Workers staging deploy thành công.
- [ ] Staging smoke đạt.

### Staging → production

- [ ] Release PR `dev → main` được duyệt và CI xanh.
- [ ] Đúng commit đã được smoke trên staging.
- [ ] D1 bookmark/export đã lưu nếu có migration.
- [ ] Production migration đã chạy và xác nhận thành công nếu có.
- [ ] Merge commit vào `main`; cả Worker cần thiết deploy thành công.
- [ ] Production smoke đạt; logs không có lỗi nghiêm trọng.
- [ ] Tag/GitHub Release và deployment record đã tạo.
