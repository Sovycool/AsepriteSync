import { WebSocket } from "ws";
import type { WsEventType } from "@asepritesync/shared";

export interface ClientState {
  userId: string;
  username: string;
  activeFileId: string | null;
  /** Projects the client has joined (for presence broadcasts). */
  projectIds: Set<string>;
}

/**
 * In-memory WebSocket room manager.
 *
 * Responsibilities:
 *  - Track connected clients and their state
 *  - Maintain project → client rooms
 *  - Broadcast typed messages to rooms
 *  - Provide presence snapshots
 */
export class WsServer {
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly rooms = new Map<string, Set<WebSocket>>();

  // -------------------------------------------------------------------------
  // Client lifecycle
  // -------------------------------------------------------------------------

  addClient(ws: WebSocket, state: Omit<ClientState, "projectIds">): void {
    this.clients.set(ws, { ...state, projectIds: new Set() });
  }

  removeClient(ws: WebSocket): void {
    const state = this.clients.get(ws);
    if (!state) return;
    this.clients.delete(ws);
    for (const projectId of state.projectIds) {
      const room = this.rooms.get(projectId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) this.rooms.delete(projectId);
        this.broadcastPresence(projectId);
      }
    }
  }

  getClientState(ws: WebSocket): ClientState | undefined {
    return this.clients.get(ws);
  }

  // -------------------------------------------------------------------------
  // Room management
  // -------------------------------------------------------------------------

  joinRoom(ws: WebSocket, projectId: string): void {
    let room = this.rooms.get(projectId);
    if (!room) {
      room = new Set();
      this.rooms.set(projectId, room);
    }
    room.add(ws);
    const state = this.clients.get(ws);
    if (state) state.projectIds.add(projectId);
  }

  leaveRoom(ws: WebSocket, projectId: string): void {
    const room = this.rooms.get(projectId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) this.rooms.delete(projectId);
    }
    this.clients.get(ws)?.projectIds.delete(projectId);
  }

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  broadcast<T>(projectId: string, event: WsEventType, payload: T, exclude?: WebSocket): void {
    const room = this.rooms.get(projectId);
    if (!room) return;
    const msg = JSON.stringify({ event, payload });
    for (const client of room) {
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  broadcastPresence(projectId: string): void {
    this.broadcast(projectId, "presence:update", { projectId, users: this.getPresence(projectId) });
  }

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  updateActiveFile(ws: WebSocket, activeFileId: string | null): void {
    const state = this.clients.get(ws);
    if (state) state.activeFileId = activeFileId;
  }

  getPresence(projectId: string): Array<{ id: string; username: string; activeFileId: string | null }> {
    const room = this.rooms.get(projectId);
    if (!room) return [];
    const result: Array<{ id: string; username: string; activeFileId: string | null }> = [];
    for (const ws of room) {
      const state = this.clients.get(ws);
      if (state) result.push({ id: state.userId, username: state.username, activeFileId: state.activeFileId });
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  get clientCount(): number { return this.clients.size; }
  get roomCount(): number { return this.rooms.size; }
  roomSize(projectId: string): number { return this.rooms.get(projectId)?.size ?? 0; }
}

/** Module-level singleton — import this in services and the WS handler. */
export const wsServer = new WsServer();
