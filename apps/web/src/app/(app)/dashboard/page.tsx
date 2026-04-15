"use client";

import { useState } from "react";
import { FolderOpen, Users, Plus, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stat-card";
import { ProjectCard } from "@/components/project-card";
import { ActivityFeed } from "@/components/activity-feed";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { useProjects, useDeleteProject } from "@/hooks/use-projects";
import { useActivity } from "@/hooks/use-activity";

const RECENT_COUNT = 6;

export default function DashboardPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: activity = [], isLoading: activityLoading } = useActivity();
  const deleteProject = useDeleteProject();

  const recentProjects = projects.slice(0, RECENT_COUNT);

  // Derived stats
  const totalProjects = projects.length;
  const totalMembers  = projects.reduce((sum, p) => sum + (p.memberCount ?? 1), 0);
  const ownedCount    = projects.filter((p) => p.role === "owner").length;

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your projects and recent activity.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New project
        </Button>
      </div>

      {/* Stats row */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Projects"     value={totalProjects} icon={FolderOpen} isLoading={projectsLoading} />
        <StatCard label="Owned"        value={ownedCount}    icon={Activity}   isLoading={projectsLoading} />
        <StatCard label="Collaborators" value={totalMembers}  icon={Users}     isLoading={projectsLoading} />
      </div>

      {/* Two-column layout: recent projects + activity feed */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Recent projects */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Recent projects</h2>
            {projects.length > RECENT_COUNT && (
              <Button variant="ghost" size="sm" asChild>
                <a href="/projects">View all</a>
              </Button>
            )}
          </div>

          {projectsLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg border p-5 space-y-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : recentProjects.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <FolderOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No projects yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create your first project to start syncing Aseprite files.
              </p>
              <Button className="mt-4" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                New project
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {recentProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDelete={(id) => void deleteProject.mutateAsync(id)}
                  deleting={deleteProject.isPending}
                />
              ))}
            </div>
          )}
        </section>

        {/* Activity feed */}
        <section>
          <h2 className="mb-3 text-base font-semibold">Recent activity</h2>
          <div className="rounded-lg border p-4">
            <ActivityFeed logs={activity.slice(0, 20)} isLoading={activityLoading} />
          </div>
        </section>
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
