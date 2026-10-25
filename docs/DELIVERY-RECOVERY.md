# Delivery & Recovery Evidence

This page describes bounded engineering checks, not an SLA, independent security audit, production deployment or 24/7 support. Final exact revision/results are recorded in `docs/EXPANSION-RESULTS.md`.

## Reproduce from a clean checkout

Use Node 24 and npm. No real secrets or paid service is needed. `npm ci` installs pinned dependencies. `npm run db:generate` creates both clients. In terminal one, run `npm run db:local`: it initializes a real PostgreSQL cluster in ignored `.local/postgres`, listens on loopback port 55432, applies migrations, provisions a restricted runtime role and writes a local `.env` only if none exists. Keep it running. Do not reuse production credentials. The documented local passwords are disposable fixture credentials.

In terminal two:

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
node --import tsx scripts/booking-restart-drill.ts
node --import tsx scripts/recovery-drill.ts
```

`npm run dev` starts the API and web development server at localhost:3100. `/api/health` checks database readiness. `/association/` and `/booking/` start separate per-visitor synthetic workspaces through the existing session mechanism. Demo examples are in `packages/contracts/association-fixtures.ts`; tests allocate fresh workspaces and do not reset an existing database. Existing approval features and their setup remain in the README.

The automated browser harness raises only its local API quotas to 30 demo starts and 1,000 requests per minute because ten fresh browser contexts share one loopback address. Normal Node defaults remain eight starts / 180 requests; the existing Cloudflare limits are unchanged. This is test isolation, not a load/capacity claim.

## Backup and restore that was actually exercised

`scripts/recovery-drill.ts` accepts only loopback PostgreSQL. It captures the explicitly listed application tables in one repeatable-read transaction, writes a SHA-256-bound JSON backup to ignored `.local`, creates a uniquely named `recovery_<uuid>` database, applies all migrations, restores in dependency order and compares every captured table. It then deliberately creates a table and calls a nonexistent function in one transaction; rollback must remove that table. Finally it checks database health and drops only its generated destination database. The source is never reset or dropped.

The backup contains synthetic sessions and must not be published. The machine-readable result contains counts and digest, not the backup rows. This is a bounded application-table logical backup, **not pg_dump, physical backup, WAL/PITR, role/extension backup or disaster recovery across hosts**. New application tables must be added to the script. A real deployment needs the hosting provider's backup policy, encrypted off-host copies, retention/access controls and a restore rehearsal in a genuinely separate environment.

`scripts/booking-restart-drill.ts` uses a dedicated localhost:3193 API process and the disposable database. It kills only the child it started, restarts it and verifies session/receipt persistence and one payment event. It does not interrupt the user's normal application or a public deployment. Existing BullMQ worker interruption scenarios remain available in the full `npm run verify` workflow with Redis; local expansion results distinguish them from the new API restart drill.

## Safe update and handover

1. Review and merge the feature PR only with owner approval. Record the exact commit and backup before deployment.
2. Restore a staging copy and run migrations using the migration role, then re-provision runtime grants. Run tests, browser checks and health checks before switching traffic.
3. Deploy the reviewed build. New module requests require interactive PostgreSQL transactions; the Worker routes them through Hyperdrive, while original single-statement approval commands retain their existing adapter. Confirm the Hyperdrive database is the migrated database, query caching is disabled for mutable application reads, permissions are correct, and hosting CPU/connection limits are adequate. Local workerd is not a hosted capacity test.
4. If application validation fails, route traffic back to the prior build. These additive migrations can stay in place; do not delete new business history to undo code. A database restore is a separate, explicit operational decision after reconciling writes since the backup.
5. Before real users: replace synthetic role switching with identity onboarding, define tenant authorization and privacy retention, review accounting rules, add monitoring and response ownership, establish an off-host backup/restore process, and test destination integrations with authorized sandbox data.

The handover package consists of source, lockfile, fixtures, setup/migrations, tests, evidence, limitations and the data contracts in the product documents. A paid support agreement can define covered modules/environments, defect acceptance criteria, contact channels, response windows, exclusions and change-request handling. No response time, uptime, warranty period or unlimited support is implied by this demo.

## Buyer wording

**DE:** Die Übergabe umfasst einen reproduzierbaren Start, dokumentierte Konfiguration, konkrete Prüfergebnisse und einen getesteten Wiederherstellungsablauf für synthetische Daten. Hosting, Überwachung und Support werden projektspezifisch vereinbart. Ein erster bezahlter Schritt kann die Einrichtung einer Testumgebung und einen Restore-Test umfassen.

**PL:** Przekazanie obejmuje odtwarzalny start, udokumentowaną konfigurację, konkretne wyniki testów i sprawdzony proces przywracania danych syntetycznych. Hosting, monitoring i wsparcie są uzgadniane osobno. Pierwszy płatny etap może objąć środowisko testowe i próbę odtworzenia danych.

**EN:** Delivery includes reproducible setup, documented configuration, concrete verification results and a tested synthetic-data restore workflow. Hosting, monitoring and support are agreed per project. A first paid stage can establish a test environment and a restore rehearsal.

**Email:** We can begin with a reproducible test environment and a restore rehearsal for the agreed application slice, then use the recorded results to define deployment and support responsibilities. / **DE:** Wir können mit einer reproduzierbaren Testumgebung und einem Restore-Test beginnen und anhand der Ergebnisse Betrieb und Support abstimmen. / **PL:** Możemy zacząć od odtwarzalnego środowiska testowego i próby przywrócenia danych, a na podstawie wyników ustalić wdrożenie i zakres wsparcia.
