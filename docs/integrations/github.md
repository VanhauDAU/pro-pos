# GitHub integration

- Repo public: `VanhauDAU/pro-pos`.
- `main` production, `dev` staging, `feat/*` pull request.
- Ruleset cho `main/dev`: require PR, status check `quality`, resolved conversations; block
  force-push/delete/direct push.
- Không commit secrets, `.docx_review`, database export hoặc dữ liệu pilot.
- CI workflow chạy format, lint, typecheck, Wrangler types, unit/integration và build.

GitHub CLI hiện phải được đăng nhập lại trước khi tự động áp branch rules/push qua API.
