"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { versionsApi, filesApi } from "@/lib/api";
import { useAuth } from "@/contexts/auth";

const qk = (fileId: string) => ["versions", fileId];

export function useVersions(fileId: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: qk(fileId),
    queryFn: () => versionsApi.list(accessToken!, fileId),
    enabled: !!accessToken && !!fileId,
  });
}

export function useRestoreVersion(projectId: string, fileId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionNumber: number) =>
      versionsApi.restore(accessToken!, fileId, versionNumber),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk(fileId) });
      void qc.invalidateQueries({ queryKey: ["files", projectId] });
    },
  });
}

/**
 * Fetches the preview thumbnail for a file and returns a stable blob URL.
 * Automatically revokes the URL when the component unmounts or fileId changes.
 */
export function useFilePreview(fileId: string) {
  const { accessToken } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!accessToken || !fileId) return;

    let revoked = false;
    let url: string | null = null;

    filesApi
      .preview(accessToken, fileId)
      .then((u) => {
        if (revoked) {
          URL.revokeObjectURL(u);
        } else {
          url = u;
          setBlobUrl(u);
        }
      })
      .catch(() => {
        if (!revoked) setError(true);
      });

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
      setBlobUrl(null);
      setError(false);
    };
  }, [accessToken, fileId]);

  return { blobUrl, error };
}
