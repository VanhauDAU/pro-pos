# Test strategy

- Unit: Pricing Engine, state machines, crypto/cookie helpers.
- Worker integration: migrations, auth bridge code exchange/replay, purpose-aware callback,
  auth/device cookies, tenant/RBAC và POS command triggers.
- Migration upgrade script: applies 0001–0005 with legacy accounting rows, then 0006–0007, and verifies
  gross/discount/net backfill invariants.
- E2E: store → owner/device → employee → table/order → checkout → invoice.
- Release smoke: health/version, environment bindings và critical mutations.
- Failure: wrong/replayed grant, revoked device, cross-store employee, version conflicts,
  double checkout, R2/migration failure và lost response after commit.

`pnpm verify` là gate bắt buộc cho PR. Gate hiện tại gồm format, lint, type generation cho main/auth
bridge, typecheck, unit, Worker integration, migration upgrade check và production build. Playwright visual/E2E được hoàn
thiện khi có UI references.
