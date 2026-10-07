# Verified release — 2026-10-07

[Try Operations Desk](https://operations-desk-reliability.vanya-matyushkin.workers.dev/) · [Inspect the evidence](https://operations-desk-reliability.vanya-matyushkin.workers.dev/proof/) · [Successful CI run](https://github.com/Hadezu/operations-desk-reliability/actions/runs/37680782120)

The application is published on Cloudflare Workers Free with Neon Free PostgreSQL. Local API, frontend, PostgreSQL and Redis processes were stopped before the final HTTPS approval smoke check, which passed. The deployed app has no dependency on the development computer. No paid plan, paid runner or hosted Redis subscription was enabled.

## What was executed

- 40 API/database tests across the Prisma and edge SQL adapters, using real PostgreSQL and the restricted application role.
- Five recovery scenarios against real PostgreSQL and Redis: outbox publication, worker termination, crash after commit, bounded retry and controlled replay, and lost queue-record reconciliation.
- Desktop and mobile browser approval journeys, including the actual BullMQ report in the separate Docker Compose job.
- Strict TypeScript checks, Next.js build, Cloudflare bundle and local workerd/PostgreSQL approval flow.
- Hosted database privilege checks and public HTTPS tests for sessions, CSRF, idempotency, draft edit/delete, approval, role and tenant denials, audit and logout.

The CI artifact contains 53 passed checks and one public-deployment placeholder. The website merges the separately collected deployment artifact, producing 54 passed evidence entries. These counts are evidence entries, not 54 independent test cases. Both artifacts are checked into `evidence/`; the website includes them only when their source hash matches the build.

## Provenance

| Item | Value |
|---|---|
| Tested source commit | `da9530acd18a2eeb2cdca7ae4a9aec255a6f0ef4` |
| Source SHA-256 | `8a9042974fb361798fc2d2121da17a1e79b5ad5f744fc6b780353d150913d6c6` |
| Successful Actions run | `37680782120` |
| Downloaded release-proof artifact | `11507614820` |
| CPU-sampled Worker version | `554a14ab-6e7a-4b82-a3f9-e30916723a5e` |
| Final Worker version after evidence asset publication | `bdec42fc-fb2a-4bb5-84b4-ec6e4a51a513` |

The final publication added the completed evidence assets without changing application behavior. Its HTTPS smoke check passed after publication. The CPU sample belongs to the explicitly identified earlier runtime version: 81 API invocations, all successful, p50 3 ms, p95 5 ms, maximum 7 ms. It is a small synthetic sample, not a load test or uptime guarantee. Documentation and evidence commits do not change the source fingerprint or rerun the workflow; source changes do.

## Scope that a client can verify

The live site demonstrates the approval workflow, server-side sessions, roles, tenant boundaries, persisted data and audit. Node/Fastify, Prisma, Redis/BullMQ, worker recovery and container delivery are reproducible in Docker and supported by the linked CI artifacts. The public Worker does not run a Redis worker. Next.js uses a static export; SSR, production OIDC and PostgreSQL RLS are not claimed.

The provider accounts were confirmed Free at deployment time. Quotas, cold starts and provider outages still apply; this release does not promise uninterrupted availability. See [deployment configuration and limits](DEPLOYMENT.md).

This original application is complete for the accepted application scope. The independently scoped contribution to an existing Next.js OSS project remains a separate follow-up and is not claimed as delivered here.
