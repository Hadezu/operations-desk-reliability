# Operations Desk — agreed scope

Accepted: 2026-10-07. This is a synthetic portfolio application, not a client implementation.

## Objective

Demonstrate a multi-tenant approval system through an accessible web application and a reproducible Node.js/PostgreSQL/Redis/BullMQ test environment. New paid subscriptions or billable resources are outside the authorized scope.

## Product

Each visitor receives a private demo workspace with two organizations and three test identities per organization: employee, manager, observer. Employees and managers create, edit and submit their own drafts. Managers decide on other people's submitted requests. Observers read organization records and their audit history. Employees see their own records. No user can access another organization's records by changing an identifier.

Requests: title, description, category, amount in integer minor units (EUR), status, owner, version. Workflow: DRAFT -> SUBMITTED -> APPROVED or REJECTED. Decisions require a comment and an expected version. Reports summarize approved requests.

## Architecture

- Next.js / React / TypeScript web application.
- Separate Node.js / Fastify REST API using shared contracts and core business operations.
- PostgreSQL / Prisma; migrations, composite foreign keys, unique and check constraints.
- Opaque, server-side demo sessions. Demo identity switching is confined to the visitor's workspace. CSRF checks and secure cookies.
- Atomic command idempotency scoped to organization, actor and operation; request fingerprint prevents key reuse with another payload.
- Conditional version updates. Losing concurrent decisions return 409.
- Decision, append-only audit and outbox intent commit together.
- Outbox dispatcher -> Redis/BullMQ -> report worker. Bounded retries, duplicate publication, persisted result deduplication and controlled failed-job replay.
- Structured correlation logs and persisted attempt history. Application database role cannot update/delete audit records; migration owner is separate.
- Docker Compose, integration tests against real PostgreSQL/Redis, browser tests and CI evidence.

## Public deployment boundary

Cloudflare hosts the interactive approval flow. External managed PostgreSQL must be explicitly confirmed free before provisioning. Workers are not a standalone Node.js process. BullMQ crash/recovery evidence belongs to Docker/CI, not to fictitious online workers. Public UI must not offer an operation that silently waits forever for an absent worker.

Cloud deployment is gated by a measured build/runtime spike (free-tier size/CPU limits), available authentication and a free database. No claim of successful deployment or guaranteed uptime before verification.

## Evidence

`/proof` and README map claims to test source, expected/observed result, execution environment, timestamp and commit. Unrun, failed and stale evidence must not appear as passing. CI links are populated only after a real run. Role-switch details belong in engineering documentation, not the main product flow.

Required scenarios:

1. Cross-tenant reads, edits and deletes rejected.
2. Direct unauthorized API action rejected.
3. Duplicate and concurrent commands produce one entity; payload mismatch conflicts.
4. Concurrent opposing decisions produce one winner and one conflict.
5. Decision rollback leaves no audit/outbox side effects.
6. Crash before publication and after publication-before-ack recover safely.
7. Worker termination/restart produces one persisted report.
8. Poison task fails after bounded attempts; authorized replay is audited.
9. Clean migration/seed/bootstrap and browser approval journey pass.
10. Application role cannot rewrite audit history.

## Delivery order

1. Reproducible skeleton and database/runtime feasibility.
2. Approval flow, sessions, tenant authorization, contracts and database guarantees.
3. Outbox, worker recovery and meaningful integration tests.
4. UI, proof evidence, container/CI verification and free hosting.
5. Separate existing-code Next.js OSS contribution, selected and scoped independently after this application.

## Exclusions

Payments, AI agents, Kubernetes, Kafka, GraphQL, AWS/Terraform, additional roles, production customer data, arbitrary tenant administration, and claims of production-client experience. No exactly-once end-to-end claim; the guarantee is one persisted result under the documented tested recovery scenarios.
