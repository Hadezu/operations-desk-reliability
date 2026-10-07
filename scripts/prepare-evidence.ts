import { readFile, writeFile, mkdir } from "node:fs/promises";
import { sourceHash } from "./source.js";
const empty = {
  generatedAt: null,
  environment: "Not verified for this source",
  commit: null,
  dirty: true,
  sourceHash: null,
  ciUrl: null,
  sourceUrl: null,
  checks: [],
};
let output = empty;
try {
  const saved = JSON.parse(await readFile("evidence/manifest.json", "utf8"));
  if (saved.sourceHash === (await sourceHash())) {
    output = saved;
    try {
      const deployment = JSON.parse(
        await readFile("evidence/deployment.json", "utf8"),
      );
      if (
        deployment.sourceHash === saved.sourceHash &&
        deployment.status === "passed"
      ) {
        const check = saved.checks.find(
          (entry: { name: string }) =>
            entry.name === "Public Cloudflare deployment",
        );
        if (check)
          Object.assign(check, {
            status: "passed",
            observed: `HTTPS API and desktop/mobile journeys passed at ${deployment.generatedAt}; restricted Neon role verified. Cloudflare CPU p95 ${deployment.cpu.p95Ms} ms, max ${deployment.cpu.maxMs} ms over ${deployment.cpu.samples} sampled invocations, all successful. Tested version ${deployment.testedVersion}.`,
          source: "scripts/record-deployment.ts",
        });
        saved.deployment = deployment;
      }
    } catch {
      /* Public deployment evidence is optional for local/CI builds. */
    }
  }
} catch {
  /* Fresh checkout has no evidence until tests execute. */
}
await mkdir("apps/web/public", { recursive: true });
await writeFile(
  "apps/web/public/proof.json",
  JSON.stringify(output, null, 2) + "\n",
);
