# Verified release — 2026-10-07

[Try Operations Desk](https://operations-desk-reliability.vanya-matyushkin.workers.dev/) · [Inspect the evidence](https://operations-desk-reliability.vanya-matyushkin.workers.dev/proof/) · [Successful CI run](https://github.com/Hadezu/operations-desk-reliability/actions/runs/37683837483)

The four changes requested after a client-style review are published:

1. The first screen explains the project, names the author and technologies, and links directly to GitHub. It distinguishes the live approval flow from the complete Node/worker environment.
2. Activity displays the actor's name and role beside each action; the decision also names its reviewer. Automated worker events have a separate system label. These demo members have fixed names and roles; no claim of historical identity snapshots is made.
3. Six expandable evidence cards replace the wide table. The overview shows CI status, verification date and evidence counts. Expected/observed results, source links, JSON and provenance remain available. Failed or missing evidence cannot render as passed.
4. A saved approval clearly completes the online demo. Background reports, retries and recovery are identified as the separate Docker/CI demonstration, with a direct link to that evidence.

## Verification performed

- 40 API/database tests across Prisma and the edge SQL adapter, using real PostgreSQL and the restricted application role.
- Five recovery scenarios against PostgreSQL and Redis: outbox publication, process termination, crash after commit, bounded retry with controlled replay, and lost queue-record reconciliation.
- Desktop and mobile browser approval journeys in both CI jobs, including a real BullMQ report in Docker. New assertions verify named employee/manager audit events, automated worker attribution, demo completion, GitHub links and responsive evidence disclosures.
- Strict TypeScript, Next.js build, Cloudflare bundle and local workerd/PostgreSQL approval checks.
- Repeated public HTTPS API checks and desktop/mobile browser journeys after publication. Hosted database privilege checks passed. Manual verification covered the new landing screen, create/submit/approve, named audit, observer restrictions, reload persistence, organization switching and expanded evidence at a 390 px viewport. The landing screen and evidence layout were also checked at 320 px in the local build.

The public page contains 54 passed evidence entries. CI supplies 53 and the separately collected public-deployment observation supplies one. These are evidence entries, not 54 independent test cases. The build embeds them only when their source fingerprints match.

## Provenance

| Item | Value |
|---|---|
| Tested source commit | `3bc346229ec8aed3084835875cb537e60939d188` |
| Source SHA-256 | `510a939469af03e46e721bac77a09da98e13e292901f47d2c396519edb02cf4b` |
| Successful Actions run | [37683837483](https://github.com/Hadezu/operations-desk-reliability/actions/runs/37683837483) |
| Downloaded release-proof artifact | `11509549146` |
| CPU-sampled Worker version | `c6c42127-ffe5-4938-b744-31da1723e0f2` |
| Final version after evidence asset publication | `1697a7f1-83d0-40ea-8059-7067f9f7b171` |

The final asset publication added the completed deployment evidence without changing application behavior. Manual approval and persistence checks passed on that final version. The CPU sample explicitly belongs to the earlier version above: 39 API invocations, all successful, p50 3 ms, p95 7 ms, maximum 8 ms. This small synthetic sample does not establish a load capacity or uptime guarantee.

## Hosting and scope

The existing Cloudflare Workers Free and Neon Free resources remain in use. No new resource, paid plan or subscription was added. Local preview servers were stopped before the public checks; the app operates independently of the development computer. Quotas and provider outages still apply.

The live app demonstrates approvals, sessions, roles, tenant boundaries and persisted audit. Node/Fastify, Prisma, Redis/BullMQ and worker recovery are reproducible in Docker and backed by CI. The public Worker does not run a Redis worker. Next.js uses a static export; SSR, production OIDC and PostgreSQL RLS are outside this proof. See [deployment configuration](DEPLOYMENT.md).

The independently scoped contribution to an existing Next.js OSS project remains a separate follow-up.
