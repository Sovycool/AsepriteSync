// AsepriteSync — Fastify server entry point.
// Full implementation starts at T3.

import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/healthz", async () => ({ status: "ok" }));

const port = Number(process.env["PORT"] ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
