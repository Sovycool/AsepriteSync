import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebSocket } from "ws";
import { WsServer } from "../../lib/ws-server.js";

// ---------------------------------------------------------------------------
// Minimal WebSocket mock — only the bits WsServer uses
// ---------------------------------------------------------------------------

function makeMockWs(readyState: number = WebSocket.OPEN): WebSocket {
  return {
    readyState,
    send: vi.fn(),
  } as unknown as WebSocket;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WsServer", () => {
  let srv: WsServer;

  beforeEach(() => {
    srv = new WsServer();
  });

  // -------------------------------------------------------------------------
  describe("addClient / removeClient", () => {
    it("tracks connected clients", () => {
      const ws = makeMockWs();
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: null });
      expect(srv.clientCount).toBe(1);
    });

    it("removes client and decrements count", () => {
      const ws = makeMockWs();
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: null });
      srv.removeClient(ws);
      expect(srv.clientCount).toBe(0);
    });

    it("removing unknown client is a no-op", () => {
      expect(() => srv.removeClient(makeMockWs())).not.toThrow();
    });

    it("removeClient cleans up rooms and broadcasts presence", () => {
      const ws = makeMockWs();
      const other = makeMockWs();
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: null });
      srv.addClient(other, { userId: "u2", username: "bob", activeFileId: null });
      srv.joinRoom(ws, "proj-1");
      srv.joinRoom(other, "proj-1");

      srv.removeClient(ws);

      // `other` should have received a presence:update after alice left
      expect(other.send).toHaveBeenCalledOnce();
      const firstCall = (other.send as ReturnType<typeof vi.fn>).mock.calls[0];
      const msg = JSON.parse(firstCall![0] as string) as unknown;
      expect((msg as { event: string }).event).toBe("presence:update");
    });
  });

  // -------------------------------------------------------------------------
  describe("joinRoom / leaveRoom", () => {
    it("adds client to room", () => {
      const ws = makeMockWs();
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: null });
      srv.joinRoom(ws, "proj-1");
      expect(srv.roomSize("proj-1")).toBe(1);
    });

    it("tracks projectIds on client state", () => {
      const ws = makeMockWs();
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: null });
      srv.joinRoom(ws, "proj-1");
      srv.joinRoom(ws, "proj-2");
      expect(srv.getClientState(ws)?.projectIds.size).toBe(2);
    });

    it("leaveRoom decrements room size", () => {
      const ws = makeMockWs();
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: null });
      srv.joinRoom(ws, "proj-1");
      srv.leaveRoom(ws, "proj-1");
      expect(srv.roomSize("proj-1")).toBe(0);
    });

    it("empty room is cleaned up after last member leaves", () => {
      const ws = makeMockWs();
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: null });
      srv.joinRoom(ws, "proj-1");
      srv.leaveRoom(ws, "proj-1");
      expect(srv.roomCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("broadcast", () => {
    it("sends JSON to all OPEN clients in the room", () => {
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      srv.addClient(ws1, { userId: "u1", username: "alice", activeFileId: null });
      srv.addClient(ws2, { userId: "u2", username: "bob", activeFileId: null });
      srv.joinRoom(ws1, "proj-1");
      srv.joinRoom(ws2, "proj-1");

      srv.broadcast("proj-1", "file:deleted", { fileId: "f1" });

      expect(ws1.send).toHaveBeenCalledOnce();
      expect(ws2.send).toHaveBeenCalledOnce();
      const firstCall = (ws1.send as ReturnType<typeof vi.fn>).mock.calls[0];
      const msg = JSON.parse(firstCall![0] as string) as unknown;
      expect((msg as { event: string; payload: { fileId: string } }).event).toBe("file:deleted");
      expect((msg as { event: string; payload: { fileId: string } }).payload.fileId).toBe("f1");
    });

    it("respects the exclude parameter", () => {
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      srv.addClient(ws1, { userId: "u1", username: "alice", activeFileId: null });
      srv.addClient(ws2, { userId: "u2", username: "bob", activeFileId: null });
      srv.joinRoom(ws1, "proj-1");
      srv.joinRoom(ws2, "proj-1");

      srv.broadcast("proj-1", "file:deleted", { fileId: "f1" }, ws1);

      expect(ws1.send).not.toHaveBeenCalled();
      expect(ws2.send).toHaveBeenCalledOnce();
    });

    it("skips clients that are not OPEN", () => {
      const ws = makeMockWs(WebSocket.CLOSING);
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: null });
      srv.joinRoom(ws, "proj-1");

      srv.broadcast("proj-1", "file:deleted", { fileId: "f1" });

      expect(ws.send).not.toHaveBeenCalled();
    });

    it("is a no-op for unknown project rooms", () => {
      expect(() => srv.broadcast("no-room", "file:deleted", {})).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe("getPresence / broadcastPresence", () => {
    it("returns all users in a room", () => {
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      srv.addClient(ws1, { userId: "u1", username: "alice", activeFileId: null });
      srv.addClient(ws2, { userId: "u2", username: "bob", activeFileId: "f1" });
      srv.joinRoom(ws1, "proj-1");
      srv.joinRoom(ws2, "proj-1");

      const presence = srv.getPresence("proj-1");
      expect(presence).toHaveLength(2);
      expect(presence.find((u) => u.id === "u1")?.activeFileId).toBeNull();
      expect(presence.find((u) => u.id === "u2")?.activeFileId).toBe("f1");
    });

    it("returns empty array for unknown room", () => {
      expect(srv.getPresence("no-room")).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("updateActiveFile", () => {
    it("updates activeFileId on the client state", () => {
      const ws = makeMockWs();
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: null });
      srv.updateActiveFile(ws, "file-99");
      expect(srv.getClientState(ws)?.activeFileId).toBe("file-99");
    });

    it("can set activeFileId back to null", () => {
      const ws = makeMockWs();
      srv.addClient(ws, { userId: "u1", username: "alice", activeFileId: "file-1" });
      srv.updateActiveFile(ws, null);
      expect(srv.getClientState(ws)?.activeFileId).toBeNull();
    });

    it("is a no-op for unknown clients", () => {
      expect(() => srv.updateActiveFile(makeMockWs(), "f1")).not.toThrow();
    });
  });
});
