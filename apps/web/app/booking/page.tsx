"use client";
import { demoError } from "../demo-errors";
import { useEffect, useState } from "react";
import type { BookingState } from "../../../../packages/core/booking";
import "../association/association.css";
const words = {
  de: {
    title: "Ein Platz. Eine Zusage.",
    intro:
      "Ressourcen reservieren, Zahlungsereignisse prüfen und Unterbrechungen nachvollziehen.",
    demo: "Zahlungs-SIMULATOR · synthetische Daten · keine Karten oder Banken",
    start: "Demo starten",
    catalog: "Ressourcen",
    bike: "Tourenrad",
    desk: "Arbeitsplatz",
    room: "Besprechungsraum",
    from: "Beginn",
    to: "Ende",
    hold: "Reservieren",
    refresh: "Verfügbarkeit aktualisieren",
    orders: "Reservierungen",
    pay: "Zahlung erfolgreich simulieren",
    fail: "Zahlung ablehnen simulieren",
    refund: "Erstattung simulieren",
    repeat: "Letztes Ereignis wiederholen",
    cancel: "Stornieren",
    queue: "Problemfälle",
    audit: "Ereignisverlauf",
    role: "Rolle",
    manager: "Verwaltung / Simulator",
    employee: "Kunde",
    observer: "Nur lesen",
    success: "Vorgang gespeichert.",
    error:
      "Vorgang abgelehnt. Prüfen Sie Verfügbarkeit, Rolle und aktuellen Status.",
    held: "Reserviert",
    confirmed: "Bestätigt",
    expired: "Abgelaufen",
    failed: "Zahlung abgelehnt",
    cancelled: "Storniert",
    refund_pending: "Erstattung offen",
    refunded: "Erstattet",
    payment_review: "Zahlung prüfen",
    expires: "Reservierung bis",
    empty: "Keine Einträge.",
    hint: "Wählen Sie ein Zeitfenster. Die Reservierung bleibt 2 Minuten bestehen. Der Simulator kann Ereignisse wiederholen oder eine Erstattung vor der Zahlung zustellen.",
    language: "Sprache",
    details: "Details",
    available: "Verfügbar",
    unavailable: "Belegt",
    applied: "Verarbeitet",
    deferred: "Wartet auf Zahlung",
    ignored: "Bereits berücksichtigt",
    review: "Manuell prüfen",
    succeeded: "Zahlung erfolgreich",
  },
  pl: {
    title: "Jedno miejsce. Jedna rezerwacja.",
    intro:
      "Rezerwuj zasoby, sprawdzaj zdarzenia płatnicze i prześledź skutki przerw w działaniu.",
    demo: "SYMULATOR płatności · dane syntetyczne · bez kart i banków",
    start: "Uruchom demo",
    catalog: "Zasoby",
    bike: "Rower turystyczny",
    desk: "Stanowisko pracy",
    room: "Sala spotkań",
    from: "Początek",
    to: "Koniec",
    hold: "Rezerwuj",
    refresh: "Odśwież dostępność",
    orders: "Rezerwacje",
    pay: "Symuluj udaną płatność",
    fail: "Symuluj odrzuconą płatność",
    refund: "Symuluj zwrot",
    repeat: "Powtórz ostatnie zdarzenie",
    cancel: "Anuluj",
    queue: "Problemy",
    audit: "Historia zdarzeń",
    role: "Rola",
    manager: "Administracja / symulator",
    employee: "Klient",
    observer: "Tylko odczyt",
    success: "Operacja zapisana.",
    error: "Operacja odrzucona. Sprawdź dostępność, rolę i bieżący status.",
    held: "Zarezerwowane",
    confirmed: "Potwierdzone",
    expired: "Wygasłe",
    failed: "Płatność odrzucona",
    cancelled: "Anulowane",
    refund_pending: "Zwrot oczekujący",
    refunded: "Zwrócone",
    payment_review: "Sprawdź płatność",
    expires: "Rezerwacja do",
    empty: "Brak wpisów.",
    hint: "Wybierz przedział czasu. Rezerwacja jest utrzymywana przez 2 minuty. Symulator pozwala powtórzyć zdarzenie lub dostarczyć zwrot przed płatnością.",
    language: "Język",
    details: "Szczegóły",
    available: "Dostępne",
    unavailable: "Zajęte",
    applied: "Przetworzone",
    deferred: "Oczekuje na płatność",
    ignored: "Już uwzględnione",
    review: "Do weryfikacji",
    succeeded: "Płatność udana",
  },
};
type Session = {
  csrfToken: string;
  identity: { role: string; memberId: string; organizationId: string };
  organizations: { id: string; members: { id: string; role: string }[] }[];
};
type View = BookingState & {
  revision: number;
  now: string;
  history: { revision: number; operation: string; created_at: string }[];
};
function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export default function BookingPage() {
  const [lang, setLang] = useState<"de" | "pl">("de");
  const t = words[lang];
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [last, setLast] = useState<object | null>(null);
  useEffect(() => {
    const start = new Date(Date.now() + 86400000);
    start.setMinutes(0, 0, 0);
    setFrom(localInput(start));
    setTo(localInput(new Date(start.getTime() + 3600000)));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
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
    const body = await r.json();
    if (!r.ok) throw Error(body.error?.code);
    return body;
  }
  async function refresh(s = session) {
    setView(await request("booking", undefined, s));
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
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
  async function command(payload: object) {
    await run(async () => {
      await request("booking", payload);
      await refresh();
    });
  }
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [session]);
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
  function event(id: string, kind: string) {
    const payload = {
      action: "event",
      booking: id,
      event: crypto.randomUUID(),
      kind,
    };
    setLast(payload);
    void command(payload);
  }
  const status = (s: string) => t[s.toLowerCase() as "held"] ?? s;
  const resources = [
    ["bike-01", t.bike, "◎"],
    ["desk-01", t.desk, "▤"],
    ["room-01", t.room, "▦"],
  ];
  return (
    <main className="association">
      <header className="assoc-top">
        <a href="/">◈ Operations Desk</a>
        <label>
          {t.language}
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
        <p className="assoc-eyebrow">BOOKING & PAYMENT RELIABILITY</p>
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
        <small>{t.demo}</small>
      </section>
      {!session ? (
        <section className="assoc-card">
          <p>{t.hint}</p>
          <button disabled={busy} onClick={start}>
            {t.start} →
          </button>
        </section>
      ) : (
        <>
          <div className="assoc-controls">
            <label>
              {t.role}
              <select
                value={session.identity.role}
                disabled={busy}
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
                <option value="EMPLOYEE">{t.employee}</option>
                <option value="OBSERVER">{t.observer}</option>
              </select>
            </label>
            <button
              className="secondary"
              disabled={busy || session.identity.role === "OBSERVER"}
              onClick={() => command({ action: "refresh" })}
            >
              {t.refresh}
            </button>
          </div>
          <section className="assoc-card">
            <h2>{t.catalog}</h2>
            <p>{t.hint}</p>
            <div className="assoc-actions">
              <label>
                {t.from}
                <input
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                {t.to}
                <input
                  type="datetime-local"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
            <div className="booking-catalog">
              {resources.map(([id, name, icon]) => {
                const blocked = view?.bookings.some(
                  (b) =>
                    b.resource === id &&
                    ["HELD", "CONFIRMED"].includes(b.status) &&
                    Date.parse(b.start) < new Date(to).getTime() &&
                    Date.parse(b.end) > new Date(from).getTime(),
                );
                return (
                  <article className="assoc-card" key={id}>
                    <span aria-hidden="true" style={{ fontSize: 48 }}>
                      {icon}
                    </span>
                    <h3>{name}</h3>
                    <p>{blocked ? t.unavailable : t.available}</p>
                    <button
                      disabled={
                        busy ||
                        blocked ||
                        session.identity.role === "OBSERVER" ||
                        !from ||
                        !to
                      }
                      onClick={() =>
                        command({
                          action: "hold",
                          resource: id,
                          start: new Date(from).toISOString(),
                          end: new Date(to).toISOString(),
                        })
                      }
                    >
                      {t.hold} · {name}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
          <section className="assoc-card">
            <h2>{t.orders}</h2>
            {!view?.bookings.length && <p>{t.empty}</p>}
            {view?.bookings.map((b) => (
              <article className="assoc-card" key={b.id}>
                <h3>
                  {resources.find((r) => r[0] === b.resource)?.[1]} ·{" "}
                  <span className="assoc-ok">{status(b.status)}</span>
                </h3>
                <small>{b.id}</small>
                <p>
                  {new Date(b.start).toLocaleString(lang)} →{" "}
                  {new Date(b.end).toLocaleString(lang)}
                </p>
                {b.status === "HELD" && (
                  <p>
                    {t.expires}: {new Date(b.expires).toLocaleTimeString(lang)}
                  </p>
                )}
                <div className="assoc-actions">
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      session.identity.role === "OBSERVER" ||
                      (session.identity.role !== "MANAGER" &&
                        b.owner !== session.identity.memberId) ||
                      !["HELD", "CONFIRMED"].includes(b.status)
                    }
                    onClick={() => command({ action: "cancel", booking: b.id })}
                  >
                    {t.cancel}
                  </button>
                  {session.identity.role === "MANAGER" && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => event(b.id, "succeeded")}
                      >
                        {t.pay}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => event(b.id, "failed")}
                      >
                        {t.fail}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => event(b.id, "refunded")}
                      >
                        {t.refund}
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </section>
          <section className="assoc-card">
            <h2>{t.queue}</h2>
            {view?.bookings
              .filter((b) =>
                [
                  "PAYMENT_REVIEW",
                  "FAILED",
                  "EXPIRED",
                  "REFUND_PENDING",
                ].includes(b.status),
              )
              .map((b) => (
                <p key={b.id}>
                  {b.resource} · {status(b.status)} · {b.id}
                </p>
              ))}
            <h2>{t.audit}</h2>
            <button
              className="secondary"
              disabled={!last || busy || session.identity.role !== "MANAGER"}
              onClick={() => last && command(last)}
            >
              {t.repeat}
            </button>
            <div
              className="assoc-table"
              role="region"
              tabIndex={0}
              aria-label={t.audit}
            >
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{t.details}</th>
                    <th>{t.orders}</th>
                  </tr>
                </thead>
                <tbody>
                  {view?.events.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <small>{e.id}</small>
                      </td>
                      <td>
                        {e.kind === "succeeded"
                          ? t.succeeded
                          : e.kind === "failed"
                            ? t.failed
                            : t.refunded}
                        <small>{t[e.outcome]}</small>
                      </td>
                      <td>
                        <small>{e.booking}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>
                {t.audit} ({view?.history.length ?? 0})
              </summary>
              {view?.history.map((h) => (
                <p key={h.revision}>
                  #{h.revision} ·{" "}
                  {h.operation === "hold"
                    ? t.hold
                    : h.operation === "cancel"
                      ? t.cancel
                      : h.operation === "event"
                        ? t.demo
                        : t.refresh}{" "}
                  · {new Date(h.created_at).toLocaleString(lang)}
                </p>
              ))}
            </details>
          </section>
        </>
      )}
      <p role={error ? "alert" : "status"} className="assoc-feedback">
        {busy ? "…" : message}
      </p>
      <footer>{t.demo}</footer>
      <style>{`.booking-catalog{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.booking-catalog .assoc-card{padding:20px;margin:0}.booking-catalog h3{margin-top:15px}@media(max-width:700px){.booking-catalog{grid-template-columns:1fr}}`}</style>
    </main>
  );
}
