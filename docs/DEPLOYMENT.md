# Deployment gate — zero new paid subscriptions

Checked against provider documentation on 2026-10-07. The application is prepared for Cloudflare, but a successful dry-run or local `workerd` check is not a deployed production claim.

## Published free tiers

| Resource | Published free allowance | Source |
|---|---|---|
| Workers | 100,000 dynamic requests/day; 10 ms CPU per invocation; static asset requests free | [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Hyperdrive | 100,000 database queries/day on Workers Free | [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/) |
| Prisma Postgres | $0; no credit card; 200,000 operations/month; 500 MB storage | [Prisma pricing](https://www.prisma.io/pricing) |

The Prisma Console workspace was confirmed on Free and a database was created on 2026-10-07. The real connection authenticated as `prisma_migration`, but `CREATE ROLE desk_app` failed with PostgreSQL error `42501: restricted superuser cannot create roles`. This database is **not approved for application deployment**: the runtime must not inherit the migration credential. Neon Free is being evaluated as the PostgreSQL host; Prisma ORM remains the application's database client.

Use the actual **Free** plans. A paid plan with a small allowance is not equivalent. Do not enable automatic upgrades, purchase a domain, use paid Containers, or put a billable Redis service behind this demo. Workers.dev is sufficient.

Database operations, HTTP requests and CPU time are different quotas. One approval performs several database operations. The demo admission limit is 40 new workspaces per UTC day; API rate limits are per location/IP, not global billing caps. A workspace is capped at 100 requests per organization. These controls reduce ordinary consumption but do not guarantee that abusive traffic cannot exhaust a free quota.

## Before creating resources

1. Sign into Prisma Console and confirm the workspace is Free. No account is assumed to exist.
2. Confirm direct PostgreSQL access, custom runtime role creation, grants/revokes and `SECURITY DEFINER` functions. Run the provided restricted-role and audit-denial checks against a temporary hosted database. If the provider cannot support these, stop and choose another verified free provider; do not silently connect the application as owner.
3. Confirm the Cloudflare account is on Workers Free for this deployment. OAuth access is not evidence of the billing plan.
4. Recheck quotas and connection limits. Configure Hyperdrive's origin pool within the provider's available direct connections. [Prisma connection pooling reference](https://www.prisma.io/docs/postgres/database/connection-pooling).

## Prepare and validate

- Save migration-owner and application connection strings in ignored environment files or a secret manager. Never commit them or paste them into command history.
- Run `npm run db:bootstrap` with those URLs. It applies migrations, provisions `desk_app`, denies audit mutation, and grants only the bounded expiry cleanup function.
- Use Hyperdrive for the application role. **Disable Hyperdrive query caching**: sessions, role switching, CSRF rotation, revocation, version reads and approval screens require fresh state. A cached session read can undermine authorization. [Hyperdrive caching](https://developers.cloudflare.com/hyperdrive/configuration/query-caching/).
- Replace the zero placeholder Hyperdrive ID in `wrangler.jsonc`, set the HTTPS origin and a unique Worker name. The committed configuration is intentionally not a deployable hosted environment.
- Run `npm run verify`, `npm run cf:check`, and `wrangler check startup`.
- Deploy only after free-plan and database-permission checks. No deployment is performed by the ordinary verification command.
- Exercise desktop/mobile workflow, direct unauthorized requests and sign-out on the actual URL. Inspect Workers CPU percentiles and limit errors for demo bootstrap, command processing and proof-page access. Local timings do not establish compliance with the 10 ms production CPU allowance.
- If measured CPU exceeds Free limits, simplify the public API adapter or change the free deployment architecture. Do not enable the paid plan automatically.

## Local Cloudflare test

Start the local PostgreSQL helper, build the frontend, then copy `.dev.vars.example` to `.dev.vars`. Set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to the local **application-role** PostgreSQL URL in your shell and run `npm run cf:dev`. Only the origin is in `.dev.vars`; the owner credential is not a Worker binding. Use `http://localhost:8787` consistently with the configured origin.

Stop Wrangler before rebuilding on Windows: its asset watcher holds the static export directory open.

## Release evidence still required

- Real public URL and smoke-test timestamp.
- Repository URL and successful Actions run, including the separate container job.
- Provider Free plans and enforced resource permissions.
- Runtime CPU/limit observations and app behavior on quota exhaustion.
- Real deployment version tied to the verified source revision.

No live Redis/BullMQ claim belongs on the public Cloudflare deployment. Full job execution and failure injection are demonstrated in local/CI PostgreSQL + Redis. Cleanup runs hourly and removes up to 20 expired demo workspaces per invocation. No paid monitoring or keep-alive service is required.
