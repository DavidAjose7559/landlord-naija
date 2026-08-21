import "server-only";

import { randomInt } from "node:crypto";

// A cryptographically-secure stand-in for Math.random() (which this
// codebase never uses). Used for deck shuffling and room code generation —
// not part of the provably-fair ledger, which only covers dice rolls.
export function secureRandom(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}
