"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth";
import { toast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresenceUser {
  id: string;
  username: string;
  activeFileId: string | null;
}

interface WsContextValue {
  /** Send join:project to the server. */
  joinProject: (projectId: string) => void;
  /** Send a presence:update for the active file. */
  updateActiveFile: (fileId: string | null) => void;
  /** Presence snapshot per project. */
  presence: Record<string, PresenceUser[]>;
  /** Whether the WS is currently connected. */
  connected: boolean;
}

const WsContext = createContext<WsContextValue>({
  joinProject: () => undefined,
  updateActiveFile: () => undefined,
  presence: {},
  connected: false,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WS_BASE =
  (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000").replace(
    /^http/,
    "ws",
  );

const MAX_BACKOFF = 30_000;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WsProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, loading } = useAuth();
  const qc = useQueryClient();

  const wsRef = useRef<WebSocket | null>(null);
  const pendingJoins = useRef<string[]>([]);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1_000);
  const unmountedRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<Record<string, PresenceUser[]>>({});

  // Send helper — safe if socket not ready
  const send = useCallback((event: string, payload: unknown) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, payload }));
    }
  }, []);

  const joinProject = useCallback(
    (projectId: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        send("join:project", { projectId });
      } else {
        // Queue for when the connection opens
        if (!pendingJoins.current.includes(projectId)) {
          pendingJoins.current.push(projectId);
        }
      }
    },
    [send],
  );

  const updateActiveFile = useCallback(
    (fileId: string | null) => {
      send("presence:update", { activeFileId: fileId });
    },
    [send],
  );

  // Handle incoming messages
  const handleMessage = useCallback(
    (raw: string) => {
      let msg: { event: string; payload: unknown };
      try {
        msg = JSON.parse(raw) as { event: string; payload: unknown };
      } catch {
        return;
      }

      const { event, payload } = msg;

      switch (event) {
        case "file:uploaded": {
          const p = payload as { fileId: string; name: string; username: string };
          void qc.invalidateQueries({ queryKey: ["files"] });
          toast({
            title: "File uploaded",
            description: `${p.username} uploaded "${p.name}"`,
          });
          break;
        }

        case "file:updated": {
          const p = payload as { fileId: string; version: number; username: string };
          void qc.invalidateQueries({ queryKey: ["files"] });
          void qc.invalidateQueries({ queryKey: ["versions", p.fileId] });
          toast({
            title: "File updated",
            description: `${p.username} pushed version ${p.version.toString()}`,
          });
          break;
        }

        case "file:deleted": {
          void qc.invalidateQueries({ queryKey: ["files"] });
          toast({ title: "File deleted", variant: "destructive" });
          break;
        }

        case "file:locked": {
          const p = payload as { fileId: string; username: string };
          void qc.invalidateQueries({ queryKey: ["files"] });
          toast({
            title: "File locked",
            description: `${p.username} locked the file`,
          });
          break;
        }

        case "file:unlocked": {
          void qc.invalidateQueries({ queryKey: ["files"] });
          toast({ title: "File unlocked", variant: "success" });
          break;
        }

        case "presence:update": {
          const p = payload as { projectId: string; users: PresenceUser[] };
          if (p.projectId) {
            setPresence((prev) => ({ ...prev, [p.projectId]: p.users }));
          }
          break;
        }

        default:
          break;
      }
    },
    [qc],
  );

  // Connect / reconnect logic
  useEffect(() => {
    // Wait for the initial refresh to complete before connecting.
    // This ensures we never try to connect with a potentially stale
    // sessionStorage token that may already be expired.
    if (loading || !accessToken) return;
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;

      const ws = new WebSocket(`${WS_BASE}/?token=${encodeURIComponent(accessToken!)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) { ws.close(); return; }
        backoffRef.current = 1_000;
        setConnected(true);
        // Flush pending joins
        for (const projectId of pendingJoins.current) {
          ws.send(JSON.stringify({ event: "join:project", payload: { projectId } }));
        }
        pendingJoins.current = [];
      };

      ws.onmessage = (e) => handleMessage(e.data as string);

      ws.onclose = () => {
        setConnected(false);
        if (unmountedRef.current) return;
        // Exponential backoff reconnect
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF);
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [accessToken, loading, handleMessage]);

  return (
    <WsContext.Provider value={{ joinProject, updateActiveFile, presence, connected }}>
      {children}
    </WsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useWs() {
  return useContext(WsContext);
}

/**
 * Join a project room on mount and get its presence.
 * Sends leave (via disconnect) automatically on unmount.
 */
export function useProjectPresence(projectId: string): PresenceUser[] {
  const { joinProject, presence } = useWs();

  useEffect(() => {
    if (projectId) joinProject(projectId);
  }, [projectId, joinProject]);

  return presence[projectId] ?? [];
}
