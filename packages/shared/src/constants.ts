// Shared constants used by both server and web.

export const MAX_FILE_SIZE_MB = 50;
export const MAX_VERSIONS_PER_FILE = 50;
export const LOCK_DURATION_MINUTES = 30;
export const LOCK_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 min
export const PREVIEW_SIZE_PX = 256;
export const CURSOR_PAGE_LIMIT = 50;

export const ROLE_HIERARCHY = {
  owner: 3,
  editor: 2,
  viewer: 1,
} as const satisfies Record<string, number>;
