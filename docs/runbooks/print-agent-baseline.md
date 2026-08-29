# Print Agent baseline checklist

This checklist locks the existing remote-print behaviour before the Print Agent
runtime and desktop refactors. It is deliberately kept separate from the
Windows acceptance checklist: it can be run from the current CLI agent.

## Automated baseline (2026-08-29)

- `pnpm --filter @propos/print-agent typecheck` — passed.
- `pnpm exec vitest run tests/unit/print-agent.test.ts` — 11 tests passed.
- `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/remote-print-lifecycle.test.ts` — 9 tests passed.

## Required device validation

Run this checklist against the intended staging or production store before a
Windows release. Record the printer model, IP address, agent version, time,
latency, and actual result for every case.

1. Pair the CLI agent and send a payment receipt, provisional receipt, and debt-payment receipt.
2. Verify the LAN TCP endpoint (`:9100`), Vietnamese text, paper width, cut, and cash drawer behaviour where enabled.
3. Send 2, 5, then 10 jobs in order; verify each receipt is complete, FIFO, and printed once.
4. Repeat with the printer powered off, an invalid IP/port, Internet unavailable, and an agent restart.
5. Preserve the observed error code and whether bytes could have been written. A job with an ambiguous printer outcome must not be retried automatically.

## Acceptance boundary

Automated tests validate protocol, job lifecycle, queueing, and regression
behaviour. They do not prove a physical printer accepted or printed bytes; the
device checklist above remains a release prerequisite.
