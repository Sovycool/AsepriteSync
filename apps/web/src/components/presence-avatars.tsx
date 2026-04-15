"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { PresenceUser } from "@/contexts/ws";
import { cn } from "@/lib/utils";

interface PresenceAvatarsProps {
  users: PresenceUser[];
  currentUserId?: string;
  max?: number;
}

export function PresenceAvatars({ users, currentUserId, max = 5 }: PresenceAvatarsProps) {
  if (users.length === 0) return null;

  const others = users.filter((u) => u.id !== currentUserId);
  const visible = others.slice(0, max);
  const overflow = others.length - visible.length;

  return (
    <div className="flex items-center gap-1" aria-label="Online members">
      {visible.map((u) => (
        <Avatar
          key={u.id}
          className="h-7 w-7 ring-2 ring-background"
          title={u.username + (u.activeFileId ? " (editing)" : " (online)")}
        >
          <AvatarFallback
            className={cn(
              "text-[10px]",
              u.activeFileId ? "bg-primary/20 text-primary" : "bg-muted",
            )}
          >
            {u.username.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 && (
        <span className="ml-1 text-xs text-muted-foreground">+{overflow}</span>
      )}
    </div>
  );
}
