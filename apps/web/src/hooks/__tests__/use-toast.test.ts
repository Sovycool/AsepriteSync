import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { toast, dismiss, useToasts } from "../use-toast";

// Reset module-level store between tests by re-importing a fresh module.
// Because use-toast uses module-level mutable state, we have to reset it
// manually between tests.
beforeEach(() => {
  // Dismiss all current toasts to reset state
  const { result } = renderHook(() => useToasts());
  const [current] = result.current;
  current.forEach((t) => dismiss(t.id));
});

describe("toast / dismiss", () => {
  it("adds a toast to the store", () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      toast({ title: "Hello", variant: "success" });
    });

    const [toasts] = result.current;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ title: "Hello", variant: "success" });
    expect(typeof toasts[0].id).toBe("string");
  });

  it("dismiss() removes a toast by id", () => {
    const { result } = renderHook(() => useToasts());

    let id!: string;
    act(() => {
      toast({ title: "Temp" });
    });
    act(() => {
      id = result.current[0][0].id;
      dismiss(id);
    });

    const [toasts] = result.current;
    expect(toasts.find((t) => t.id === id)).toBeUndefined();
  });

  it("stacks multiple toasts", () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      toast({ title: "First" });
      toast({ title: "Second" });
      toast({ title: "Third" });
    });

    const [toasts] = result.current;
    expect(toasts).toHaveLength(3);
    expect(toasts.map((t) => t.title)).toEqual(["First", "Second", "Third"]);
  });

  it("auto-dismisses after 4 seconds", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useToasts());

    act(() => {
      toast({ title: "Auto-gone" });
    });

    expect(result.current[0]).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(4001);
    });

    expect(result.current[0]).toHaveLength(0);

    vi.useRealTimers();
  });
});

describe("useToasts hook", () => {
  it("returns current toasts and dismiss function", () => {
    const { result } = renderHook(() => useToasts());
    const [toasts, dismissOne] = result.current;
    expect(Array.isArray(toasts)).toBe(true);
    expect(typeof dismissOne).toBe("function");
  });

  it("reacts to toasts added from outside React tree", () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      toast({ title: "External" });
    });

    expect(result.current[0][result.current[0].length - 1].title).toBe("External");
  });
});
