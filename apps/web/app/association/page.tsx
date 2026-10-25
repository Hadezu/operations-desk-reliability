"use client";
import { demoError } from "../demo-errors";
import { useEffect, useState } from "react";
import type { AssociationState } from "../../../../packages/core/association";
import {
  memberSample,
  paymentSample,
} from "../../../../packages/contracts/association-fixtures";
import "./association.css";
const copy = {
  de: {
    title: "Mitglieder. Beiträge. Klarheit.",
    intro:
      "Vom Mitgliederimport bis zum Zahlungsabgleich: ein nachvollziehbarer Ablauf für Vereine und Verbände.",
    demo: "Synthetische Demo · keine Bankverbindung · kein E-Mail-Versand",
    start: "Demo starten",
    role: "Rolle",
    manager: "Verwaltung",
    observer: "Nur lesen",
    members: "Mitglieder",
    charges: "Beiträge",
    payments: "Zahlungen",
    history: "Verlauf",
    steps: [
      "Mitglieder prüfen",
      "Beiträge erstellen",
      "Zahlungen abgleichen",
      "Dokumente & Verlauf",
    ],
    sample: "Beispiel laden",
    upload: "Synthetische CSV hochladen",
    preview: "Import prüfen",
    apply: "Auswahl importieren",
    select: "Auswählen",
    name: "Name",
    category: "Kategorie",
    status: "Status",
    valid: "Gültig",
    invalid: "Ungültige Felder",
    duplicate: "Doppelte Identität",
    regular: "Regulär",
    reduced: "Ermäßigt",
    active: "Aktiv",
    paused: "Pausiert",
    left: "Beendet",
    period: "Beitragsmonat",
    create: "Beiträge erstellen",
    bank: "Bank-CSV importieren",
    reconcile: "Sicher erneut abgleichen",
    open: "Offen",
    paid: "Bezahlt",
    amount: "Betrag",
    queue: "Manuelle Klärung",
    resolve: "Zuordnung bestätigen",
    noMatch: "Kein passender offener Beitrag",
    export: "Buchhaltungs-CSV",
    report: "Abweichungsbericht",
    documents: "Dokumentvorschau",
    notice: "Beitragsmitteilung",
    welcome: "Willkommensbrief",
    reminder: "Zahlungserinnerung",
    generate: "Vorschau erstellen",
    success: "Vorgang gespeichert.",
    error:
      "Vorgang abgelehnt. Prüfen Sie die Eingaben oder aktualisieren Sie die Vorschau.",
    empty: "Noch keine Einträge.",
    reference: "Referenz",
    revision: "Revision",
    action: "Aktion",
    readOnly: "Lesemodus: Änderungen sind serverseitig gesperrt.",
    hint: "Nur Demo-Namen und Adressen mit @example.invalid. Maximal 50 Zeilen; einfache CSV ohne Anführungszeichen.",
    back: "Operations Desk",
    saved: "Gespeicherte Dokumente",
    unmatched: "Nicht zugeordnet",
    imported: "Importiert",
    language: "Sprache",
    guide: "Ihr 3-Minuten-Rundgang",
    explain:
      "Laden Sie das Beispiel, prüfen Sie zwei Konflikte und importieren Sie die drei gültigen Mitglieder. Erstellen Sie Beiträge, importieren Sie Zahlungen und klären Sie offene Zuordnungen.",
    choose: "Beitrag auswählen",
    download: "Text herunterladen",
  },
  pl: {
    title: "Członkowie. Składki. Porządek.",
    intro:
      "Od importu członków do uzgodnienia płatności: przejrzysty proces dla stowarzyszeń i fundacji.",
    demo: "Dane syntetyczne · bez połączenia z bankiem · bez wysyłki e-mail",
    start: "Uruchom demo",
    role: "Rola",
    manager: "Administracja",
    observer: "Tylko odczyt",
    members: "Członkowie",
    charges: "Składki",
    payments: "Płatności",
    history: "Historia",
    steps: [
      "Sprawdź członków",
      "Nalicz składki",
      "Uzgodnij płatności",
      "Dokumenty i historia",
    ],
    sample: "Wczytaj przykład",
    upload: "Wczytaj syntetyczny CSV",
    preview: "Sprawdź import",
    apply: "Importuj wybrane",
    select: "Wybierz",
    name: "Nazwa",
    category: "Kategoria",
    status: "Status",
    valid: "Poprawny",
    invalid: "Niepoprawne pola",
    duplicate: "Powielona tożsamość",
    regular: "Zwykła",
    reduced: "Ulgowa",
    active: "Aktywne",
    paused: "Wstrzymane",
    left: "Zakończone",
    period: "Miesiąc składki",
    create: "Nalicz składki",
    bank: "Importuj bankowy CSV",
    reconcile: "Ponów bezpieczne uzgodnienie",
    open: "Otwarte",
    paid: "Opłacone",
    amount: "Kwota",
    queue: "Do wyjaśnienia",
    resolve: "Zatwierdź przypisanie",
    noMatch: "Brak pasującej otwartej składki",
    export: "CSV dla księgowości",
    report: "Raport rozbieżności",
    documents: "Podgląd dokumentu",
    notice: "Zawiadomienie o składce",
    welcome: "List powitalny",
    reminder: "Przypomnienie",
    generate: "Utwórz podgląd",
    success: "Operacja zapisana.",
    error: "Operacja odrzucona. Sprawdź dane lub odśwież podgląd.",
    empty: "Brak wpisów.",
    reference: "Tytuł",
    revision: "Wersja",
    action: "Operacja",
    readOnly: "Tryb odczytu: serwer blokuje zmiany.",
    hint: "Tylko nazwy Demo i adresy @example.invalid. Maksymalnie 50 wierszy; prosty CSV bez cudzysłowów.",
    back: "Operations Desk",
    saved: "Zapisane dokumenty",
    unmatched: "Nieprzypisane",
    imported: "Zaimportowane",
    language: "Język",
    guide: "Trzyminutowy przewodnik",
    explain:
      "Wczytaj przykład, sprawdź dwa konflikty i importuj trzech poprawnych członków. Nalicz składki, importuj płatności i wyjaśnij nieprzypisane wpłaty.",
    choose: "Wybierz składkę",
    download: "Pobierz tekst",
  },
};
type Session = {
  csrfToken: string;
  identity: { role: string; organizationId: string };
  organizations: { id: string; members: { id: string; role: string }[] }[];
};
type View = AssociationState & {
  revision: number;
  discrepancies: {
    id: string;
    reference: string;
    cents: number;
    candidates: string[];
  }[];
  history: { revision: number; operation: string; created_at: string }[];
};
function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function Association() {
  const [lang, setLang] = useState<"de" | "pl">("de");
  const t = copy[lang];
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [step, setStep] = useState(0);
  const [csv, setCsv] = useState("");
  const [bank, setBank] = useState("");
  const [selection, setSelection] = useState<number[]>([]);
  const [period, setPeriod] = useState("2026-10");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [member, setMember] = useState("M001");
  const [kind, setKind] = useState("notice");
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const money = (n: number) =>
    new Intl.NumberFormat(lang, { style: "currency", currency: "EUR" }).format(
      n / 100,
    );
  async function request(path: string, payload?: unknown, s = session) {
    const r = await fetch("/api/" + path, {
      method: payload ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": s?.csrfToken ?? "",
        "idempotency-key": crypto.randomUUID(),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error?.code ?? "ERROR");
    return data;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      await fn();
      setMessage(t.success);
    } catch (e) {
      setMessage(demoError(e, lang, t.error));
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function refresh(s = session) {
    setView(await request("association", undefined, s));
  }
  async function start() {
    await run(async () => {
      const s: Session = await request("demo", {});
      const m = s.organizations
        .find((o) => o.id === s.identity.organizationId)!
        .members.find((m) => m.role === "MANAGER")!;
      const next = await request("session/switch", { memberId: m.id }, s);
      setSession(next);
      await refresh(next);
    });
  }
  async function command(payload: unknown) {
    await run(async () => {
      await request("association", payload);
      await refresh();
    });
  }
  const plan = view?.plans.at(-1);
  const writable = session?.identity.role === "MANAGER";
  const actionNames: Record<string, string> = {
    preview: t.preview,
    apply: t.apply,
    status: t.status,
    charges: t.create,
    payments: t.bank,
    reconcile: t.reconcile,
    resolve: t.resolve,
    document: t.generate,
  };
  return (
    <main className="association">
      <header className="assoc-top">
        <a href="/">◈ {t.back}</a>
        <label>
          {t.language}{" "}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as "de" | "pl")}
          >
            <option value="de">Deutsch</option>
            <option value="pl">Polski</option>
          </select>
        </label>
      </header>
      <section className="assoc-hero">
        <p className="assoc-eyebrow">ASSOCIATION OPERATIONS</p>
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
        <small>{t.demo}</small>
      </section>
      {!session ? (
        <section className="assoc-card">
          <h2>{t.guide}</h2>
          <p>{t.explain}</p>
          <button disabled={busy} onClick={start}>
            {t.start} →
          </button>
        </section>
      ) : (
        <>
          <div className="assoc-stats">
            {[
              [t.members, view?.members.length ?? 0],
              [t.charges, view?.charges.length ?? 0],
              [t.payments, view?.allocations.length ?? 0],
              [t.unmatched, view?.discrepancies.length ?? 0],
            ].map(([label, n]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          <div className="assoc-controls">
            <label>
              {t.role}{" "}
              <select
                disabled={busy}
                value={session.identity.role}
                onChange={(e) => {
                  const role = e.target.value;
                  void run(async () => {
                    const id = session.organizations
                      .find((o) => o.id === session.identity.organizationId)!
                      .members.find((m) => m.role === role)!.id;
                    const next = await request("session/switch", {
                      memberId: id,
                    });
                    setSession(next);
                    await refresh(next);
                  });
                }}
              >
                <option value="MANAGER">{t.manager}</option>
                <option value="OBSERVER">{t.observer}</option>
              </select>
            </label>
            <a href="/api/association/export" download>
              {t.export} ↗
            </a>
          </div>
          {!writable && <p>{t.readOnly}</p>}
          <nav className="assoc-steps" aria-label={t.guide}>
            {t.steps.map((label, i) => (
              <button
                key={label}
                aria-current={step === i ? "step" : undefined}
                onClick={() => setStep(i)}
              >
                <b>0{i + 1}</b>
                {label}
              </button>
            ))}
          </nav>
          <section className="assoc-card">
            <h2>{t.steps[step]}</h2>
            {step === 0 && (
              <>
                <p>{t.hint}</p>
                <div className="assoc-actions">
                  <button
                    className="secondary"
                    onClick={() => setCsv(memberSample)}
                  >
                    {t.sample}
                  </button>
                  <label>
                    {t.upload}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f && f.size <= 10000) void f.text().then(setCsv);
                        else {
                          setError(true);
                          setMessage(t.error);
                        }
                      }}
                    />
                  </label>
                </div>
                <label>
                  CSV
                  <textarea
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                    maxLength={10000}
                  />
                </label>
                <button
                  disabled={!writable || busy || !csv}
                  onClick={() => {
                    setSelection([]);
                    void command({ action: "preview", csv });
                  }}
                >
                  {t.preview}
                </button>
                {plan && !plan.applied && (
                  <>
                    <div
                      className="assoc-table"
                      tabIndex={0}
                      role="region"
                      aria-label={t.steps[step]}
                    >
                      <table>
                        <thead>
                          <tr>
                            <th>{t.select}</th>
                            <th>ID</th>
                            <th>{t.name}</th>
                            <th>{t.status}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.rows.map((r) => (
                            <tr key={r.row}>
                              <td>
                                <input
                                  aria-label={`${t.select} ${r.row}`}
                                  type="checkbox"
                                  disabled={!!r.issue || !writable}
                                  checked={selection.includes(r.row)}
                                  onChange={(e) =>
                                    setSelection(
                                      e.target.checked
                                        ? [...selection, r.row]
                                        : selection.filter((n) => n !== r.row),
                                    )
                                  }
                                />
                              </td>
                              <td>{r.member?.id ?? "—"}</td>
                              <td>{r.member?.name ?? `#${r.row}`}</td>
                              <td>
                                <span
                                  className={
                                    r.issue ? "assoc-warning" : "assoc-ok"
                                  }
                                >
                                  {r.issue === "DUPLICATE_MEMBER"
                                    ? t.duplicate
                                    : r.issue
                                      ? t.invalid
                                      : t.valid}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      disabled={!writable || busy || !selection.length}
                      onClick={() =>
                        command({
                          action: "apply",
                          plan: plan.id,
                          digest: plan.digest,
                          rows: selection,
                        })
                      }
                    >
                      {t.apply} ({selection.length})
                    </button>
                  </>
                )}
                <h3>{t.members}</h3>
                <div
                  className="assoc-table"
                  tabIndex={0}
                  role="region"
                  aria-label={t.steps[step]}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>{t.name}</th>
                        <th>{t.category}</th>
                        <th>{t.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view?.members.map((m) => (
                        <tr key={m.id}>
                          <td>{m.id}</td>
                          <td>
                            {m.name}
                            <small>{m.email}</small>
                          </td>
                          <td>{t[m.category]}</td>
                          <td>
                            <select
                              aria-label={`${t.status} ${m.id}`}
                              disabled={!writable || busy}
                              value={m.status}
                              onChange={(e) =>
                                command({
                                  action: "status",
                                  id: m.id,
                                  status: e.target.value,
                                })
                              }
                            >
                              {(["active", "paused", "left"] as const).map(
                                (v) => (
                                  <option key={v} value={v}>
                                    {t[v]}
                                  </option>
                                ),
                              )}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <div className="assoc-actions">
                  <label>
                    {t.period}
                    <input
                      type="month"
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={!writable || busy}
                    onClick={() => command({ action: "charges", period })}
                  >
                    {t.create}
                  </button>
                </div>
                <p>
                  {t.regular}: {money(12000)} · {t.reduced}: {money(6000)}
                </p>
                <div
                  className="assoc-table"
                  tabIndex={0}
                  role="region"
                  aria-label={t.steps[step]}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>{t.amount}</th>
                        <th>{t.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view?.charges.map((c) => (
                        <tr key={c.id}>
                          <td>{c.id}</td>
                          <td>{money(c.cents)}</td>
                          <td>
                            {view.allocations.some((a) => a.charge === c.id)
                              ? t.paid
                              : t.open}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="assoc-actions">
                  <button
                    className="secondary"
                    onClick={() => setBank(paymentSample)}
                  >
                    {t.sample}
                  </button>
                  <label>
                    {t.upload}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f && f.size <= 10000) void f.text().then(setBank);
                        else {
                          setError(true);
                          setMessage(t.error);
                        }
                      }}
                    />
                  </label>
                </div>
                <label>
                  CSV
                  <textarea
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    maxLength={10000}
                  />
                </label>
                <div className="assoc-actions">
                  <button
                    disabled={!writable || busy || !bank}
                    onClick={() => command({ action: "payments", csv: bank })}
                  >
                    {t.bank}
                  </button>
                  <button
                    className="secondary"
                    disabled={!writable || busy}
                    onClick={() => command({ action: "reconcile" })}
                  >
                    {t.reconcile}
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      download(
                        "discrepancies.json",
                        JSON.stringify(view?.discrepancies, null, 2),
                        "application/json",
                      )
                    }
                  >
                    {t.report}
                  </button>
                </div>
                <h3>{t.queue}</h3>
                {view?.discrepancies.map((p) => (
                  <article className="assoc-issue" key={p.id}>
                    <div>
                      <strong>
                        {p.id} · {money(p.cents)}
                      </strong>
                      <p>
                        {t.reference}: {p.reference || "—"}
                      </p>
                    </div>
                    <label>
                      {t.choose}
                      <select
                        value={matches[p.id] ?? ""}
                        onChange={(e) =>
                          setMatches({ ...matches, [p.id]: e.target.value })
                        }
                      >
                        <option value="">—</option>
                        {view.charges
                          .filter(
                            (c) =>
                              c.cents === p.cents &&
                              !view.allocations.some((a) => a.charge === c.id),
                          )
                          .map((c) => (
                            <option key={c.id}>{c.id}</option>
                          ))}
                      </select>
                    </label>
                    <button
                      disabled={!writable || busy || !matches[p.id]}
                      onClick={() =>
                        command({
                          action: "resolve",
                          payment: p.id,
                          charge: matches[p.id],
                        })
                      }
                    >
                      {t.resolve}
                    </button>
                  </article>
                ))}
                <h3>{t.paid}</h3>
                {view?.allocations.map((a) => (
                  <p key={a.payment}>
                    {a.payment} → {a.charge}
                  </p>
                ))}
              </>
            )}
            {step === 3 && (
              <>
                <h3>{t.documents}</h3>
                <div className="assoc-actions">
                  <label>
                    {t.members}
                    <select
                      value={member}
                      onChange={(e) => setMember(e.target.value)}
                    >
                      {view?.members.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.documents}
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      {(["notice", "welcome", "reminder"] as const).map((k) => (
                        <option value={k} key={k}>
                          {t[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={!writable || busy || !view?.members.length}
                    onClick={() =>
                      command({
                        action: "document",
                        member,
                        kind,
                        language: lang,
                      })
                    }
                  >
                    {t.generate}
                  </button>
                </div>
                {view?.documents.at(-1) && (
                  <>
                    <pre>{view.documents.at(-1)!.text}</pre>
                    <button
                      className="secondary"
                      onClick={() =>
                        download("demo-notice.txt", view.documents.at(-1)!.text)
                      }
                    >
                      {t.download}
                    </button>
                  </>
                )}
                <h3>{t.saved}</h3>
                {view?.documents.map((d) => (
                  <details key={d.id}>
                    <summary>
                      {t[d.kind as "notice"]} · {d.member} ·{" "}
                      {d.language.toUpperCase()}
                    </summary>
                    <pre>{d.text}</pre>
                  </details>
                ))}
                <h3>{t.history}</h3>
                <div
                  className="assoc-table"
                  tabIndex={0}
                  role="region"
                  aria-label={t.steps[step]}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>{t.revision}</th>
                        <th>{t.action}</th>
                        <th>{t.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view?.history.map((h) => (
                        <tr key={h.revision}>
                          <td>{h.revision}</td>
                          <td>{actionNames[h.operation] ?? h.operation}</td>
                          <td>{new Date(h.created_at).toLocaleString(lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
      <p
        role={error ? "alert" : "status"}
        className={`assoc-feedback ${error ? "assoc-warning" : ""}`}
      >
        {busy ? "…" : message}
      </p>
      <footer>
        {t.demo}
        <br />
        DEMO · EUR · CSV ≠ DATEV
      </footer>
    </main>
  );
}
