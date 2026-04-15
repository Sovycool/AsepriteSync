"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { filesApi, type FileRecord } from "@/lib/api";
import { useAuth } from "@/contexts/auth";

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk(projectId) });
    },
  });
}

export function useUnlockFile(projectId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => filesApi.unlock(accessToken!, fileId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk(projectId) });
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
