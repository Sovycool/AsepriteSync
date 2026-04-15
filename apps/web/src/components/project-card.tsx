"use client";

import Link from "next/link";
import { Users, FolderOpen, MoreVertical, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Project } from "@/lib/api";

interface Props {
  project: Project;
  onDelete?: (id: string) => void;
  deleting?: boolean;
}

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  owner:  "default",
  editor: "secondary",
  viewer: "outline",
};

export function ProjectCard({ project, onDelete, deleting }: Props) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{project.name}</CardTitle>
            {project.description && (
              <CardDescription className="mt-1 line-clamp-2">{project.description}</CardDescription>
            )}
          </div>
          <Badge variant={ROLE_VARIANT[project.role] ?? "outline"} className="shrink-0 capitalize">
            {project.role}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-3">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {project.memberCount ?? 1}
          </span>
          <span className="flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5" />
            {new Date(project.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </CardContent>

      <CardFooter className="mt-auto gap-2 pt-0">
        <Link href={`/projects/${project.id}`} className="flex-1">
          <Button variant="secondary" size="sm" className="w-full">
            Open
          </Button>
        </Link>
        {onDelete && project.role === "owner" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            disabled={deleting}
            onClick={() => onDelete(project.id)}
            aria-label="Delete project"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
