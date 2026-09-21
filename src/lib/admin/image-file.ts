import "server-only";

import { createHash } from "node:crypto";

const MAX_IMAGE_BYTES = 10_485_760;

type SupportedMime = "image/png" | "image/jpeg" | "image/webp" | "image/avif";

export type InspectedImage = Readonly<{
  bytes: Uint8Array;
  mimeType: SupportedMime;
  width: number;
  height: number;
  byteSize: number;
  contentHash: string;
  extension: "png" | "jpg" | "webp" | "avif";
}>;

type ReadableImage = Pick<Blob, "size" | "arrayBuffer">;

function uint16be(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 256 + bytes[offset + 1]!;
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 0x100 + bytes[offset + 2]! * 0x10000;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function dimensions(bytes: Uint8Array): Readonly<{
  mimeType: SupportedMime;
  width: number;
  height: number;
  extension: InspectedImage["extension"];
}> | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    ascii(bytes, 12, 4) === "IHDR"
  ) {
    return {
      mimeType: "image/png",
      width: uint32be(bytes, 16),
      height: uint32be(bytes, 20),
      extension: "png",
    };
  }

  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const frameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = uint16be(bytes, offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (frameMarkers.has(marker) && length >= 7) {
        return {
          mimeType: "image/jpeg",
          height: uint16be(bytes, offset + 5),
          width: uint16be(bytes, offset + 7),
          extension: "jpg",
        };
      }
      offset += length + 2;
    }
  }

  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X") {
      return {
        mimeType: "image/webp",
        width: uint24le(bytes, 24) + 1,
        height: uint24le(bytes, 27) + 1,
        extension: "webp",
      };
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        mimeType: "image/webp",
        width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
        height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
        extension: "webp",
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return {
        mimeType: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        extension: "webp",
      };
    }
  }

  if (bytes.length >= 32 && ascii(bytes, 4, 4) === "ftyp") {
    const brandWindow = ascii(bytes, 8, Math.min(32, bytes.length - 8));
    if (brandWindow.includes("avif") || brandWindow.includes("avis")) {
      for (let offset = 12; offset + 16 <= bytes.length; offset += 1) {
        if (ascii(bytes, offset, 4) !== "ispe") continue;
        const width = uint32be(bytes, offset + 8);
        const height = uint32be(bytes, offset + 12);
        if (width > 0 && height > 0) {
          return { mimeType: "image/avif", width, height, extension: "avif" };
        }
      }
    }
  }
  return null;
}

export async function inspectImageFile(file: ReadableImage): Promise<InspectedImage> {
  if (file.size < 1) throw new Error("Choose a non-empty image file.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("The image is larger than the 10 MB limit.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = dimensions(bytes);
  if (!inspected) throw new Error("The file is not a supported PNG, JPEG, WebP, or AVIF image.");
  if (
    inspected.width < 1 ||
    inspected.height < 1 ||
    inspected.width > 20_000 ||
    inspected.height > 20_000
  ) {
    throw new Error("Image dimensions must be between 1 and 20,000 pixels.");
  }
  return {
    ...inspected,
    bytes,
    byteSize: bytes.byteLength,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
