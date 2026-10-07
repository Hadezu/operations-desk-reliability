import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const ignored = new Set([
  "node_modules",
  ".next",
  "out",
  ".generated",
  ".local",
  ".wrangler",
  ".cloudflare-build",
  "next-env.d.ts",
  "proof.json",
]);
export async function sourceHash() {
  const files: string[] = [];
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name.endsWith(".tsbuildinfo"))
        continue;
      const name = join(path, entry.name);
      if (entry.isDirectory()) await walk(name);
      else files.push(name);
    }
  }
  for (const dir of [
    "apps",
    "packages",
    "prisma",
    "scripts",
    "tests",
    ".github",
  ])
    await walk(dir);
  files.push(
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "prisma.config.ts",
    "vitest.config.ts",
    "playwright.config.ts",
    "wrangler.jsonc",
    "Dockerfile",
    "compose.yaml",
  );
  const digest = createHash("sha256");
  for (const file of files.sort()) {
    digest.update(file.replaceAll("\\", "/"));
    digest.update("\0");
    digest.update((await readFile(file, "utf8")).replaceAll("\r\n", "\n"));
    digest.update("\0");
  }
  return digest.digest("hex");
}
