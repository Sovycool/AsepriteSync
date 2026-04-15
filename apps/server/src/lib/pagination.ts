/**
 * Cursor-based pagination helpers.
 * Cursor = base64url-encoded ISO 8601 timestamp of the last item's createdAt.
 */

export function encodeCursor(date: Date): string {
  return Buffer.from(date.toISOString()).toString("base64url");
}

export function decodeCursor(cursor: string): Date {
  return new Date(Buffer.from(cursor, "base64url").toString("utf8"));
}

export interface PageInfo {
  cursor: string | null;
  hasMore: boolean;
}

/**
 * Given a result set fetched with `limit + 1`, trims the extra item and
 * returns the pagination metadata.
 */
export function paginate<T extends { createdAt: Date }>(
  items: T[],
  limit: number,
): { items: T[]; pageInfo: PageInfo } {
  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const last = trimmed.at(-1);
  return {
    items: trimmed,
    pageInfo: {
      cursor: last !== undefined ? encodeCursor(last.createdAt) : null,
      hasMore,
    },
  };
}
