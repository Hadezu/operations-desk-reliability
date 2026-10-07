# Free deployment and release evidence

Public app: https://operations-desk-reliability.vanya-matyushkin.workers.dev  
Repository: https://github.com/Hadezu/operations-desk-reliability

## Resources checked on 2026-10-07

| Resource | Plan and configuration | Reference |
|---|---|---|
| Cloudflare Workers | Account UI confirmed **Free, $0**; 100,000 dynamic requests/day, 10 ms CPU/invocation; static assets free | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Hyperdrive | Free allowance of 100,000 queries/day; query cache disabled; origin pool capped at five connections | [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/) |
| Neon PostgreSQL 18 | Account UI confirmed **Free, $0**; displayed 100 CU-hours/month and 1 GB storage; Frankfurt; fixed 0.25 CU, scale-to-zero after five minutes | [Neon pricing](https://neon.com/pricing) |
| GitHub | Public source and Actions verification; no paid runner or add-on provisioned | [Repository](https://github.com/Hadezu/operations-desk-reliability) |

Provider allowances may change. These observations describe the account at release time, not a promise about future pricing. No paid plan, domain purchase, billable Redis host or monitoring subscription was enabled. Neon wakes automatically for a database request, so the first request after idle may be slower. The application does not rely on a local process.

Prisma Postgres was initially tried on Free. Its hosted migration credential rejected `CREATE ROLE desk_app` with PostgreSQL `42501: restricted superuser cannot create roles`. It is not used by this deployment. Neon passed actual runtime-role and privilege-denial checks; Prisma remains the Node ORM and schema/migration tool.

## Reproduce a deployment

1. Confirm the actual provider accounts are on Free. A paid plan with an allowance is not equivalent.
2. Create PostgreSQL and save separate migration-owner and application connection URLs in an ignored environment file. Never commit them or paste them into command history.
3. Run `npm run db:bootstrap`, then `npm run db:verify-access`. The second command connects as the runtime user and actually attempts denied audit UPDATE/DELETE/TRUNCATE, expiry manipulation and migration-metadata access. It also rejects superuser flags, role memberships and table ownership.
4. Create Hyperdrive with the **application** credential. Disable query caching: sessions, role changes, CSRF rotation, revocation and optimistic version checks require fresh reads. Limit origin connections to five. See [query caching](https://developers.cloudflare.com/hyperdrive/configuration/query-caching/).
5. Set your own Worker name, Hyperdrive ID and HTTPS origin in `wrangler.jsonc`. The committed IDs identify the published demo; they grant no credentials and must be replaced for another account.
6. Run `npm run verify`, `npm run cf:check` and `npx wrangler check startup`. Deploy with `npx wrangler deploy` only after the provider checks. Ordinary verification does not deploy.
7. Set `PUBLIC_DEMO_ORIGIN` to the HTTPS URL and run `node --import tsx tests/public-smoke.ts`. Set `E2E_BASE_URL` to the same URL and run `npm run test:e2e`.
8. Capture `npx wrangler tail WORKER_NAME --format json` to an ignored file while testing. Run `node --import tsx scripts/record-deployment.ts PATH_TO_CAPTURE`. It requires both browser journeys, hosted database permissions, at least 30 captured invocations from the smoke-tested version, no invocation errors and CPU p95 at most 10 ms. It publishes only aggregates; raw tail files may contain sensitive headers and must stay private.
9. Download `release-proof` from the successful Actions run into `evidence/manifest.json`. Build with the matching source. The build includes only evidence whose source hash matches; the deployment observation is merged separately.

## Why the public adapter is smaller

The first Prisma edge deployment worked but measured well beyond the 10 ms Free CPU budget (demo bootstrap 41–146 ms in the initial sample). That version was not accepted as the finished deployment. The public API now uses a small Postgres.js adapter, parameterized values, allowlisted identifiers and the same shared business operations. Session authentication uses one SQL join; demo provisioning inserts its graph atomically with dependent CTEs. Prisma remains in Node/Fastify and the report worker. Both database adapters execute the same assertion suite, including races and rollback. The `apply_request_command` PostgreSQL function commits command result, request mutation, audit and optional outbox intent in one database call. It is `SECURITY INVOKER`, used by both runtimes, and never gains owner permissions. Domain refusals roll back the function block before returning a typed result; SQL failures roll back the statement.

[Postgres.js with Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/) requires prepared statements; the adapter explicitly enables them and disables unused array-type discovery. Connections are scoped to a Worker request, and Hyperdrive maintains the origin pool. Actual observed CPU values and tested version are in [deployment evidence](../evidence/deployment.json). This is a small synthetic sample, not a load test.

## Quotas and availability

The demo admits 40 new visitor workspaces per UTC day, with a transaction-level lock to serialize admission across locations. There are per-IP limits of 90 API calls/minute and four demo starts/minute. Each organization can create at most 100 requests. These are usage controls, not an absolute guarantee against quota exhaustion or abusive traffic. Cloudflare quotas are shared with other Workers on the account.

The static UI and `/proof/` are independently served. The UI handles an API failure with a retryable error rather than a false success. A daily demo-admission refusal returns 429 and points to the proof page. Actual provider quota exhaustion is not deliberately induced on the user's account. Free plans provide no guaranteed uninterrupted availability or SLA.

An hourly scheduled cleanup removes up to 20 workspaces older than seven days through the bounded `SECURITY DEFINER` function. The runtime role cannot rewrite expiry. No keep-alive is needed. No live Redis/BullMQ service is claimed online: reports, failure injection and replay are verified in the full Docker/CI environment. The public flow explicitly disables background reports and creates no work for an absent worker.

## Local Cloudflare check

Build the frontend, copy `.dev.vars.example` to `.dev.vars`, and set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to a local **application-role** database URL. Run `npm run cf:dev` at `http://localhost:8787`. The owner credential is never a Worker binding. Stop Wrangler before rebuilding on Windows because its asset watcher holds the output directory open.
