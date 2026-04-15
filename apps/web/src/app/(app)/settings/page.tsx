"use client";

import { useState } from "react";
import { UserCircle, Users, Trash2, ShieldCheck } from "lucide-react";
import { useMe, useUpdateMe } from "@/hooks/use-me";
import { useProjects } from "@/hooks/use-projects";
import { useMembers, useInviteMember, useUpdateMemberRole, useRemoveMember } from "@/hooks/use-members";
import { useAuth } from "@/contexts/auth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldError } from "@/components/ui/field-error";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import type { ProjectMember } from "@/lib/api";

// ---------------------------------------------------------------------------
// Profile tab
// ---------------------------------------------------------------------------

function ProfileTab() {
  const { data: me, isLoading } = useMe();
  const update = useUpdateMe();

  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const initials = me?.username.slice(0, 2).toUpperCase() ?? "?";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const input: { username?: string; avatarUrl?: string | null } = {};
    if (username.trim()) input.username = username.trim();
    if (avatarUrl.trim()) input.avatarUrl = avatarUrl.trim();
    if (!input.username && !input.avatarUrl) return;

    try {
      await update.mutateAsync(input);
      setSuccess(true);
      setUsername("");
      setAvatarUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Update your username and avatar.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Current info */}
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14">
                {me?.avatarUrl && <AvatarImage src={me.avatarUrl} alt={me.username} />}
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{me?.username}</p>
                <p className="text-sm text-muted-foreground">{me?.email}</p>
              </div>
            </div>

            {/* Edit form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">New username</Label>
                <Input
                  id="username"
                  placeholder={me?.username}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="avatar">Avatar URL</Label>
                <Input
                  id="avatar"
                  type="url"
                  placeholder="https://…"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                />
              </div>
              {error && <FieldError message={error} />}
              {success && (
                <p className="text-sm text-green-600 dark:text-green-400">Profile updated.</p>
              )}
              <Button type="submit" disabled={update.isPending}>
                Save changes
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Member row
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  editor: "secondary",
  viewer: "outline",
};

function MemberRow({
  member,
  isCurrentUser,
  isOwner,
  projectId,
}: {
  member: ProjectMember;
  isCurrentUser: boolean;
  isOwner: boolean;
  projectId: string;
}) {
  const updateRole = useUpdateMemberRole(projectId);
  const remove = useRemoveMember(projectId);
  const initials = member.username.slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center gap-3 py-2">
      <Avatar className="h-8 w-8">
        {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={member.username} />}
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {member.username}
          {isCurrentUser && (
            <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
          )}
        </p>
      </div>

      {isOwner && member.role !== "owner" ? (
        <div className="flex items-center gap-2">
          <Select
            value={member.role}
            onValueChange={(role) =>
              updateRole.mutate({ userId: member.userId, role: role as "editor" | "viewer" })
            }
            disabled={updateRole.isPending}
          >
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate(member.userId)}
            aria-label={`Remove ${member.username}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Badge variant={ROLE_VARIANT[member.role] ?? "outline"} className="capitalize">
          {ROLE_LABELS[member.role] ?? member.role}
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

function MembersTab() {
  const { user } = useAuth();
  const { data: projects, isLoading: projectsLoading } = useProjects();

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const projectId = selectedProjectId || (projects?.[0]?.id ?? "");
  const currentProject = projects?.find((p) => p.id === projectId);
  const isOwner = currentProject?.role === "owner";

  const { data: members, isLoading: membersLoading } = useMembers(projectId);
  const invite = useInviteMember(projectId);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    if (!inviteEmail.trim()) return;
    try {
      await invite.mutateAsync({ email: inviteEmail.trim(), role: inviteRole });
      setInviteEmail("");
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Invite failed");
    }
  }

  if (projectsLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Members
            </CardTitle>
            <CardDescription>Manage who has access to each project.</CardDescription>
          </div>
          {/* Project selector */}
          <Select value={projectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Member list */}
        <div className="divide-y">
          {membersLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))
          ) : (
            members?.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                isCurrentUser={m.userId === user?.id}
                isOwner={!!isOwner}
                projectId={projectId}
              />
            ))
          )}
        </div>

        {/* Invite form — owners and editors only */}
        {isOwner && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Invite a member
            </p>
            <form onSubmit={handleInvite} className="flex flex-wrap gap-2">
              <Input
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="min-w-[200px] flex-1"
                required
              />
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as "editor" | "viewer")}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={invite.isPending} size="sm">
                Invite
              </Button>
            </form>
            {inviteError && <FieldError message={inviteError} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile and project members.
        </p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile" className="flex items-center gap-1.5">
            <UserCircle className="h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="members" className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            Members
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <ProfileTab />
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <MembersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
