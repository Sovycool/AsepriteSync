"use client";

import * as Toast from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { useToasts } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const VARIANT_CLASSES = {
  default: "bg-background border",
  success: "bg-background border border-green-500/50",
  destructive: "bg-background border border-destructive/50",
};

export function Toaster() {
  const [toasts, dismiss] = useToasts();

  return (
    <Toast.Provider swipeDirection="right">
      {toasts.map((t) => (
        <Toast.Root
          key={t.id}
          open
          onOpenChange={(open) => { if (!open) dismiss(t.id); }}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg p-4 shadow-lg transition-all",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-right-full",
            VARIANT_CLASSES[t.variant ?? "default"],
          )}
        >
          <div className="flex-1 space-y-1">
            <Toast.Title className="text-sm font-semibold">{t.title}</Toast.Title>
            {t.description && (
              <Toast.Description className="text-xs text-muted-foreground">
                {t.description}
              </Toast.Description>
            )}
          </div>
          <Toast.Close
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded-sm opacity-70 hover:opacity-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Toast.Close>
        </Toast.Root>
      ))}

      <Toast.Viewport className="fixed bottom-4 right-4 z-[100] flex max-h-screen w-full max-w-sm flex-col gap-2 p-0" />
    </Toast.Provider>
  );
}
