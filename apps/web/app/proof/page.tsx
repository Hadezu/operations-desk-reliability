"use client";
import { useEffect, useState } from "react";
import { repositoryUrl } from "../project";

type Check = {
  name: string;
  status: "passed" | "failed" | "unverified";
  expected: string;
  observed: string;
  source: string;
  durationMs?: number;
};
type Manifest = {
  generatedAt: string | null;
  environment: string;
  commit: string | null;
  dirty: boolean;
  sourceHash: string | null;
  ciUrl: string | null;
  sourceUrl: string | null;
  checks: Check[];
};
const groups = [
  {
    id: "access",
    title: "Tenant boundaries & roles",
    description:
      "Organizations stay isolated. Sessions, roles and CSRF checks control every action on the server.",
    matches: (c: Check) => /TENANT:|RBAC:|SESSION:|CSRF:/.test(c.name),
  },
  {
    id: "commands",
    title: "Safe retries & concurrent decisions",
    description:
      "Repeated commands keep one result. Conflicting decisions and stale updates are rejected.",
    matches: (c: Check) =>
      /IDEMPOTENCY:|CONCURRENCY:|VALIDATION:|DELETE:/.test(c.name),
  },
  {
    id: "data-integrity",
    title: "Audit & database integrity",
    description:
      "Changes commit together. Database constraints and a restricted runtime role protect the record.",
    matches: (c: Check) =>
      /DATABASE:|AUDIT:|RETENTION:|OUTBOX:|CONTRACT:|PAGINATION:|Restricted database/.test(
        c.name,
      ),
  },
  {
    id: "worker-recovery",
    title: "Worker recovery",
    description:
      "Real Redis/BullMQ jobs recover from process crashes, retry bounded failures and retain one persisted report.",
    matches: (c: Check) =>
      c.source === "tests/worker-recovery.ts" ||
      c.name === "Docker Compose execution",
  },
  {
    id: "delivery",
    title: "Browser workflow & delivery",
    description:
      "Desktop and mobile approval journeys, strict types, a Next.js build and the Cloudflare runtime are exercised.",
    matches: (c: Check) =>
      [
        "TypeScript",
        "Cloudflare types",
        "Next.js production build",
        "Browser workflow",
        "Cloudflare bundle",
        "Cloudflare local runtime",
      ].includes(c.name),
  },
  {
    id: "online",
    title: "Public deployment & usage limits",
    description:
      "The hosted approval flow, database permissions and sampled runtime CPU are checked. Demo admission has a tested daily limit.",
    matches: (c: Check) =>
      c.name === "Public Cloudflare deployment" || /ADMISSION:/.test(c.name),
  },
];
function statusOf(checks: Check[]) {
  if (checks.some((c) => c.status === "failed")) return "failed";
  if (!checks.length || checks.some((c) => c.status !== "passed"))
    return "unverified";
  return "passed";
}
function checkedDate(value: string) {
  return (
    new Date(value).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}
export default function Proof() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    void fetch("/proof.json")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setManifest)
      .catch(() => setMissing(true));
  }, []);
  const checks = manifest?.checks ?? [];
  const passed = checks.filter((c) => c.status === "passed").length;
  const ciChecks = checks.filter(
    (c) => c.name !== "Public Cloudflare deployment",
  );
  const ciPassed = Boolean(
    manifest?.ciUrl && !manifest.dirty && statusOf(ciChecks) === "passed",
  );
  const uncategorized = checks.filter((c) => !groups.some((g) => g.matches(c)));
  function checkDetail(check: Check) {
    return (
      <li className="check-detail" key={check.name}>
        <div className="check-heading">
          <b>{check.name}</b>
          <span className={`check-status ${check.status}`}>{check.status}</span>
        </div>
        <dl>
          <dt>Expected</dt>
          <dd>{check.expected}</dd>
          <dt>Observed</dt>
          <dd>{check.observed}</dd>
        </dl>
        {manifest?.sourceUrl ? (
          <a href={`${manifest.sourceUrl}/${check.source}`}>
            Test source: <code>{check.source}</code> ↗
          </a>
        ) : (
          <code>{check.source}</code>
        )}
      </li>
    );
  }
  return (
    <main className="proof">
      <nav className="proof-nav" aria-label="Evidence navigation">
        <a href="/">← Try the demo</a>
        <a href={repositoryUrl}>GitHub repository ↗</a>
      </nav>
      <div className="eyebrow">ENGINEERING EVIDENCE</div>
      <h1>Six guarantees. Open to inspection.</h1>
      <p className="proof-intro">
        Explore the working approval flow, then inspect the tests behind it.
        Every result links to its source. This is an original synthetic
        portfolio project.
      </p>
      <section className="proof-summary" aria-label="Verification summary">
        <div>
          <span
            className={`check-status ${ciPassed ? "passed" : "unverified"}`}
          >
            {ciPassed ? "CI checks passed" : "CI evidence not confirmed"}
          </span>
          <p>
            {checks.length
              ? `${passed} of ${checks.length} evidence checks passed`
              : "No matching verification results in this build"}
          </p>
          <small>
            {manifest?.generatedAt
              ? `Last CI verification: ${checkedDate(manifest.generatedAt)}`
              : "Results appear after verification."}
          </small>
        </div>
        <div className="proof-actions">
          {manifest?.ciUrl && (
            <a className="primary" href={manifest.ciUrl}>
              Open CI run ↗
            </a>
          )}
          <a className="secondary" href="/proof.json">
            Raw evidence JSON ↗
          </a>
        </div>
      </section>
      {missing && (
        <p className="message error">
          Evidence could not be loaded. You can still inspect the code and CI
          directly on GitHub.
        </p>
      )}
      <div className="guarantee-grid">
        {groups.map((group) => {
          const results = checks.filter(group.matches);
          const status = statusOf(results);
          return (
            <article
              className="guarantee-card"
              id={group.id}
              key={group.id}
              aria-labelledby={`${group.id}-title`}
            >
              <span className={`check-status ${status}`}>{status}</span>
              <h2 id={`${group.id}-title`}>{group.title}</h2>
              <p>{group.description}</p>
              {group.id === "worker-recovery" && (
                <p className="evidence-environment">
                  Environment: Docker + CI · separate from the online approval
                  flow
                </p>
              )}
              <details className="check-disclosure">
                <summary>Inspect {results.length} checks</summary>
                {results.length ? (
                  <ul className="check-list">{results.map(checkDetail)}</ul>
                ) : (
                  <p className="muted">
                    No executed checks are included for this source yet.
                  </p>
                )}
              </details>
            </article>
          );
        })}
      </div>
      {uncategorized.length > 0 && (
        <details className="provenance">
          <summary>Additional checks ({uncategorized.length})</summary>
          <ul className="check-list">{uncategorized.map(checkDetail)}</ul>
        </details>
      )}
      <section className="proof-section" aria-labelledby="environments-title">
        <h2 id="environments-title">What runs where</h2>
        <div className="environment-grid">
          <div>
            <span className="eyebrow">LIVE ON THIS SITE</span>
            <h3>Try the approval workflow</h3>
            <p>
              Next.js / React, a Cloudflare API and PostgreSQL. Create, submit,
              approve or reject, switch roles and inspect the saved audit. Each
              visitor has a private workspace.
            </p>
            <a href="/">Open the demo ↗</a>
          </div>
          <div>
            <span className="eyebrow">REPRODUCIBLE IN DOCKER + CI</span>
            <h3>Inspect the complete backend</h3>
            <p>
              Node.js / Fastify, Prisma, PostgreSQL and Redis / BullMQ. Reports
              run here, including retries, crash recovery and controlled replay.
            </p>
            <a href={`${repositoryUrl}#try-the-full-environment`}>
              Run it from the README ↗
            </a>
          </div>
        </div>
      </section>
      <details className="provenance">
        <summary>
          Verification provenance: commit, environment and source hash
        </summary>
        <dl>
          <dt>Tested commit</dt>
          <dd>
            <code>{manifest?.commit ?? "Not verified"}</code>
            {manifest?.dirty ? " + working tree changes" : ""}
          </dd>
          <dt>Environment</dt>
          <dd>{manifest?.environment ?? "Not loaded"}</dd>
          <dt>Source SHA-256</dt>
          <dd>
            <code>{manifest?.sourceHash ?? "Not verified"}</code>
          </dd>
        </dl>
        <p>
          The build includes saved evidence only when its source hash matches.
          CI and public deployment observations are collected separately; their
          exact timestamps and sampled Worker version are in the JSON. Counts
          refer to evidence entries, not independent test cases.
        </p>
      </details>
      <section className="proof-section proof-limits">
        <h2>Scope and limits</h2>
        <p>
          Demo identities operate inside an isolated workspace. Production OIDC,
          PostgreSQL RLS, Next.js SSR and Server Actions are outside this
          project. Tenant isolation uses server authorization and relational
          constraints. The public site does not run Redis; its approval flow
          creates no background jobs. The complete worker environment is
          exercised in Docker and CI.
        </p>
        <p>
          Free hosting has quotas and no uptime guarantee. Sampled CPU is a
          small synthetic observation, not a load test. See the{" "}
          <a href={`${repositoryUrl}/blob/main/docs/DEPLOYMENT.md`}>
            deployment notes
          </a>{" "}
          for limits and reproducible setup.
        </p>
      </section>
    </main>
  );
}
