"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type UserProfile } from "@/lib/api";
import { useAuth } from "@/contexts/auth";

export function useMe() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => usersApi.me(accessToken!),
    enabled: !!accessToken,
  });
}

export function useUpdateMe() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { username?: string; avatarUrl?: string | null }) =>
      usersApi.updateMe(accessToken!, input),
    onSuccess: (profile: UserProfile) => {
      qc.setQueryData<UserProfile>(["me"], profile);
    },
  });
}
