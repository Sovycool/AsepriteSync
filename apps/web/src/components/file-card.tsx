"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreVertical, Download, Trash2, Lock, Unlock, RefreshCw } from "lucide-react";
import { type FileRecord } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileCardProps {
  file: FileRecord;
  currentUserId: string;
  projectId: string;
  onDownload: () => void;
  onDelete: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onReplace: () => void;
}

export function FileCard({
  file,
  currentUserId,
  projectId,
  onDownload,
  onDelete,
  onLock,
  onUnlock,
  onReplace,
}: FileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const isLockedByMe = file.lockedBy === currentUserId;
  const isLockedByOther = !!file.lockedBy && !isLockedByMe;

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg border bg-card p-4 transition-shadow hover:shadow-md",
        isLockedByOther && "border-destructive/50",
        isLockedByMe && "border-primary/50",
      )}
    >
      {/* Lock badge */}
      {file.lockedBy && (
        <span
          className={cn(
            "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            isLockedByMe
              ? "bg-primary/10 text-primary"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {isLockedByMe ? "Locked by you" : "Locked"}
        </span>
      )}

      {/* Icon placeholder — click goes to detail page */}
      <Link href={`/projects/${projectId}/files/${file.id}`}>
        <div className="flex h-24 items-center justify-center rounded-md bg-muted text-4xl hover:bg-muted/80 transition-colors">
          🎨
        </div>
      </Link>

      {/* Name */}
      <Link
        href={`/projects/${projectId}/files/${file.id}`}
        className="truncate text-sm font-medium hover:underline"
        title={file.name}
      >
        {file.name}
      </Link>

      {/* Meta */}
      <p className="text-xs text-muted-foreground">
        {new Date(file.updatedAt).toLocaleDateString()}
      </p>

      {/* Actions */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute bottom-3 right-3 h-7 w-7 opacity-0 group-hover:opacity-100"
            aria-label="File actions"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onReplace} disabled={isLockedByOther}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Replace
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isLockedByMe ? (
            <DropdownMenuItem onClick={onUnlock}>
              <Unlock className="mr-2 h-4 w-4" />
              Unlock
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onLock} disabled={isLockedByOther}>
              <Lock className="mr-2 h-4 w-4" />
              Lock
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            disabled={isLockedByOther}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
