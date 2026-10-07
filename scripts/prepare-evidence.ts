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
  if (saved.sourceHash === (await sourceHash())) output = saved;
} catch {
  /* Fresh checkout has no evidence until tests execute. */
}
await mkdir("apps/web/public", { recursive: true });
await writeFile(
  "apps/web/public/proof.json",
  JSON.stringify(output, null, 2) + "\n",
);
