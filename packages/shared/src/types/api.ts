// API response envelope types.

export interface ApiResponse<T> {
  data: T;
  error: null;
  meta?: ApiMeta;
}

export interface ApiErrorResponse {
  data: null;
  error: ApiError;
  meta?: ApiMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiMeta {
  cursor?: string;
  hasMore?: boolean;
  total?: number;
}

export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;

// WebSocket event payloads
export interface WsEventFileLocked {
  fileId: string;
  userId: string;
  username: string;
  expiresAt: string;
}

export interface WsEventFileUnlocked {
  fileId: string;
}

export interface WsEventFileUpdated {
  fileId: string;
  version: number;
  userId: string;
  username: string;
}

export interface WsEventFileDeleted {
  fileId: string;
}

export interface WsEventFileUploaded {
  fileId: string;
  name: string;
  userId: string;
  username: string;
}

export interface WsEventMemberJoined {
  userId: string;
  username: string;
  role: string;
}

export interface WsEventMemberLeft {
  userId: string;
}

export interface WsEventPresenceUpdate {
  users: Array<{
    id: string;
    username: string;
    activeFileId: string | null;
  }>;
}

export type WsEventType =
  | "file:locked"
  | "file:unlocked"
  | "file:updated"
  | "file:deleted"
  | "file:uploaded"
  | "member:joined"
  | "member:left"
  | "presence:update"
  | "join:project";

export interface WsMessage<T = unknown> {
  event: WsEventType;
  payload: T;
}
