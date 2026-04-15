"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { MoreVertical, Download, Trash2, Lock, Unlock, RefreshCw, ImagePlus } from "lucide-react";
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
import { useFilePreview } from "@/hooks/use-files";

interface FileCardProps {
  file: FileRecord;
  currentUserId: string;
  projectId: string;
  onDownload: () => void;
  onDelete: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onReplace: () => void;
  onSetPreview: (imageFile: File) => void;
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
  onSetPreview,
}: FileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const previewInputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useFilePreview(file.id);

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
      {/* Hidden preview image input */}
      <input
        ref={previewInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSetPreview(f);
          e.target.value = "";
        }}
      />

      {/* Lock badge */}
      {file.lockedBy && (
        <span
          className={cn(
            "absolute right-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            isLockedByMe
              ? "bg-primary/10 text-primary"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {isLockedByMe ? "Locked by you" : "Locked"}
        </span>
      )}

      {/* Thumbnail — click goes to detail page */}
      <Link href={`/projects/${projectId}/files/${file.id}`}>
        <div className="relative flex h-24 items-center justify-center overflow-hidden rounded-md bg-muted hover:bg-muted/80 transition-colors">
          {previewUrl ? (
            // object-cover crops overflow while preserving aspect ratio;
            // image-rendering: pixelated keeps pixel art sharp at any size
            <img
              src={previewUrl}
              alt={file.name}
              className="h-full w-full object-cover"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="text-4xl">🎨</span>
          )}
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
          <DropdownMenuItem onClick={() => previewInputRef.current?.click()}>
            <ImagePlus className="mr-2 h-4 w-4" />
            Set Preview
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
