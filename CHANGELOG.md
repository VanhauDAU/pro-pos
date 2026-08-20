# Changelog

## [Unreleased]

### Added

- PRO-010A hardening: cross-store device revoke protection, conditional discount authorization,
  gross/discount/net accounting snapshots, prompt-price sales, atomic invoice numbering, tenant
  reference validation, Owner-safe staff status, atomic pause/resume commands, audit context and
  controlled PWA update prompt. Local quality gate passes with 18 unit tests, 26 Worker integration
  tests and a 0005 → 0006 migration-upgrade check; staging smoke remains a release gate.

- React/Web Worker/PWA foundation.
- D1 tenant, authentication, device, catalog, pricing, POS and billing schema.
- Owner direct login and dedicated POS activation grant flow.
- Server-authoritative pricing and idempotent POS commands.
- Unit/integration test foundations and CI workflow.
- Responsive Pro POS authentication UI using the approved layout and `#0D7CFF` brand color.
- Owner Cloudflare Access email OTP, Employee username/PIN login, and two-step POS activation UI.
- Dedicated Cloudflare Access auth bridge Workers for staging and production so the main SPA/API
  remains available to Employee PIN and public health flows.
- One-time authorization-code exchange between the Access-protected bridge and main Worker,
  including replay protection and purpose-aware failure redirects.
- Separate local/type-generation/deploy commands and D1 migration for auth bridge authorization
  metadata.
