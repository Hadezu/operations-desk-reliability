import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { handleApi, type HttpOptions } from "../../packages/core/http.js";

export async function buildServer(options: HttpOptions) {
  const app = Fastify({ bodyLimit: 16384, logger: false, trustProxy: false });
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  app.setErrorHandler((error, _request, reply) => {
    const value =
      error instanceof Error && "statusCode" in error ? error.statusCode : 500;
    const status =
      typeof value === "number" && value >= 400 && value < 500 ? value : 500;
    const requestId = crypto.randomUUID();
    const code =
      status === 429
        ? "RATE_LIMITED"
        : status === 413
          ? "BODY_TOO_LARGE"
          : status === 500
            ? "INTERNAL_ERROR"
            : "INVALID_REQUEST";
    reply
      .code(status)
      .header("cache-control", "no-store")
      .header("x-request-id", requestId)
      .send({
        error: {
          code,
          message:
            status === 429
              ? "Please wait before retrying."
              : "The request could not be processed.",
          requestId,
        },
      });
  });
  // The bootstrap endpoint allocates a private workspace. Limit it separately.
  app.post(
    "/api/demo",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    relay,
  );
  app.all("/api/*", relay);
  async function relay(req: FastifyRequest, reply: FastifyReply) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value !== undefined)
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const incoming = new Request(`${options.origin}${req.url}`, {
      method: req.method,
      headers,
      ...(!["GET", "HEAD"].includes(req.method) && req.body !== undefined
        ? { body: JSON.stringify(req.body) }
        : {}),
    });
    const result = await handleApi(incoming, options);
    reply.code(result.status);
    result.headers.forEach((value, key) => reply.header(key, value));
    return reply.send(await result.text());
  }
  return app;
}
