"use client";
import { useEffect, useState } from "react";
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
  return (
    <main className="proof">
      <nav className="proof-nav">
        <a href="/">← Operations Desk</a>
        <a href="/proof.json">Raw evidence JSON ↗</a>
      </nav>
      <div className="eyebrow">ENGINEERING EVIDENCE</div>
      <h1>Inspect the guarantees.</h1>
      <p className="proof-intro">
        A small approval system with deliberately difficult tests. These results
        come from executable checks against PostgreSQL and Redis. This is a
        synthetic portfolio project.
      </p>
      <div className="proof-meta">
        <span>Environment: {manifest?.environment ?? "Not loaded"}</span>
        <span>Run: {manifest?.generatedAt ?? "Not verified"}</span>
        <span>
          Commit: {manifest?.commit?.slice(0, 12) ?? "uncommitted"}
          {manifest?.dirty ? " + working tree changes" : ""}
        </span>
        {manifest?.ciUrl ? (
          <a href={manifest.ciUrl}>CI run ↗</a>
        ) : (
          <span>CI run: not published</span>
        )}
      </div>
      {manifest?.sourceHash && (
        <p className="muted">
          Tested source SHA-256: <code>{manifest.sourceHash}</code>
        </p>
      )}
      {missing && (
        <p className="message error">
          No test evidence is included in this build. Run the verification suite
          to generate it.
        </p>
      )}
      <div className="request-panel table-wrap">
        <table className="proof-table">
          <thead>
            <tr>
              <th>CLAIM</th>
              <th>EXPECTED</th>
              <th>OBSERVED</th>
              <th>TEST SOURCE</th>
            </tr>
          </thead>
          <tbody>
            {manifest?.checks.map((check) => (
              <tr key={check.name}>
                <td>
                  <b>{check.name}</b>
                </td>
                <td>{check.expected}</td>
                <td>
                  <span
                    className={check.status === "passed" ? "proof-status" : ""}
                  >
                    {check.status.toUpperCase()}
                  </span>
                  <br />
                  {check.observed}
                </td>
                <td>
                  {manifest.sourceUrl ? (
                    <a href={`${manifest.sourceUrl}/${check.source}`}>
                      <code>{check.source}</code>
                    </a>
                  ) : (
                    <code>{check.source}</code>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="proof-section">
        <h2>Two execution environments</h2>
        <p>
          The public deployment runs the Next.js static export and a Cloudflare
          Worker API with external PostgreSQL. The full Docker environment runs
          a standalone Node.js/Fastify API and Redis/BullMQ worker. They share
          the same authorization, contracts and business operations.
        </p>
        <pre className="architecture">
          {
            "Browser → Next.js UI → API → PostgreSQL\n                            ├─ request + audit + outbox (one transaction)\n                            └─ dispatcher → Redis / BullMQ → report worker\n                                                           └─ one persisted report"
          }
        </pre>
        <p>
          BullMQ reports are enabled only in the full environment. The public
          approval flow never queues work for an absent worker. This project
          proves Next.js App Router, React and API integration; it does not
          claim Next.js SSR or Server Actions.
        </p>
      </section>
      <section className="proof-section">
        <h2>Where the guarantees live</h2>
        <ul>
          <li>
            The server resolves organization and role from an opaque session.
            Demo role switching updates that session and is confined to the
            current visitor’s workspace.
          </li>
          <li>
            PostgreSQL arbitrates command keys, enforces relational constraints,
            and commits a decision together with its audit and report intent.
          </li>
          <li>
            Conditional version updates reject stale decisions with HTTP 409. A
            losing transaction leaves no partial audit or outbox entry.
          </li>
          <li>
            Workers provide at-least-once delivery. Database uniqueness and
            transactional processing yield one persisted report under the tested
            recovery scenarios.
          </li>
          <li>
            The runtime database role cannot update, delete or truncate audit
            records. A separate bounded retention function removes expired demo
            workspaces after seven days.
          </li>
        </ul>
      </section>
      <section className="proof-section">
        <h2>Limits, stated plainly</h2>
        <p>
          Demo identities are a sandbox capability, not a production identity
          provider. Tenant isolation is enforced by application queries and
          relational constraints; this project does not claim PostgreSQL
          row-level security. Source and test artifacts are the evidence; an
          unpublished CI run, untested cloud deployment or missing Docker
          execution is not a pass. Free services have quotas and no promised
          uninterrupted availability.
        </p>
        <p>
          Reproduce with <code>docker compose up --build</code>, then{" "}
          <code>npm run verify</code>. See the repository README for
          credentials, test commands, failure injection and deployment gates.
        </p>
      </section>
    </main>
  );
}
