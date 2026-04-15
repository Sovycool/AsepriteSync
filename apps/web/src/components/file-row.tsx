"use client";

import Link from "next/link";
import { Download, Trash2, Lock, Unlock, RefreshCw } from "lucide-react";
import { type FileRecord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileRowProps {
  file: FileRecord;
  currentUserId: string;
  projectId: string;
  onDownload: () => void;
  onDelete: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onReplace: () => void;
}

export function FileRow({
  file,
  currentUserId,
  projectId,
  onDownload,
  onDelete,
  onLock,
  onUnlock,
  onReplace,
}: FileRowProps) {
  const isLockedByMe = file.lockedBy === currentUserId;
  const isLockedByOther = !!file.lockedBy && !isLockedByMe;

  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-lg border bg-card px-4 py-3 transition-shadow hover:shadow-sm",
        isLockedByOther && "border-destructive/50",
        isLockedByMe && "border-primary/50",
      )}
    >
      <span className="text-2xl">🎨</span>

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/projects/${projectId}/files/${file.id}`}
          className="truncate text-sm font-medium hover:underline"
          title={file.name}
        >
          {file.name}
        </Link>
        <p className="text-xs text-muted-foreground">
          {new Date(file.updatedAt).toLocaleDateString()}
        </p>
      </div>

      {/* Lock badge */}
      {file.lockedBy && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            isLockedByMe
              ? "bg-primary/10 text-primary"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {isLockedByMe ? "Locked by you" : "Locked"}
        </span>
      )}

      {/* Action buttons */}
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDownload} title="Download">
          <Download className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onReplace}
          disabled={isLockedByOther}
          title="Replace"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        {isLockedByMe ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onUnlock} title="Unlock">
            <Unlock className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onLock}
            disabled={isLockedByOther}
            title="Lock"
          >
            <Lock className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={isLockedByOther}
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
