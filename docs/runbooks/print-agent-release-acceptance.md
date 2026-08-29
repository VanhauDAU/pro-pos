# Print Agent Windows release acceptance

## Automated evidence — 2026-08-29

- Print Agent typecheck passed.
- Root TypeScript project build passed.
- Print Agent unit tests passed, including runtime lifecycle, queue deduplication,
  TCP failure boundary, credential encryption, and autostart behaviour.
- Remote print lifecycle integration test passed (9 tests).
- Electron main, preload, and local renderer bundle passed.

## Required Windows/device acceptance before release

The following are release gates, not assertions satisfied by automated tests:

| ID | Scenario | Expected result |
| --- | --- | --- |
| T01 | Clean Windows 10/11 install | Installer opens the first-run pairing wizard without Node or QZ Tray. |
| T02–T04 | Pairing and test print | DPAPI credential persists; correct K58/K80 output and cut/drawer behaviour. |
| T05–T11 | Printer/network fault and crash tests | No false `COMPLETED`; mid-write faults remain `UNCERTAIN`; no duplicate receipt. |
| T12–T14 | Close window, second launch, Windows restart | Tray remains active, only one runtime, hidden autostart can accept a job. |
| T15 | Upgrade over existing install | Pairing/configuration survive update. |
| T16 | 8–12 hour burn-in | No linear memory/timer/socket/log growth across 30–50 jobs. |

## Release decision

Do not publish a release tag until every P0 scenario above is recorded against
the exact installer version and no P0 defect remains. The Windows GitHub
Actions workflow produces the NSIS installer, portable executable, and
`SHA256SUMS.txt` for a `print-agent-v*` tag.
