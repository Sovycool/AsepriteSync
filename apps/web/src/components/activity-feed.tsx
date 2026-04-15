"use client";

import {
  Upload, RefreshCw, Trash2, Lock, Unlock, History,
  UserPlus, UserMinus, FolderPlus, Pencil, FolderX, Users,
} from "lucide-react";
import type { ActivityLog } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

// Map action → icon + human-readable text
const ACTION_META: Record<string, { icon: React.ElementType; label: string }> = {
  "file:uploaded":         { icon: Upload,     label: "uploaded a file" },
  "file:updated":          { icon: RefreshCw,  label: "updated a file" },
  "file:deleted":          { icon: Trash2,     label: "deleted a file" },
  "file:locked":           { icon: Lock,       label: "locked a file" },
  "file:unlocked":         { icon: Unlock,     label: "unlocked a file" },
  "file:restored":         { icon: History,    label: "restored a version" },
  "member:joined":         { icon: UserPlus,   label: "joined the project" },
  "member:left":           { icon: UserMinus,  label: "left the project" },
  "member:role_changed":   { icon: Users,      label: "changed a member's role" },
  "project:created":       { icon: FolderPlus, label: "created the project" },
  "project:updated":       { icon: Pencil,     label: "updated the project" },
  "project:deleted":       { icon: FolderX,    label: "deleted the project" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)   return "just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  logs: ActivityLog[];
  isLoading: boolean;
}

export function ActivityFeed({ logs, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No activity yet. Upload your first file to get started.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {logs.map((log) => {
        const meta = ACTION_META[log.action] ?? { icon: Pencil, label: log.action };
        const Icon = meta.icon;
        const filename =
          typeof log.metadata?.name === "string" ? log.metadata.name : null;

        return (
          <li key={log.id} className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm leading-tight">
                <span className="font-medium">{log.userId.slice(0, 8)}</span>
                {" "}{meta.label}
                {filename && (
                  <> &mdash; <span className="font-mono text-xs">{filename}</span></>
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{relativeTime(log.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
