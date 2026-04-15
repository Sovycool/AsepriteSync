"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { filesApi, type FileRecord, type LockResult } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { toast } from "@/hooks/use-toast";

const qk = (projectId: string) => ["files", projectId];

export function useFiles(projectId: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: qk(projectId),
    queryFn: () => filesApi.list(accessToken!, projectId),
    enabled: !!accessToken && !!projectId,
  });
}

export function useUploadFile(projectId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => filesApi.upload(accessToken!, projectId, file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk(projectId) });
    },
  });
}

export function useUpdateFile(projectId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, file }: { fileId: string; file: File }) =>
      filesApi.update(accessToken!, fileId, file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk(projectId) });
    },
  });
}

export function useDeleteFile(projectId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => filesApi.delete(accessToken!, fileId),
    onSuccess: (_: void, fileId: string) => {
      qc.setQueryData<FileRecord[]>(qk(projectId), (old) =>
        old ? old.filter((f) => f.id !== fileId) : [],
      );
    },
  });
}

export function useLockFile(projectId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (fileId: string) => filesApi.lock(accessToken!, fileId),
    onSuccess: (result: LockResult) => {
      qc.setQueryData<FileRecord[]>(qk(projectId), (old) =>
        old?.map((f) =>
          f.id === result.fileId
            ? { ...f, lockedBy: result.lockedBy, lockExpiresAt: result.lockExpiresAt }
            : f,
        ),
      );
    },
    onError: (err: Error) => {
      toast({ title: "Lock failed", description: err.message, variant: "destructive", });
    },
  });
}

export function useUnlockFile(projectId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (fileId: string) => filesApi.unlock(accessToken!, fileId),
    onSuccess: (result: LockResult) => {
      qc.setQueryData<FileRecord[]>(qk(projectId), (old) =>
        old?.map((f) =>
          f.id === result.fileId
            ? { ...f, lockedBy: null, lockExpiresAt: null }
            : f,
        ),
      );
    },
    onError: (err: Error) => {
      toast({ title: "Unlock failed", description: err.message, variant: "destructive" });
    },
  });
}

export function useDownloadFile() {
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: ({ fileId, filename }: { fileId: string; filename: string }) =>
      filesApi.download(accessToken!, fileId, filename),
  });
}
