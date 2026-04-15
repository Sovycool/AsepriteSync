"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi, type Project } from "@/lib/api";
import { useAuth } from "@/contexts/auth";

export function useProject(id: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => projectsApi.get(accessToken!, id),
    enabled: !!accessToken && !!id,
  });
}

export function useProjects() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list(accessToken!),
    enabled: !!accessToken,
  });
}

export function useCreateProject() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      projectsApi.create(accessToken!, input),
    onSuccess: (project: Project) => {
      qc.setQueryData<Project[]>(["projects"], (old) =>
        old ? [project, ...old] : [project],
      );
    },
  });
}

export function useUpdateProject() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; description?: string } }) =>
      projectsApi.update(accessToken!, id, input),
    onSuccess: (project: Project) => {
      qc.setQueryData<Project[]>(["projects"], (old) =>
        old ? old.map((p) => (p.id === project.id ? project : p)) : [],
      );
      qc.setQueryData<Project>(["projects", project.id], project);
    },
  });
}

export function useDeleteProject() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.delete(accessToken!, id),
    onSuccess: (_: void, id: string) => {
      qc.setQueryData<Project[]>(["projects"], (old) =>
        old ? old.filter((p) => p.id !== id) : [],
      );
    },
  });
}
