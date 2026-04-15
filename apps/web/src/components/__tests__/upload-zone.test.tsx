import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UploadZone } from "../upload-zone";

function makeFile(name: string, type = "application/octet-stream"): File {
  return new File(["data"], name, { type });
}

describe("UploadZone", () => {
  it("renders the upload label", () => {
    render(<UploadZone onUpload={vi.fn()} />);
    expect(screen.getByText(/drop .aseprite \/ .ase files here/i)).toBeInTheDocument();
  });

  it("calls onUpload with accepted files on drop", () => {
    const onUpload = vi.fn();
    render(<UploadZone onUpload={onUpload} />);

    const zone = screen.getByRole("button");
    const file = makeFile("sprite.aseprite");

    fireEvent.drop(zone, {
      dataTransfer: {
        files: [file],
      },
    });

    expect(onUpload).toHaveBeenCalledWith([file]);
  });

  it("filters out files with unsupported extensions", () => {
    const onUpload = vi.fn();
    render(<UploadZone onUpload={onUpload} />);

    const zone = screen.getByRole("button");

    fireEvent.drop(zone, {
      dataTransfer: {
        files: [
          makeFile("sprite.aseprite"),
          makeFile("image.png"),
          makeFile("character.ase"),
          makeFile("video.mp4"),
        ],
      },
    });

    expect(onUpload).toHaveBeenCalledOnce();
    const accepted: File[] = onUpload.mock.calls[0][0];
    expect(accepted).toHaveLength(2);
    expect(accepted.map((f) => f.name)).toEqual(
      expect.arrayContaining(["sprite.aseprite", "character.ase"]),
    );
  });

  it("does not call onUpload when all files are unsupported", () => {
    const onUpload = vi.fn();
    render(<UploadZone onUpload={onUpload} />);

    const zone = screen.getByRole("button");
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [makeFile("photo.jpg")],
      },
    });

    expect(onUpload).not.toHaveBeenCalled();
  });

  it("does not call onUpload when disabled", () => {
    const onUpload = vi.fn();
    render(<UploadZone onUpload={onUpload} disabled />);

    const zone = screen.getByRole("button");
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [makeFile("sprite.aseprite")],
      },
    });

    expect(onUpload).not.toHaveBeenCalled();
  });

  it("has tabIndex -1 and cursor-not-allowed when disabled", () => {
    render(<UploadZone onUpload={vi.fn()} disabled />);
    const zone = screen.getByRole("button");
    expect(zone).toHaveAttribute("tabindex", "-1");
  });

  it("triggers file input click on Enter key", () => {
    render(<UploadZone onUpload={vi.fn()} />);
    const zone = screen.getByRole("button");
    const input = zone.querySelector("input[type=file]") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.keyDown(zone, { key: "Enter" });

    expect(clickSpy).toHaveBeenCalled();
  });
});
