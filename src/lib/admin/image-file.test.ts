import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { inspectImageFile } from "./image-file";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("inspectImageFile", () => {
  it("derives trusted metadata and a hash from stored image bytes", async () => {
    const inspected = await inspectImageFile(new Blob([png]));
    expect(inspected).toMatchObject({
      mimeType: "image/png",
      extension: "png",
      width: 1,
      height: 1,
      byteSize: png.byteLength,
      contentHash: createHash("sha256").update(png).digest("hex"),
    });
  });

  it("rejects a declared image whose bytes are not a supported image", async () => {
    await expect(
      inspectImageFile(new Blob(["not an image"], { type: "image/png" })),
    ).rejects.toThrow(/not a supported PNG/);
  });

  it("rejects oversized objects before reading their bytes", async () => {
    const arrayBuffer = vi.fn<() => Promise<ArrayBuffer>>();
    await expect(inspectImageFile({ size: 10_485_761, arrayBuffer })).rejects.toThrow(
      /larger than the 10 MB limit/,
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
