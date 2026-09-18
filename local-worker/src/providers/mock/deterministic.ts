/**
 * Deterministic pseudo-randomness for the mock providers.
 *
 * The mock pipeline has to produce output that looks like a real article rather than "lorem ipsum
 * 1", but it also has to produce the *same* output every time so an end-to-end test can assert on
 * it. Seeding from the job id plus the stage gives both: two jobs differ, one job repeats.
 */

/** FNV-1a, 32-bit. Small, stable across Node versions, and good enough to seed a PRNG. */
export function hashSeed(...parts: readonly (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x2f;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a compact, well-distributed PRNG with a 32-bit state. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class Deterministic {
  private readonly next: () => number;

  constructor(...seedParts: readonly (string | number)[]) {
    this.next = createRandom(hashSeed(...seedParts));
  }

  /** A float in [0, 1). */
  fraction(): number {
    return this.next();
  }

  /** An integer in [minimum, maximum], inclusive. */
  integer(minimum: number, maximum: number): number {
    if (maximum < minimum) throw new RangeError("maximum must not be below minimum");
    return minimum + Math.floor(this.next() * (maximum - minimum + 1));
  }

  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T {
    const item = items[this.integer(0, items.length - 1)];
    if (item === undefined) throw new RangeError("cannot pick from an empty list");
    return item;
  }

  /** `count` distinct elements, in the list's own order. */
  sample<T>(items: readonly T[], count: number): readonly T[] {
    const wanted = Math.max(0, Math.min(count, items.length));
    const indices = items.map((_, index) => index);
    // Fisher-Yates over the indices, then re-sort so the output order stays the source order.
    for (let index = indices.length - 1; index > 0; index -= 1) {
      const swap = this.integer(0, index);
      const left = indices[index];
      const right = indices[swap];
      if (left === undefined || right === undefined) continue;
      indices[index] = right;
      indices[swap] = left;
    }
    return indices
      .slice(0, wanted)
      .sort((left, right) => left - right)
      .map((index) => items[index] as T);
  }
}

/** A slug-safe token derived from free text, used for stable source and claim keys. */
export function slugToken(value: string, maximumLength = 24): string {
  const token = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maximumLength)
    .replace(/-+$/g, "");
  return token.length > 0 ? token : "topic";
}
