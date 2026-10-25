# Commercial expansion — executed verification

**Hosted follow-up:** the new modules now run in a separate public test environment. See [staging verification](STAGING-VERIFICATION.md) for its exact version, executed checks and CPU limitations. Earlier local-only results below remain historical evidence.

Recorded 2026-10-25. These are synthetic-data engineering demonstrations, not client deployments, independent security audits, WCAG certification, DATEV certification or an SLA.

## Exact revisions and evidence

- Application implementation: `9449d24c3b840761586d6d592e1a8288a93869cc`.
- Verified CI source, including the corrected release evidence gate: `e416bfb994c0afe1d130d89f1da427a6e7dcd752`.
- Normalized source SHA-256 from `scripts/source.ts`: `527ea2064292d310528a2a36a8dd358826d161f9688dd798964ad8152d004385`.
- [Successful branch CI run](https://github.com/Hadezu/operations-desk-reliability/actions/runs/40233824441): integration, containers and release-evidence all passed. The `release-proof` artifact contains the exact CI manifest; raw checks are in `verification-evidence` and `container-evidence` (GitHub artifact retention applies).
- [Application PR #3](https://github.com/Hadezu/operations-desk-reliability/pull/3), [portfolio PR #5](https://github.com/Hadezu/work-portfolio/pull/5), [profile PR #12](https://github.com/Hadezu/Hadezu/pull/12). No PR was merged.

Documentation-only commits after the source revision do not change the executable implementation. The first CI run passed integration and containers but failed evidence assembly because its historical gate expected 2 browser tests instead of the new 10. The gate was corrected and all jobs rerun; no test failures were suppressed.

## What actually ran

| Check | Observed result | Scope |
|---|---|---|
| `npm ci`, migrations and role provisioning | Passed on a clean Ubuntu CI runner; fresh Windows PostgreSQL setup also applied all 10 migrations | Real PostgreSQL 18, separate runtime and migration roles |
| `npm test` | 59 passed: 40 existing API, 11 association, 8 booking | Real DB; concurrency, idempotency, rollback, stale previews including change-back, roles, tenant separation, immutable revisions and retention |
| `npm run verify` type checks and production build | Passed | Node/web TypeScript, edge types, Next.js static build |
| Browser journeys | 10 passed in integration (23.7 seconds), also passed in the container job | Existing approval desktop/mobile plus DE/PL association and booking at desktop/mobile widths |
| Accessibility | Embedded axe checks passed for the tested association/booking pages | Automated scan of tested states only; no complete WCAG or assistive-technology certification |
| API interruption | Passed | Child API forcibly stopped, restarted; same session and command receipt, one booking and one simulator event |
| Existing worker recovery | Passed in full CI with Redis | Existing outbox publication/retry/replay/recovery assertions retained |
| Backup/restore and failed migration | Passed locally and in CI | Exact application-table comparison in a separate database; deliberately failing transactional DDL rolled back; health check passed |
| Worker bundle and local workerd | Passed | Original approval plus new association and booking paths against PostgreSQL; no hosted CPU/capacity claim |
| Docker Compose | Passed on GitHub Ubuntu runner | Built images, fresh DB bootstrap, browser journeys and real report worker |
| Dependency audit | 0 reported vulnerabilities after dependency updates | npm advisory scan at execution time, not proof of absence of vulnerabilities |
| Source review | Changed paths checked for private keys/tokens and accidental private material | Synthetic fixture data only; private TradeBot not accessed |

The fresh Windows checkout remained at implementation SHA `9449d24...`: 59 tests passed, followed by actual API restart and restore. Its restore compared 30 workspaces, 60 organizations, 180 members, 28 sessions, 142 requests, 36 audit events, 32 commands, 4 outbox events, 44 association revisions and 25 booking revisions; reports and job attempts were empty. The sanitized result is in [evidence/local-recovery.json](evidence/local-recovery.json). Backup rows and session secrets are deliberately not committed.

Portfolio implementation SHA `0af617e15dbce5ae6a9dbe0ed10db0f69e411507`: 677 tests, production build and 11 browser tests passed locally, including EN/PL navigation at 390/1280 pixels; npm audit reported zero vulnerabilities. Profile navigation SHA `0136a8a0d8153dff87c3bb596e7c94cefb9230da`: documentation-only additions, reviewed separately from existing profile PR #11.

## Audited repositories and scope decisions

| Repository | Audited main SHA | Decision |
|---|---|---|
| Hadezu | `3f970c6bb514e8141ff2ba3f5359e5c43a48c968` | Extend navigation without replacing PR #11's introduction |
| work-portfolio | `7b911578cc0a42fa2d523ea526cc3758c9869010` | Add EN/PL evidence cards after baseline tests |
| operations-desk-reliability | `752d66e2d88762d096c429b78312b03e0d81d746` | Reuse auth, roles, PostgreSQL and UI shell for both independent modules |
| atomic-crm-import-review | `ad22db1190d227f56fd48d017c39232c301e752b` | Reuse review-before-write concept; no changes |
| reconciliation-evidence-workbench | `e5df17bbd68eb951378a88da883760b56070d05b` | Reuse explicit discrepancy/ambiguity principle; no changes |
| fastapi-webhook-reliability | `cb4465589d88c664556926550ea02a2cec092743` | Reuse durable event/replay approach; dependency PRs untouched |
| postgres-import-rehearsal | `c97a43e7a53e7d6627d3c37475864c3cbda7bab6` | Reuse stale-plan and rollback principles; no changes |
| llm-extraction-release-gate | `698c15df40f6126d5f4772dd62645fcc8c24f93a` | Kept separate: no inference needed for these workflows |

No new public repository was necessary. Work used isolated clones; the original workspace's pre-existing modifications were preserved.

## Demo and remaining delivery boundary

Follow [Delivery & Recovery](DELIVERY-RECOVERY.md) for reproducible setup. Local routes are `/association/` and `/booking/`; full walkthroughs, screenshots, contracts, architecture, DE/PL/EN descriptions and email wording are in [Association](ASSOCIATION.md) and [Booking](BOOKING.md).

New modules have **not been publicly deployed**. The existing public Operations Desk URL does not attest these changes. Hosted release requires the reviewed migrations and restricted grants on the database actually used by Hyperdrive, disabled query caching for mutable reads, and hosted smoke/CPU/connection verification. No paid operation, real bank/card connection or email delivery was performed.

Other boundaries: bounded immutable snapshots rather than a high-volume accounting ledger; simplified unquoted CSV; explicitly triggered monthly dues rather than an unattended scheduler; synthetic role switching rather than real customer identity onboarding; a payment simulator rather than a payment provider. The restore exercise uses another database in the same PostgreSQL cluster and is not off-host backup, WAL/PITR or regional disaster recovery. Document previews are demo notices, not legally validated tax invoices.

## Buyer fit and a bounded first paid stage

| Customer request | Demonstration | Proven | Not proven | Possible first paid stage |
|---|---|---|---|---|
| German Verein/Verband membership administration | Association Operations, German interface | Reviewed member import, dues, reconciliation, documents and preserved history | DATEV, bank integration, legal/accounting compliance | One member export, category rules and an agreed billing period |
| Polish association/foundation back office | Association Operations, Polish interface | One connected synthetic workflow and role-controlled operations | Production identity/privacy processes and client migration | One import and exception-resolution workflow |
| Equipment/bike/desk rental or service slots | Booking & Payment Reliability | Concurrent capacity control, expiry, duplicate/out-of-order simulator events, cancellation/refund and restart persistence | Real provider settlement, disputes or production scale | One resource type and authorized provider sandbox integration |
| Handover, update and recovery confidence | Delivery & Recovery Evidence | Clean setup, role checks, real restart and exact logical restore | SLA, 24/7 support, off-host disaster recovery | Staging environment, restore rehearsal and agreed support boundaries |

Permitted outreach: these are working, inspectable demonstrations with recorded database/browser checks, produced through AI-directed engineering and owner-led requirements/acceptance. Do not claim client deployment, production validation, certification, real payments, DATEV compatibility or manual authorship of every line.
