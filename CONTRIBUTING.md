# Hướng dẫn đóng góp

## Git flow

1. Cập nhật `dev` và tạo `feat/PRO-123-ten-ngan`.
2. Một nhánh chỉ giải quyết một mục tiêu.
3. Mở PR vào `dev`, dùng squash merge và xóa nhánh sau merge.
4. Release bằng PR `dev → main`; merge commit là phê duyệt production.
5. Hotfix tạo từ `main` với tên `feat/hotfix-<slug>`, sau đó merge ngược `main → dev`.

Không direct push, force push hoặc xóa `main`/`dev`.

Quy trình đầy đủ từ code, PR, staging đến production và hotfix xem tại
[docs/project/development-release-workflow.md](docs/project/development-release-workflow.md).

## Commit và PR

Dùng Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.

PR phải nêu:

- Kết quả nghiệp vụ.
- Contract/schema thay đổi.
- Tenant/auth/device impact.
- Migration và rollback behavior.
- Test đã chạy.
- Docs cập nhật hoặc lý do `N/A`.
- UI reference và screenshot nếu thay đổi giao diện.

## Definition of Done

- Acceptance criteria đạt.
- `pnpm verify` xanh.
- Có regression test.
- Migration chạy từ database sạch; không sửa migration đã chạy remote.
- API/schema/docs/ADR cập nhật trong cùng PR.
- Không log password, PIN, cookie hoặc token.
- UI có reference và phê duyệt trước khi merge.
