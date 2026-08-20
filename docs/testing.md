# Test strategy

- Unit: Pricing Engine, state machines, crypto/cookie helpers.
- Worker integration: migrations, auth/device cookies, tenant/RBAC và POS command triggers.
- E2E: store → owner/device → employee → table/order → checkout → invoice.
- Release smoke: health/version, environment bindings và critical mutations.
- Failure: wrong/replayed grant, revoked device, cross-store employee, version conflicts,
  double checkout, R2/migration failure và lost response after commit.

`pnpm verify` là gate bắt buộc cho PR. Playwright visual/E2E được hoàn thiện khi có UI references.
