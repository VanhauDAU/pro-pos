# Changelog

## [Unreleased]

### Added

- PRO-016 table pricing assignment: each available table/room can select an active time product
  and its pricing; occupied tables are locked against pricing changes and POS snapshots the
  selected pricing when opening a session.

- PRO-015 product pricing completion: configurable special hours by time range or all-day weekday
  rules, overlap validation through the server pricing engine, and product avatar image upload with
  private media preview. The product list now also supports restoring a disabled product, and the
  product form can create and select a new category directly from the category dropdown.

- PRO-014 unit settings: server-paginated unit list with search, add/edit flow, product usage
  count, product usage detail list and safe delete protection. Material and unit-conversion counts
  from the reference are intentionally omitted from this MVP.

- PRO-013 catalog MVP: responsive Owner danh sách mặt hàng, tìm kiếm/lọc, form thêm/sửa mặt hàng
  số lượng/trọng lượng/thời gian, phiên bản giá, avatar màu, CRUD danh mục và xem mặt hàng theo
  danh mục. Import/export, thuế, kho, kênh bán hàng và upload ảnh được deferred.

- PRO-010 Owner shell: Owner auth guard, responsive sidebar accordion, dashboard overview frame,
  direct settings hub, two-column store information form with province/ward location lookup,
  store identity, logout and mobile navigation using the `#0975F7` system color.

- PRO-010A hardening: cross-store device revoke protection, conditional discount authorization,
  gross/discount/net accounting snapshots, prompt-price sales, atomic invoice numbering, tenant
  reference validation, Owner-safe staff status, atomic pause/resume commands, audit context and
  controlled PWA update prompt. Local quality gate passes with 18 unit tests, 26 Worker integration
  tests and a 0005 → 0009 migration-upgrade check; staging smoke remains a release gate.

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
