import { writeFile, mkdir } from "node:fs/promises";
import { openApiDocument } from "../packages/contracts/index.js";
await mkdir("docs", { recursive: true });
await writeFile(
  "docs/openapi.json",
  JSON.stringify(openApiDocument(), null, 2) + "\n",
);
