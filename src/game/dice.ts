import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

// Largest multiple of 6 that fits in a byte (0-255). Bytes >= this are
// rejection-sampled away so `byte % 6` is exactly uniform over 0-5, with no
// modulo bias from the leftover 256 % 6 == 4 values.
const REJECTION_THRESHOLD = 252;

export function createServerSeed(): { seed: string; hash: string } {
  const seed = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(seed).digest("hex");
  return { seed, hash };
}

function hmacBytes(seed: string, gameId: string, rollIndex: number, extension: number): Buffer {
  const message =
    extension === 0 ? `${gameId}:${rollIndex}` : `${gameId}:${rollIndex}:ext${extension}`;
  return createHmac("sha256", seed).update(message).digest();
}

// Pure and deterministic: the same seed + gameId + rollIndex always produces
// the same dice, which is what makes a finished game auditable after the
// seed is revealed.
export function rollFor(seed: string, gameId: string, rollIndex: number): { d1: number; d2: number } {
  const values: number[] = [];
  let extension = 0;

  while (values.length < 2) {
    const bytes = hmacBytes(seed, gameId, rollIndex, extension);
    for (const byte of bytes) {
      if (byte >= REJECTION_THRESHOLD) continue;
      values.push((byte % 6) + 1);
      if (values.length === 2) break;
    }
    extension += 1;
  }

  const [d1, d2] = values as [number, number];
  return { d1, d2 };
}

export interface RollRecord {
  rollIndex: number;
  d1: number;
  d2: number;
}

export function verifyGame(
  seed: string,
  gameId: string,
  rolls: readonly RollRecord[],
): { ok: boolean; mismatches: number[] } {
  const mismatches: number[] = [];
  for (const roll of rolls) {
    const expected = rollFor(seed, gameId, roll.rollIndex);
    if (expected.d1 !== roll.d1 || expected.d2 !== roll.d2) {
      mismatches.push(roll.rollIndex);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export const GENESIS_HASH = "0".repeat(64);

export function hashChain(
  prevHash: string,
  gameId: string,
  rollIndex: number,
  playerId: string,
  d1: number,
  d2: number,
): string {
  const payload = [prevHash, gameId, rollIndex, playerId, d1, d2].join("|");
  return createHash("sha256").update(payload).digest("hex");
}
