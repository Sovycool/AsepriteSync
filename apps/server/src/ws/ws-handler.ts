import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { eq, and } from "drizzle-orm";
import type { Database } from "@asepritesync/db";
import { users, projectMembers } from "@asepritesync/db";
import type { WsMessage } from "@asepritesync/shared";
import { verifyAccessToken } from "../lib/jwt.js";
import { wsServer } from "../lib/ws-server.js";

// ---------------------------------------------------------------------------
// Singleton WebSocket server (noServer = we handle the upgrade ourselves)
// ---------------------------------------------------------------------------

export const wss = new WebSocketServer({ noServer: true });

// ---------------------------------------------------------------------------
// Upgrade handler — attached to Fastify's underlying http.Server
// ---------------------------------------------------------------------------

export function createWsUpgradeHandler(db: Database) {
  return function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    // Extract JWT from query string  (?token=<accessToken>)
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let userId: string;
    try {
      userId = verifyAccessToken(token).userId;
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      void onConnect(db, ws, userId);
    });
  };
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

async function onConnect(db: Database, ws: WebSocket, userId: string): Promise<void> {
  const [user] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    ws.close(4001, "User not found");
    return;
  }

  wsServer.addClient(ws, { userId: user.id, username: user.username, activeFileId: null });

  ws.on("message", (data) => {
    void onMessage(db, ws, data.toString());
  });

  ws.on("close", () => { wsServer.removeClient(ws); });
  ws.on("error", (err) => {
    console.error("[ws] client error:", err);
    wsServer.removeClient(ws);
  });
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

async function onMessage(db: Database, ws: WebSocket, raw: string): Promise<void> {
  let msg: WsMessage;
  try {
    msg = JSON.parse(raw) as WsMessage;
  } catch {
    send(ws, "error", { message: "Invalid JSON" });
    return;
  }

  const state = wsServer.getClientState(ws);
  if (!state) return;

  switch (msg.event) {
    case "join:project": {
      const payload = msg.payload as { projectId?: unknown };
      const projectId = payload?.projectId;
      if (typeof projectId !== "string") {
        send(ws, "error", { message: "join:project requires { projectId: string }" });
        return;
      }

      // Verify the user is a member of this project
      const [member] = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, state.userId),
          ),
        )
        .limit(1);

      if (!member) {
        send(ws, "error", { message: "Not a member of this project" });
        return;
      }

      wsServer.joinRoom(ws, projectId);
      // Send current presence to the newcomer and notify existing members
      wsServer.broadcastPresence(projectId);
      break;
    }

    case "presence:update": {
      const payload = msg.payload as { activeFileId?: unknown };
      const activeFileId = payload?.activeFileId;
      wsServer.updateActiveFile(ws, typeof activeFileId === "string" ? activeFileId : null);
      // Notify all rooms this client participates in
      for (const projectId of state.projectIds) {
        wsServer.broadcastPresence(projectId);
      }
      break;
    }

    default:
      // Unknown client→server events are silently ignored
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(ws: WebSocket, event: string, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, payload }));
  }
}
