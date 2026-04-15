"use client";

import { useQuery } from "@tanstack/react-query";
import { activityApi } from "@/lib/api";
import { useAuth } from "@/contexts/auth";

export function useActivity() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["activity"],
    queryFn: () => activityApi.list(accessToken!),
    enabled: !!accessToken,
    staleTime: 30_000,
  });
}
