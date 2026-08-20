# Mục lục tài liệu

- [Scope MVP](product/scope.md)
- [Kế hoạch tổng thể, trạng thái và checklist](project/status-roadmap.md)
- [Quy trình phát triển, staging và production](project/development-release-workflow.md)
- [Kế hoạch Owner Operations Portal](product/owner-portal-plan.md)
- [Đặc tả Pricing Engine](product/pricing.md)
- [Kiến trúc hệ thống](architecture/system.md)
- [OpenAPI](api/openapi.yaml)
- [D1 migrations](database/migrations.md)
- [Auth và device invariants](security/auth-device-invariants.md)
- [GitHub](integrations/github.md)
- [Cloudflare](integrations/cloudflare.md)
- [UI screen registry](ui-screen-registry.md)
- [Test strategy](testing.md)
- Runbooks: [deploy](runbooks/deploy.md), [rollback](runbooks/rollback.md),
  [backup/restore](runbooks/backup-restore.md), [incident](runbooks/incident.md),
  [secret rotation](runbooks/secret-rotation.md)
- ADR: [single Worker ban đầu](adr/0001-single-worker-d1-r2.md),
  [activation flow](adr/0002-owner-driven-device-activation.md),
  [Workers PBKDF2](adr/0003-workers-pbkdf2-node-crypto.md),
  [portable PBKDF2](adr/0004-portable-pbkdf2-and-paid-cpu.md),
  [Access OTP trên Workers Free](adr/0005-cloudflare-access-otp-free.md)
