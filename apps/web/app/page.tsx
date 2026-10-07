"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { z } from "zod";
import {
  RequestRecord,
  type RoleName,
} from "../../../packages/contracts/index";

type RecordRow = z.infer<typeof RequestRecord>;
type Member = { id: string; name: string; role: RoleName };
type Session = {
  identity: {
    organizationId: string;
    memberId: string;
    name: string;
    role: RoleName;
  };
  csrfToken: string;
  organizations: { id: string; name: string; members: Member[] }[];
  backgroundMode: string;
};
type Audit = {
  id: string;
  action: string;
  correlationId: string;
  createdAt: string;
};
type ReportState = {
  mode: string;
  report: { content: unknown } | null;
  event: { status: string; correlationId: string } | null;
  attempts: {
    id: string;
    status: string;
    errorCode: string | null;
    startedAt: string;
  }[];
};
const words = (value: string) => value.toLowerCase().replaceAll("_", " ");
const money = (amount: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    amount / 100,
  );
const date = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export default function Desk() {
  const [session, setSession] = useState<Session | null>(null);
  const [starting, setStarting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [events, setEvents] = useState<Audit[]>([]);
  const [report, setReport] = useState<ReportState | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [comment, setComment] = useState("");
  const gate = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  // Preserve the same key when the response is lost and the user retries the same command.
  const commandKeys = useRef(new Map<string, string>());

  async function api<T>(
    path: string,
    method = "GET",
    payload?: unknown,
    auth: Session | null = session,
  ): Promise<T> {
    const fingerprint = JSON.stringify([method, path, payload]);
    const headers: Record<string, string> = {};
    if (method !== "GET") {
      headers["x-csrf-token"] = auth?.csrfToken ?? "";
      if (!commandKeys.current.has(fingerprint))
        commandKeys.current.set(fingerprint, crypto.randomUUID());
      headers["idempotency-key"] = commandKeys.current.get(fingerprint)!;
    }
    if (payload !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) setSession(null);
      throw new ApiError(
        data.error?.message ??
          "The service is temporarily unavailable. Please retry.",
        response.status,
      );
    }
    commandKeys.current.delete(fingerprint);
    return data as T;
  }
  async function list(
    auth = session,
    next?: string,
    filters = { status, category },
  ) {
    const query = new URLSearchParams({ limit: "12" });
    if (filters.status) query.set("status", filters.status);
    if (filters.category) query.set("category", filters.category);
    if (next) query.set("cursor", next);
    const data = await api<{ items: RecordRow[]; nextCursor: string | null }>(
      `/api/requests?${query}`,
      "GET",
      undefined,
      auth,
    );
    setRows((previous) => (next ? [...previous, ...data.items] : data.items));
    setCursor(data.nextCursor);
  }
  async function details(record: RecordRow) {
    const [fresh, audit, background] = await Promise.all([
      api<RecordRow>(`/api/requests/${record.id}`),
      api<{ items: Audit[] }>(`/api/requests/${record.id}/audit`),
      api<ReportState>(`/api/requests/${record.id}/report`),
    ]);
    setSelected(fresh);
    setEvents(audit.items);
    setReport(background);
    setComment("");
    setEditing(false);
    setCreating(false);
    dialog.current?.showModal();
  }
  async function run(action: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not complete the operation.",
      );
      if (err instanceof ApiError && err.status === 409 && selected) {
        try {
          await details(selected);
          await list();
        } catch {
          /* Keep the original actionable error. */
        }
      }
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/session");
        if (response.ok && live) {
          const auth = (await response.json()) as Session;
          setSession(auth);
          await list(auth);
        }
      } catch {
        if (live)
          setError("Cannot connect to the demo. Please retry in a moment.");
      } finally {
        if (live) setStarting(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const org = session?.organizations.find(
    (item) => item.id === session.identity.organizationId,
  );
  const ownsDraft =
    selected?.status === "DRAFT" &&
    selected.ownerId === session?.identity.memberId;
  const canDecide =
    selected?.status === "SUBMITTED" &&
    session?.identity.role === "MANAGER" &&
    selected.ownerId !== session.identity.memberId;
  function close() {
    dialog.current?.close();
    setSelected(null);
    setCreating(false);
    setEditing(false);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      title: String(data.get("title")),
      description: String(data.get("description")),
      category: String(data.get("category")),
      amountCents: Math.round(Number(data.get("amount")) * 100),
    };
    await run(async () => {
      const saved = await api<RecordRow>(
        editing && selected ? `/api/requests/${selected.id}` : "/api/requests",
        editing ? "PATCH" : "POST",
        editing && selected
          ? { ...payload, version: selected.version }
          : payload,
      );
      await list();
      await details(saved);
      setNotice(
        editing ? "Draft saved." : "Request created. Ready when you are.",
      );
    });
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            od<span>↗</span>
          </span>
          <span>
            Operations
            <br />
            <strong>Desk</strong>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <a className="active" href="/">
            <span>▤</span> Requests <span className="nav-dot" />
          </a>
          <a href="/proof/">
            <span>◈</span> Engineering proof <span>↗</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <span className="small-pill">PORTFOLIO DEMO</span>
          <p>
            Small workflow.
            <br />
            Real guarantees.
          </p>
          <small>Built to be inspected.</small>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> Requests
          </span>
          <a href="/proof/">
            View the evidence <span>↗</span>
          </a>
        </header>
        <div className="content">
          {!session ? (
            <section className="welcome">
              <div className="eyebrow">OPERATIONS, IN ORDER</div>
              <h1>
                Every request.
                <br />A clear next step.
              </h1>
              <p>
                Create a request, review a decision, and follow the record.
                Explore three roles in your own private demo workspace.
              </p>
              <button
                className="primary"
                disabled={busy || starting}
                onClick={() =>
                  void run(async () => {
                    const auth = await api<Session>("/api/demo", "POST", {});
                    setSession(auth);
                    await list(auth);
                  })
                }
              >
                {starting
                  ? "Checking session…"
                  : busy
                    ? "Preparing your workspace…"
                    : "Try the demo →"}
              </button>
              <div className="welcome-steps">
                <span>
                  <b>01</b> Create & submit
                </span>
                <span>
                  <b>02</b> Review & decide
                </span>
                <span>
                  <b>03</b> Follow the audit
                </span>
              </div>
              <p className="fine">
                Synthetic data · No sign-up · Session lasts 24 hours
              </p>
            </section>
          ) : (
            <>
              <div className="heading-row">
                <div>
                  <div className="eyebrow">{org?.name}</div>
                  <h1>Requests</h1>
                  <p className="muted">
                    The right decisions. A record of every step.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={busy || session.identity.role === "OBSERVER"}
                  onClick={() => {
                    setCreating(true);
                    setSelected(null);
                    setEditing(false);
                    setError("");
                    dialog.current?.showModal();
                  }}
                >
                  ＋ New request
                </button>
              </div>
              <section className="demo-bar" aria-label="Demo identity">
                <span className="demo-caption">
                  <span className="live-dot" /> YOUR PRIVATE DEMO
                </span>
                <label>
                  Organization
                  <select
                    aria-label="Organization"
                    value={session.identity.organizationId}
                    disabled={busy}
                    onChange={(event) =>
                      void run(async () => {
                        const target = session.organizations.find(
                          (item) => item.id === event.target.value,
                        )!;
                        const member = target.members.find(
                          (item) => item.role === session.identity.role,
                        )!;
                        const auth = await api<Session>(
                          "/api/session/switch",
                          "POST",
                          { memberId: member.id },
                        );
                        setSession(auth);
                        close();
                        setStatus("");
                        setCategory("");
                        await list(auth, undefined, {
                          status: "",
                          category: "",
                        });
                      })
                    }
                  >
                    {session.organizations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Explore as
                  <select
                    aria-label="Explore as"
                    value={session.identity.memberId}
                    disabled={busy}
                    onChange={(event) =>
                      void run(async () => {
                        const auth = await api<Session>(
                          "/api/session/switch",
                          "POST",
                          { memberId: event.target.value },
                        );
                        setSession(auth);
                        close();
                        await list(auth);
                      })
                    }
                  >
                    {org?.members.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {words(item.role)}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
              <section className="journey" aria-label="Demo walkthrough">
                <div>
                  <span>01</span>
                  <p>
                    <b>Create as employee</b>
                    <small>Save a draft, then submit it.</small>
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <p>
                    <b>Switch to manager</b>
                    <small>Approve or reject with a reason.</small>
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <p>
                    <b>Inspect as observer</b>
                    <small>See the decision and its history.</small>
                  </p>
                </div>
              </section>
              <section className="request-panel">
                <div className="panel-toolbar">
                  <h2>
                    Request register{" "}
                    <span>
                      {rows.length}
                      {cursor ? "+" : ""}
                    </span>
                  </h2>
                  <div className="filters">
                    <label className="sr-only" htmlFor="status">
                      Status
                    </label>
                    <select
                      id="status"
                      disabled={busy}
                      value={status}
                      onChange={(e) => {
                        const value = e.target.value;
                        setStatus(value);
                        void run(() =>
                          list(session, undefined, { status: value, category }),
                        );
                      }}
                    >
                      <option value="">All statuses</option>
                      {["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].map(
                        (item) => (
                          <option key={item} value={item}>
                            {words(item)}
                          </option>
                        ),
                      )}
                    </select>
                    <label className="sr-only" htmlFor="category">
                      Category filter
                    </label>
                    <select
                      id="category"
                      value={category}
                      disabled={busy}
                      onChange={(e) => {
                        const value = e.target.value;
                        setCategory(value);
                        void run(() =>
                          list(session, undefined, { status, category: value }),
                        );
                      }}
                    >
                      <option value="">All categories</option>
                      {["EQUIPMENT", "SOFTWARE", "TRAVEL"].map((item) => (
                        <option key={item} value={item}>
                          {words(item)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="quiet"
                      aria-label="Refresh requests"
                      disabled={busy}
                      onClick={() => void run(() => list())}
                    >
                      ↻
                    </button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>REQUEST</th>
                        <th>CATEGORY</th>
                        <th>AMOUNT</th>
                        <th>STATUS</th>
                        <th>CREATED</th>
                        <th>
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <button
                              className="request-title"
                              onClick={() => void run(() => details(row))}
                            >
                              {row.title}
                            </button>
                            <small className="record-id">
                              REQ-{row.id.slice(0, 8).toUpperCase()}
                            </small>
                          </td>
                          <td className="capitalize">{words(row.category)}</td>
                          <td className="amount">{money(row.amountCents)}</td>
                          <td>
                            <span
                              className={`badge ${row.status.toLowerCase()}`}
                            >
                              {words(row.status)}
                            </span>
                          </td>
                          <td className="table-date">{date(row.createdAt)}</td>
                          <td>
                            <button
                              className="quiet"
                              aria-label={`Open ${row.title}`}
                              onClick={() => void run(() => details(row))}
                            >
                              ↗
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length === 0 && (
                  <div className="empty">
                    <b>No requests here yet.</b>
                    <p>Try another filter or create your first request.</p>
                  </div>
                )}
                <div className="table-footer">
                  <span>
                    {session.identity.role === "EMPLOYEE"
                      ? "Showing your requests"
                      : "Showing organization requests"}{" "}
                    · EUR
                  </span>
                  {cursor ? (
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() => void run(() => list(session, cursor))}
                    >
                      Load more ↓
                    </button>
                  ) : (
                    <span>End of register</span>
                  )}
                </div>
              </section>
              <footer className="page-footer">
                <span>
                  Decisions belong to people. History stays with the request.
                </span>
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api("/api/session", "DELETE");
                      setSession(null);
                      setRows([]);
                      commandKeys.current.clear();
                    })
                  }
                >
                  End session
                </button>
              </footer>
            </>
          )}
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="message" role="status">
              {notice}
            </div>
          )}
        </div>
      </main>
      <dialog ref={dialog} className="detail-dialog" onCancel={close}>
        <div className="dialog-top">
          <span className="eyebrow">
            {creating ? "NEW REQUEST" : "REQUEST DETAILS"}
          </span>
          <button className="quiet" aria-label="Close details" onClick={close}>
            ✕
          </button>
        </div>
        {creating || editing ? (
          <form onSubmit={save} className="request-form">
            <h2>{editing ? "Edit draft" : "What do you need?"}</h2>
            <label>
              Title
              <input
                name="title"
                required
                minLength={3}
                maxLength={100}
                defaultValue={editing ? selected?.title : ""}
                placeholder="e.g. Design team monitors"
                autoFocus
              />
            </label>
            <div className="form-grid">
              <label>
                Category
                <select
                  name="category"
                  defaultValue={editing ? selected?.category : "EQUIPMENT"}
                >
                  <option value="EQUIPMENT">Equipment</option>
                  <option value="SOFTWARE">Software</option>
                  <option value="TRAVEL">Travel</option>
                </select>
              </label>
              <label>
                Amount (EUR)
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  max="100000"
                  step="0.01"
                  required
                  defaultValue={
                    editing && selected ? selected.amountCents / 100 : undefined
                  }
                  placeholder="0.00"
                />
              </label>
            </div>
            <label>
              Why is this needed?
              <textarea
                name="description"
                required
                minLength={5}
                maxLength={1000}
                rows={4}
                defaultValue={editing ? selected?.description : ""}
                placeholder="A little context helps the reviewer."
              />
            </label>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save draft"}
              </button>
            </div>
          </form>
        ) : (
          selected && (
            <>
              <h2 className="detail-title">{selected.title}</h2>
              <div className="detail-meta">
                <span className={`badge ${selected.status.toLowerCase()}`}>
                  {words(selected.status)}
                </span>
                <span className="capitalize">{words(selected.category)}</span>
                <b>{money(selected.amountCents)}</b>
                <span>v{selected.version}</span>
              </div>
              <p className="description">{selected.description}</p>
              {selected.decisionComment && (
                <blockquote>
                  <small>REVIEWER’S DECISION</small>
                  {selected.decisionComment}
                </blockquote>
              )}
              {ownsDraft && (
                <div className="draft-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const updated = await api<RecordRow>(
                          `/api/requests/${selected.id}/submit`,
                          "POST",
                          { version: selected.version },
                        );
                        await list();
                        await details(updated);
                        setNotice(
                          "Submitted. Switch to manager to review this request.",
                        );
                      })
                    }
                  >
                    Submit for review →
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditing(true)}
                  >
                    Edit draft
                  </button>
                  <button
                    className="quiet danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/api/requests/${selected.id}`, "DELETE", {
                          version: selected.version,
                        });
                        close();
                        await list();
                        setNotice("Draft deleted.");
                      })
                    }
                  >
                    Delete draft
                  </button>
                </div>
              )}
              {canDecide && (
                <section className="decision-box">
                  <label htmlFor="decision-comment">Decision comment</label>
                  <textarea
                    id="decision-comment"
                    minLength={3}
                    maxLength={500}
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Explain the decision for the request owner."
                  />
                  <div className="form-actions">
                    {(["REJECTED", "APPROVED"] as const).map((decision) => (
                      <button
                        key={decision}
                        className={
                          decision === "APPROVED" ? "primary" : "secondary"
                        }
                        disabled={busy || comment.trim().length < 3}
                        onClick={() =>
                          void run(async () => {
                            const updated = await api<RecordRow>(
                              `/api/requests/${selected.id}/decision`,
                              "POST",
                              { version: selected.version, decision, comment },
                            );
                            await list();
                            await details(updated);
                            setNotice("Decision recorded.");
                          })
                        }
                      >
                        {decision === "APPROVED"
                          ? "Approve request"
                          : "Reject request"}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <section className="audit-section">
                <div className="section-heading">
                  <h3>Activity</h3>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => void run(() => details(selected))}
                  >
                    Refresh ↻
                  </button>
                </div>
                {events.length === 0 ? (
                  <p className="muted">
                    Seeded demo record. New actions will appear here.
                  </p>
                ) : (
                  <ol className="timeline">
                    {events.map((item) => (
                      <li key={item.id}>
                        <span className="timeline-point" />
                        <div>
                          <b className="capitalize">{words(item.action)}</b>
                          <small>{date(item.createdAt)}</small>
                          <details>
                            <summary>Trace reference</summary>
                            <code>{item.correlationId}</code>
                          </details>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              {selected.status === "APPROVED" && report && (
                <section className="report-section">
                  <h3>Approval report</h3>
                  {report.mode !== "bullmq" ? (
                    <p className="muted">
                      Reports run in the full local environment.{" "}
                      <a href="/proof/">See recovery test evidence ↗</a>
                    </p>
                  ) : (
                    <>
                      <p>
                        {report.report
                          ? "Report ready. One persisted result."
                          : `Processing status: ${words(report.event?.status ?? "pending")}`}
                      </p>
                      {report.report && (
                        <pre className="report-data">
                          {JSON.stringify(report.report.content, null, 2)}
                        </pre>
                      )}
                      {report.attempts.map((attempt) => (
                        <div className="attempt" key={attempt.id}>
                          <span>{words(attempt.status)}</span>
                          <small>{date(attempt.startedAt)}</small>
                        </div>
                      ))}
                      {report.event?.status === "FAILED" &&
                        session?.identity.role === "MANAGER" && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api(
                                  `/api/requests/${selected.id}/replay`,
                                  "POST",
                                  {
                                    reason:
                                      "Manual retry from the request review screen.",
                                  },
                                );
                                await details(selected);
                              })
                            }
                          >
                            Retry failed report
                          </button>
                        )}
                    </>
                  )}
                </section>
              )}
            </>
          )
        )}
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
      </dialog>
    </div>
  );
}
