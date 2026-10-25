import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const dbUrl = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost"].includes(dbUrl.hostname))
  throw Error("Loopback disposable database required");
const origin = "http://localhost:3193";
let child: ChildProcess | undefined;
async function start() {
  child = spawn(process.execPath, ["--import", "tsx", "apps/api/main.ts"], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      APP_ORIGIN: origin,
      API_PORT: "3193",
      BACKGROUND_MODE: "disabled",
    },
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error("API exited");
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {}
    await delay(100);
  }
  throw Error("API did not become ready");
}
async function stop() {
  if (child && child.exitCode === null) {
    const done = once(child, "exit");
    child.kill("SIGKILL");
    await done;
  }
}
let cookie = "",
  csrf = "";
async function request(
  path: string,
  payload?: unknown,
  key = crypto.randomUUID(),
) {
  const r = await fetch(origin + "/api/" + path, {
    method: payload ? "POST" : "GET",
    headers: {
      origin,
      cookie,
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": key,
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (path === "demo") cookie = r.headers.get("set-cookie")!.split(";")[0];
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}
try {
  await start();
  const demo = await request("demo", {});
  csrf = demo.csrfToken;
  const manager = demo.organizations[0].members.find(
    (m: { role: string }) => m.role === "MANAGER",
  );
  const session = await request("session/switch", { memberId: manager.id });
  csrf = session.csrfToken;
  const holdKey = crypto.randomUUID();
  const hold = {
    action: "hold",
    resource: "desk-01",
    start: new Date(Date.now() + 3600000).toISOString(),
    end: new Date(Date.now() + 7200000).toISOString(),
  };
  const receipt = await request("booking", hold, holdKey);
  const event = {
    action: "event",
    booking: receipt.booking,
    event: crypto.randomUUID(),
    kind: "succeeded",
  };
  await request("booking", event);
  // Kill the actual API process after its commit, then reuse the original session
  // and command key as a client recovering from an interrupted connection would.
  await stop();
  await start();
  assert.deepEqual(await request("booking", hold, holdKey), receipt);
  await request("booking", event);
  const state = await request("booking");
  assert.equal(state.bookings.length, 1);
  assert.equal(state.bookings[0].status, "CONFIRMED");
  assert.equal(state.events.length, 1);
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/booking-restart.json",
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        apiProcessKilled: true,
        restarted: true,
        sessionPreserved: true,
        commandReceiptPreserved: true,
        bookings: state.bookings.length,
        events: state.events.length,
        status: state.bookings[0].status,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: API killed and restarted; same session and receipt, one booking, one payment event.",
  );
} finally {
  await stop();
}
