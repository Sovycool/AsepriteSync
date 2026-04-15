"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { useCreateProject } from "@/hooks/use-projects";
import { ApiError } from "@/lib/api";

const schema = z.object({
  name:        z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
});

type Fields = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CreateProjectDialog({ open, onOpenChange }: Props) {
  const [fields, setFields] = useState<Fields>({ name: "", description: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [serverError, setServerError] = useState("");
  const mutation = useCreateProject();

  function reset() {
    setFields({ name: "", description: "" });
    setErrors({});
    setServerError("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");

    const result = schema.safeParse(fields);
    if (!result.success) {
      const flat = result.error.flatten().fieldErrors;
      setErrors({ name: flat.name?.[0], description: flat.description?.[0] });
      return;
    }

    try {
      await mutation.mutateAsync({
        name: result.data.name,
        ...(result.data.description ? { description: result.data.description } : {}),
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to create project.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Give your project a name to get started.</DialogDescription>
        </DialogHeader>

        <form id="create-project-form" onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {serverError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              placeholder="My awesome sprites"
              value={fields.name}
              onChange={(e) => { setFields((p) => ({ ...p, name: e.target.value })); setErrors((p) => ({ ...p, name: undefined })); }}
              disabled={mutation.isPending}
            />
            <FieldError message={errors.name} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="project-desc"
              placeholder="A short description…"
              value={fields.description ?? ""}
              onChange={(e) => setFields((p) => ({ ...p, description: e.target.value }))}
              disabled={mutation.isPending}
            />
            <FieldError message={errors.description} />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button form="create-project-form" type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
