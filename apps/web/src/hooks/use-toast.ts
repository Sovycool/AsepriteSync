"use client";

import { useState, useEffect, useCallback } from "react";

export type ToastVariant = "default" | "success" | "destructive";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
}

// ---------------------------------------------------------------------------
// Module-level store so toasts can be triggered from outside React trees
// (e.g. the WS context which runs in a provider)
// ---------------------------------------------------------------------------

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l(toasts);
}

let nextId = 0;

export function toast(opts: Omit<Toast, "id">) {
  const id = String(++nextId);
  toasts = [...toasts, { ...opts, id }];
  notify();
  // Auto-dismiss after 4 s
  setTimeout(() => dismiss(id), 4000);
}

export function dismiss(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function useToasts(): [Toast[], (id: string) => void] {
  const [state, setState] = useState<Toast[]>(toasts);

  useEffect(() => {
    listeners.add(setState);
    return () => { listeners.delete(setState); };
  }, []);

  const dismissOne = useCallback((id: string) => dismiss(id), []);
  return [state, dismissOne];
}
