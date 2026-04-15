"use client";

import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadZoneProps {
  onUpload: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}

const ACCEPTED = [".aseprite", ".ase"];

function isAccepted(file: File): boolean {
  return ACCEPTED.some((ext) => file.name.toLowerCase().endsWith(ext));
}

export function UploadZone({ onUpload, disabled, className }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || disabled) return;
      const accepted = Array.from(files).filter(isAccepted);
      if (accepted.length > 0) onUpload(accepted);
    },
    [onUpload, disabled],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };

  const onDragLeave = () => setDragging(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload Aseprite files"
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && !disabled && inputRef.current?.click()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 px-6 py-10 text-center transition-colors",
        dragging && "border-primary bg-primary/5",
        disabled && "cursor-not-allowed opacity-50",
        !disabled && !dragging && "hover:border-muted-foreground/60 hover:bg-muted/30",
        className,
      )}
    >
      <Upload className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">Drop .aseprite / .ase files here</p>
      <p className="text-xs text-muted-foreground">or click to browse</p>
      <input
        ref={inputRef}
        type="file"
        accept=".aseprite,.ase"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
