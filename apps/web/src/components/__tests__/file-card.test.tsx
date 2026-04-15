import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileCard } from "../file-card";
import type { FileRecord } from "@/lib/api";

// Radix UI DropdownMenu doesn't render its portal content in jsdom.
// Mock it to render items inline so we can interact with them.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button
      data-disabled={disabled ? "" : undefined}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

const baseFile: FileRecord = {
  id: "file-1",
  projectId: "proj-1",
  name: "sprite.aseprite",
  path: "/sprite.aseprite",
  currentVersionId: "v-1",
  lockedBy: null,
  lockExpiresAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const defaultProps = {
  file: baseFile,
  currentUserId: "user-1",
  projectId: "proj-1",
  onDownload: vi.fn(),
  onDelete: vi.fn(),
  onLock: vi.fn(),
  onUnlock: vi.fn(),
  onReplace: vi.fn(),
};

// With the mocked dropdown, menu items are always visible — no need to open.
function openMenu() {}

describe("FileCard — unlocked file", () => {
  it("renders the filename", () => {
    render(<FileCard {...defaultProps} />);
    expect(screen.getAllByText("sprite.aseprite").length).toBeGreaterThan(0);
  });

  it("does not render a lock badge", () => {
    render(<FileCard {...defaultProps} />);
    expect(screen.queryByText(/locked/i)).toBeNull();
  });

  it("shows a Lock menu item", () => {
    render(<FileCard {...defaultProps} />);
    openMenu();
    expect(screen.getByText("Lock")).toBeInTheDocument();
  });

  it("does not show an Unlock menu item", () => {
    render(<FileCard {...defaultProps} />);
    openMenu();
    expect(screen.queryByText("Unlock")).toBeNull();
  });

  it("calls onLock when Lock is clicked", () => {
    const onLock = vi.fn();
    render(<FileCard {...defaultProps} onLock={onLock} />);
    openMenu();
    fireEvent.click(screen.getByText("Lock"));
    expect(onLock).toHaveBeenCalledOnce();
  });
});

describe("FileCard — locked by me", () => {
  const lockedByMe: FileRecord = { ...baseFile, lockedBy: "user-1" };

  it("shows 'Locked by you' badge", () => {
    render(<FileCard {...defaultProps} file={lockedByMe} />);
    expect(screen.getByText("Locked by you")).toBeInTheDocument();
  });

  it("shows an Unlock menu item", () => {
    render(<FileCard {...defaultProps} file={lockedByMe} />);
    openMenu();
    expect(screen.getByText("Unlock")).toBeInTheDocument();
  });

  it("does not show a Lock menu item", () => {
    render(<FileCard {...defaultProps} file={lockedByMe} />);
    openMenu();
    expect(screen.queryByText("Lock")).toBeNull();
  });

  it("calls onUnlock when Unlock is clicked", () => {
    const onUnlock = vi.fn();
    render(<FileCard {...defaultProps} file={lockedByMe} onUnlock={onUnlock} />);
    openMenu();
    fireEvent.click(screen.getByText("Unlock"));
    expect(onUnlock).toHaveBeenCalledOnce();
  });
});

describe("FileCard — locked by other user", () => {
  const lockedByOther: FileRecord = { ...baseFile, lockedBy: "user-2" };

  it("shows 'Locked' badge", () => {
    render(<FileCard {...defaultProps} file={lockedByOther} />);
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("renders a disabled Lock menu item", () => {
    render(<FileCard {...defaultProps} file={lockedByOther} />);
    openMenu();
    // The Lock item exists but is disabled
    const lockItem = screen.getByText("Lock").closest("[data-disabled]");
    expect(lockItem).not.toBeNull();
  });

  it("does not call onLock when Lock item is disabled", () => {
    const onLock = vi.fn();
    render(<FileCard {...defaultProps} file={lockedByOther} onLock={onLock} />);
    openMenu();
    fireEvent.click(screen.getByText("Lock"));
    expect(onLock).not.toHaveBeenCalled();
  });
});
