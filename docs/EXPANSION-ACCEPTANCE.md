# Commercial expansion: acceptance plan (written before implementation)

Association Operations is the first release gate. Booking starts only after its database, HTTP, browser and build checks pass. Both are independent modules in this repository, reusing session isolation, CSRF, roles, PostgreSQL and Next.js. No new public repository, mail provider or payment provider is needed.

## Association gate

- Parse bounded synthetic CSV; classify invalid/duplicate rows; review an immutable plan before applying selected valid rows. Reject stale previews. Replay must not duplicate members or events.
- Preserve member changes and status history. Create one charge per active member/period with category-specific integer-cent amounts.
- Import bank records with stable transaction IDs; reject changed data under an existing ID. Exact reference/amount matching, explicit ambiguous queue, manually resolve and safely retry; one payment and charge can be allocated only once.
- Preserve every financial revision; deny ordinary SQL update/delete of saved snapshots. A failed transaction must leave neither state nor audit receipt.
- Manager writes, observer reads, tenant isolation and CSRF are checked over HTTP, including forged inputs.
- Generate synthetic notices and welcome/reminder previews without sending email. Export CSV and discrepancies with documented fields, no DATEV compatibility claim.
- Full DE/PL flow on desktop/mobile, accessible labels, keyboard controls, automated axe checks, screenshots and manual visual inspection.

## Booking gate (after Association)

Two concurrent reservations for one resource; repeat-key command; expiry; declined payment; duplicate and out-of-order simulator events; cancellation/refund; restart persistence; foreign-owner/role denial. Use real PostgreSQL and separate sessions.

## Delivery gate

Clean setup, health check, actual backup and restore into a separate disposable database, failed migration rollback, runtime-role denial, source revision/hash, build and exact test results. Document update/rollback, handover, support boundaries and production gaps. No SLA/security certification claim.

## Audit baseline, 2026-10-25

All eight requested repositories were fetched from GitHub into isolated checkouts. The original portfolio workspace has extensive pre-existing changes and is preserved. Profile PR #11 is an open draft on `sales-cash30-20261025`; keep its focused-paid-task introduction intact. Operations Desk has no open PR; existing remote feature branches are retained. FastAPI has three open dependency PRs, outside this change.

Reusable foundations: Operations Desk sessions, server roles, transaction receipts and PostgreSQL runner; CRM's preview/selection pattern; reconciliation's explicit ambiguity; PostgreSQL rehearsal's stale-plan rejection; webhook project's durable replay principles. No bulk copying from third-party extensions. The LLM evaluation gate remains separate, as these workflows do not need inference. Portfolio is React/Vite with a native Worker distribution; inspect and test that checkout before integration. Existing README verification is historical evidence, not tests executed in this task.
