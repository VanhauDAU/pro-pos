# Changelog

## [Unreleased]

### Added

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
