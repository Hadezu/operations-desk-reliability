import { createServer, request as proxy } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("apps/web/out");
const api = new URL(process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3101");
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
};
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) {
    const upstream = proxy(
      {
        hostname: api.hostname,
        port: api.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: api.host },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.setTimeout(20000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: "API_UNAVAILABLE",
            message: "The API is temporarily unavailable.",
          },
        }),
      );
    });
    req.pipe(upstream);
    return;
  }
  if (!["GET", "HEAD"].includes(req.method ?? "")) {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
    let path = resolve(root, `.${pathname}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw Error();
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    const info = await stat(path);
    res.writeHead(200, {
      "content-type": mime[extname(path)] ?? "application/octet-stream",
      "content-length": info.size,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "cache-control": pathname.startsWith("/_next/static/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(Number(process.env.WEB_PORT ?? 3100), "0.0.0.0", () =>
  console.log(
    "Static Next.js app ready on port " + (process.env.WEB_PORT ?? 3100),
  ),
);
process.once("SIGTERM", () => server.close());
process.once("SIGINT", () => server.close());
