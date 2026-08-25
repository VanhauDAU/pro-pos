# Authenticated POS E2E

`pnpm test:e2e` creates an isolated browser device, signs in a dedicated POS employee, verifies
`/pos/areas` is connected, and writes the resulting state to `playwright/.auth/pos.json` for the
rest of the run. The state is ignored by Git and is never uploaded by CI.

Required variables:

- `E2E_BASE_URL` — staging URL (optional locally when a preview server is running)
- `E2E_OWNER_USERNAME`, `E2E_OWNER_PASSWORD` — owner credential used only to activate the temporary browser device (`E2E_USERNAME`, `E2E_PASSWORD` are accepted aliases)
- `E2E_POS_USERNAME`, `E2E_POS_PIN` — dedicated employee credential with POS permissions; PIN is four digits

Optional `E2E_DEVICE_NAME` labels the test device. Use a dedicated staging store/account: E2E creates,
cancels, and checks out test orders. It does not accept a storage-state path or any secret cookie.

The suite covers the browser reconnect transport only indirectly through connected-state assertions. Multi-tab
leader-election behaviour is not yet automated because browser offline mode does not faithfully model the
production WebSocket leader; this is intentionally reported as a limitation, not a passing test.
