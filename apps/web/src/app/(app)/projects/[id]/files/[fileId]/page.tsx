"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, Lock, Unlock, RotateCcw, Clock, Hash, HardDrive, Layers } from "lucide-react";
import { useFiles, useLockFile, useUnlockFile, useDownloadFile } from "@/hooks/use-files";
import { useVersions, useRestoreVersion, useFilePreview } from "@/hooks/use-versions";
import { useProject } from "@/hooks/use-projects";
import { useAuth } from "@/contexts/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { FileVersion } from "@/lib/api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ---------------------------------------------------------------------------
// Preview panel
// ---------------------------------------------------------------------------

function PreviewPanel({ fileId }: { fileId: string }) {
  const { blobUrl, error } = useFilePreview(fileId);

  if (error) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-lg bg-muted text-5xl">
        🎨
      </div>
    );
  }

  if (!blobUrl) {
    return <Skeleton className="h-48 w-full rounded-lg" />;
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-lg border bg-muted/30">
      <Image
        src={blobUrl}
        alt="File preview"
        fill
        className="object-contain"
        unoptimized
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version row
// ---------------------------------------------------------------------------

function VersionRow({
  version,
  isCurrent,
  onRestore,
  restoring,
}: {
  version: FileVersion;
  isCurrent: boolean;
  onRestore: () => void;
  restoring: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-lg border bg-card px-4 py-3",
        isCurrent && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
        v{version.versionNumber}
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">
          Version {version.versionNumber}
          {isCurrent && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              current
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDate(version.createdAt)}
          </span>
          <span className="flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            {formatBytes(version.sizeBytes)}
          </span>
          <span className="flex items-center gap-1 font-mono">
            <Hash className="h-3 w-3" />
            {version.hashSha256.slice(0, 8)}
          </span>
        </div>
      </div>

      {!isCurrent && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onRestore}
          disabled={restoring}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Restore
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FileDetailPage() {
  const { id: projectId, fileId } = useParams<{ id: string; fileId: string }>();
  const { user } = useAuth();

  const { data: project } = useProject(projectId);
  const { data: files, isLoading: filesLoading } = useFiles(projectId);
  const { data: versions, isLoading: versionsLoading } = useVersions(fileId);
  const restore = useRestoreVersion(projectId, fileId);
  const lock = useLockFile(projectId);
  const unlock = useUnlockFile(projectId);
  const download = useDownloadFile();

  const file = files?.find((f) => f.id === fileId);
  const currentUserId = user?.id ?? "";
  const isLockedByMe = file?.lockedBy === currentUserId;
  const isLockedByOther = !!file?.lockedBy && !isLockedByMe;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/projects/${projectId}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          {filesLoading ? (
            <Skeleton className="h-7 w-48" />
          ) : (
            <h1 className="truncate text-2xl font-bold">{file?.name ?? "File"}</h1>
          )}
          {project && (
            <p className="text-sm text-muted-foreground">{project.name}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {isLockedByMe ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unlock.mutate(fileId)}
              disabled={unlock.isPending}
            >
              <Unlock className="mr-1.5 h-4 w-4" />
              Unlock
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => lock.mutate(fileId)}
              disabled={lock.isPending || isLockedByOther}
            >
              <Lock className="mr-1.5 h-4 w-4" />
              {isLockedByOther ? "Locked" : "Lock"}
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => file && download.mutate({ fileId: file.id, filename: file.name })}
            disabled={!file || download.isPending}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Download
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* Left: preview + metadata */}
        <div className="flex flex-col gap-4">
          <PreviewPanel fileId={fileId} />

          {/* Metadata */}
          {file && (
            <div className="rounded-lg border bg-card p-4 text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Lock status</span>
                <span className={cn(
                  "font-medium",
                  isLockedByMe && "text-primary",
                  isLockedByOther && "text-destructive",
                )}>
                  {isLockedByMe ? "Locked by you" : isLockedByOther ? "Locked by other" : "Unlocked"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" />
                  Versions
                </span>
                <span className="font-medium">{versions?.length ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span className="font-medium">{formatDate(file.updatedAt)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right: version history */}
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Version history</h2>

          {versionsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))
          ) : !versions || versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          ) : (
            versions.map((v) => (
              <VersionRow
                key={v.id}
                version={v}
                isCurrent={v.id === file?.currentVersionId}
                onRestore={() => restore.mutate(v.versionNumber)}
                restoring={restore.isPending}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
