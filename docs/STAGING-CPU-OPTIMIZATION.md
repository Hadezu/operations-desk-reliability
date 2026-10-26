# Staging CPU optimization — 26 October 2026

[Association demo](https://operations-workflows-staging.vanya-matyushkin.workers.dev/association/) · [Booking demo](https://operations-workflows-staging.vanya-matyushkin.workers.dev/booking/) · [Sanitized measurements](evidence/staging-cpu-20261026.json)

The hosted verification sample now meets the 10 ms CPU target for every observed invocation. This is a measured bounded demonstration, not a guarantee for every future request or sustained production load.

## Measured release

- Worker: `operations-workflows-staging` only.
- Version: `d4ca54cc-879a-40fc-b7b2-e3e2912fa3c3`.
- Implementation commit: `517e8958c7daeee7780529004b6fd6875e632b16`.
- No migrations, grants changes, paid plan changes or raised quotas.
- Original `operations-desk-reliability` still reports version `1697a7f1-83d0-40ea-8059-7067f9f7b171`, health 200 and `Cache-Control: no-store`. It was not redeployed and its database was not changed.

| Cloudflare CPU measurement | Previous hosted sample | Optimized hosted sample |
|---|---:|---:|
| Observed API invocations | 142 | 151 |
| p50 | 4 ms | 2 ms |
| p95 | 14 ms | 4 ms |
| Maximum | 27 ms | 7 ms |
| Invocations above 10 ms | Present | 0 |
| Invocation errors | 0 | 0 |

Optimized GET p95/max: 3/4 ms. POST p95/max: 5/7 ms. These are Cloudflare CPU times, not network latency. Tail observations are a sample, not an assertion that every HTTP request was captured. Measurements are filtered to the exact deployed version; earlier trial versions are excluded from the acceptance sample.

## Change and integrity

Each module already stores its complete state and idempotency receipt together in one immutable revision row. The new implementation reads the latest state and matching receipt in one consistent SQL statement, computes the next state, then atomically inserts the next revision over the existing Neon HTTPS transport.

The existing `(organization_id, revision)` primary key allows exactly one writer to append a given next revision. `ON CONFLICT DO NOTHING` returns zero affected rows to a loser; it must reread and recompute, including authorization-specific domain rules, resource capacity and import-plan checks. At most three attempts are allowed. Exhaustion returns HTTP 409 `VERSION_CONFLICT`; retrying with the same idempotency key is safe. A receipt and its state cannot partially commit because they are the same row. The existing command-key uniqueness, foreign keys and immutable-history restrictions remain in force.

Receipt and state must be read in the same statement: separate reads could observe a missing receipt followed by an already-applied state and incorrectly reject a concurrent replay. Database time is captured in that same snapshot and refreshed on each retry. No cached or stale state is reused after a conflict. Invalid reductions append nothing.

This avoids the per-request TCP connection/protocol work and several interactive transaction round trips. Valid-member and discriminated-union validators are also initialized during Worker startup. Request/session state and live connections are never stored globally. A pg/WebCrypto-only trial reduced normal writes but still reached 15 ms on initial imports; it was not accepted and is not in the final implementation.

## Verification performed

- 63 real PostgreSQL tests passed, including four new forced-concurrency tests on independent adapters/connections: no lost updates, one receipt for a same-key race, no partial state on validation failure, bounded retry exhaustion.
- Typecheck and local workerd smoke with real PostgreSQL passed.
- All 10 hosted browser journeys passed: Association and Booking in DE/PL on desktop/mobile, and approvals on desktop/mobile. No failed, flaky or skipped scenarios; axe/overflow checks included.
- Hosted API smoke passed secure cookies, CSRF, employee/observer restrictions, cross-tenant rejection, idempotent replay, conflicting payload rejection and session revocation.
- Additional staging-only test passed competing holds, concurrent same-key bookings/imports, 50-row CSV import, 50 charges/payments reconciled, document generation, 20 retained 50-row import plans and rejection of a 21st plan. Every tested API response used `no-store` and identified the verified version.
- Runtime role still cannot UPDATE, DELETE or TRUNCATE either revision table. Connection snapshot: 14 idle application sessions, one active verifier, zero idle-in-transaction sessions. This includes the Neon HTTPS pool; it is not the Hyperdrive soft limit.

Normal public limits remained in force: four starts/minute, 90 API requests/minute, daily workspace limit 60. Browser batches were separated by 65 seconds. Synthetic data only; no real payments or emails.

## Reproduce safely

Deploy only with `npx wrangler deploy --config wrangler.staging.jsonc`. Never use the default configuration to deploy this optimization to the original Operations Desk. The migration and database schema are unchanged.

Set `E2E_BASE_URL` to the staging origin and run the existing browser file/project batches with at least 65 seconds between batches. Set `PUBLIC_DEMO_ORIGIN` to the same origin for `npx tsx tests/public-smoke.ts` and `npx tsx tests/staging-cpu-smoke.ts`. The latter refuses any other host. Leave enough quota between runs and do not raise deployed limits to make tests pass.

Capture `npx wrangler tail operations-workflows-staging --format json` in an ignored local file; filter events by `scriptVersion.id` and API path, then summarize `cpuTime` (p95 is nearest rank). Require finite measurements, zero invocation errors and maximum <=10 ms, not merely a passing average/p95. Never publish raw tail captures, cookies or database credentials. See the sanitized JSON for per-route distributions and exact checks.

The prior [25 October report](STAGING-VERIFICATION.md) remains historical evidence for the slower version. Future platform variability, different data or sustained load require fresh measurements; successful bounded testing is not production capacity acceptance.
