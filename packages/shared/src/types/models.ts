// Domain model types shared across server and web.

export type UserRole = "owner" | "editor" | "viewer";

export type ActivityAction =
  | "file:uploaded"
  | "file:updated"
  | "file:deleted"
  | "file:locked"
  | "file:unlocked"
  | "file:restored"
  | "member:joined"
  | "member:left"
  | "member:role_changed"
  | "project:created"
  | "project:updated"
  | "project:deleted";

export interface User {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: UserRole;
  createdAt: string;
  user?: Pick<User, "id" | "username" | "avatarUrl">;
}

export interface File {
  id: string;
  projectId: string;
  name: string;
  path: string;
  currentVersionId: string | null;
  lockedBy: string | null;
  lockExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileVersion {
  id: string;
  fileId: string;
  versionNumber: number;
  authorId: string;
  hashSha256: string;
  sizeBytes: number;
  storagePath: string;
  previewPath: string | null;
  isPinned: boolean;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  projectId: string;
  action: ActivityAction;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
