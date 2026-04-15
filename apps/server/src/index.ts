import { db } from "@asepritesync/db";
import { config } from "./config.js";
import { buildApp } from "./app.js";
import { startLockCleanupJob } from "./jobs/lock-cleanup.js";
import { createWsUpgradeHandler } from "./ws/ws-handler.js";

const app = await buildApp();

// Attach WebSocket upgrade handler to the underlying HTTP server
app.server.on("upgrade", createWsUpgradeHandler(db));

startLockCleanupJob(db);

await app.listen({ port: config.PORT, host: "0.0.0.0" });
