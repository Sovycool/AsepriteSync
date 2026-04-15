"use client";

import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { LayoutGrid, List, ArrowLeft, Plus } from "lucide-react";
import { useFiles, useUploadFile, useUpdateFile, useDeleteFile, useLockFile, useUnlockFile, useDownloadFile, useSetPreview } from "@/hooks/use-files";
import { useProjects } from "@/hooks/use-projects";
import { useAuth } from "@/contexts/auth";
import { useProjectPresence } from "@/contexts/ws";
import { UploadZone } from "@/components/upload-zone";
import { FileCard } from "@/components/file-card";
import { FileRow } from "@/components/file-row";
import { PresenceAvatars } from "@/components/presence-avatars";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { FileRecord } from "@/lib/api";
import Link from "next/link";

type ViewMode = "grid" | "list";

// Hidden file input used for "replace" — we open it imperatively
function ReplaceInput({
  inputRef,
  onFile,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  onFile: (file: File) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".aseprite,.ase"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onFile(file);
        // reset so the same file can be re-selected
        e.target.value = "";
      }}
    />
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [view, setView] = useState<ViewMode>("grid");
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === id);

  const presenceUsers = useProjectPresence(id);

  const { data: files, isLoading } = useFiles(id);
  const upload = useUploadFile(id);
  const update = useUpdateFile(id);
  const deleteMut = useDeleteFile(id);
  const lock = useLockFile(id);
  const unlock = useUnlockFile(id);
  const download = useDownloadFile();
  const setPreview = useSetPreview(id);

  const currentUserId = user?.id ?? "";

  function handleUpload(uploadedFiles: File[]) {
    for (const file of uploadedFiles) {
      upload.mutate(file);
    }
  }

  function handleReplace(file: FileRecord) {
    setReplacingFileId(file.id);
    replaceInputRef.current?.click();
  }

  function onReplaceFile(file: File) {
    if (!replacingFileId) return;
    update.mutate({ fileId: replacingFileId, file });
    setReplacingFileId(null);
  }

  const sharedProps = (file: FileRecord) => ({
    file,
    currentUserId,
    projectId: id,
    onDownload: () => download.mutate({ fileId: file.id, filename: file.name }),
    onDelete: () => deleteMut.mutate(file.id),
    onLock: () => lock.mutate(file.id),
    onUnlock: () => unlock.mutate(file.id),
    onReplace: () => handleReplace(file),
    onSetPreview: (imageFile: File) => setPreview.mutate({ fileId: file.id, imageFile }),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/projects">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">
            {project?.name ?? "Project"}
          </h1>
          {project?.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
        {/* Online presence */}
        <PresenceAvatars users={presenceUsers} currentUserId={currentUserId} />

        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-lg border p-1">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setView("grid")}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setView("list")}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Upload zone */}
      <UploadZone
        onUpload={handleUpload}
        disabled={upload.isPending}
        className="max-h-36"
      />

      {/* Hidden replace input */}
      <ReplaceInput inputRef={replaceInputRef} onFile={onReplaceFile} />

      {/* File list */}
      {isLoading ? (
        <div
          className={cn(
            view === "grid"
              ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              : "flex flex-col gap-2",
          )}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className={view === "grid" ? "h-48 rounded-lg" : "h-16 rounded-lg"} />
          ))}
        </div>
      ) : !files || files.length === 0 ? (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-2 text-muted-foreground">
          <Plus className="h-8 w-8" />
          <p className="text-sm">No files yet — drop some above to get started.</p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {files.map((file) => (
            <FileCard key={file.id} {...sharedProps(file)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {files.map((file) => (
            <FileRow key={file.id} {...sharedProps(file)} />
          ))}
        </div>
      )}
    </div>
  );
}
