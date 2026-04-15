"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { membersApi, type ProjectMember } from "@/lib/api";
import { useAuth } from "@/contexts/auth";

const qk = (projectId: string) => ["members", projectId];

export function useMembers(projectId: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: qk(projectId),
    queryFn: () => membersApi.list(accessToken!, projectId),
    enabled: !!accessToken && !!projectId,
  });
}

export function useInviteMember(projectId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: "editor" | "viewer" }) =>
      membersApi.invite(accessToken!, projectId, input),
    onSuccess: (member: ProjectMember) => {
      qc.setQueryData<ProjectMember[]>(qk(projectId), (old) =>
        old ? [...old, member] : [member],
      );
    },
  });
}

export function useUpdateMemberRole(projectId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "editor" | "viewer" }) =>
      membersApi.updateRole(accessToken!, projectId, userId, role),
    onSuccess: (_: void, { userId, role }) => {
      qc.setQueryData<ProjectMember[]>(qk(projectId), (old) =>
        old ? old.map((m) => (m.userId === userId ? { ...m, role } : m)) : [],
      );
    },
  });
}

export function useRemoveMember(projectId: string) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => membersApi.remove(accessToken!, projectId, userId),
    onSuccess: (_: void, userId: string) => {
      qc.setQueryData<ProjectMember[]>(qk(projectId), (old) =>
        old ? old.filter((m) => m.userId !== userId) : [],
      );
    },
  });
}
