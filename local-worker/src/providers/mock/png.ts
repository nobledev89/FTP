import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

/**
 * A minimal PNG encoder, so the mock image stage produces a real file rather than a placeholder
 * reference.
 *
 * The images stage has to upload bytes to Storage, record a content hash, a MIME type, and real
 * pixel dimensions, and later copy the object into the public bucket. A fake path would leave all
 * of that untested. An image library would be a dependency the worker does not otherwise need, and
 * PNG's baseline encoding is small enough to write directly: signature, IHDR, IDAT, IEND.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export type Rgb = Readonly<[number, number, number]>;

export type PngImage = Readonly<{
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: "image/png";
  contentHash: string;
  byteSize: number;
}>;

/**
 * Encodes an 8-bit truecolour PNG. `pixel` returns the colour at each coordinate, in a normalized
 * 0..1 space so a caller can describe a composition without knowing the output size.
 */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgb,
): PngImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("PNG dimensions must be positive integers");
  }

  // Each scanline is prefixed with its filter type. Filter 0 (None) keeps the encoder trivial and
  // still compresses well for the smooth fields these placeholders use.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x / (width - 1 || 1), y / (height - 1 || 1));
      const offset = rowStart + 1 + x * 3;
      raw[offset] = clampByte(red);
      raw[offset + 1] = clampByte(green);
      raw[offset + 2] = clampByte(blue);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method: adaptive
  header[12] = 0; // interlace: none

  const bytes = Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    // Fixed level and strategy so the same pixels always produce the same file.
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  return {
    bytes: new Uint8Array(bytes),
    width,
    height,
    mimeType: "image/png",
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.length,
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Pixel dimensions for each aspect ratio the schema allows, at editorial hero width. */
export const DIMENSIONS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  "16:9": [1600, 900],
  "3:2": [1440, 960],
  "4:5": [1080, 1350],
  "1:1": [1200, 1200],
});
