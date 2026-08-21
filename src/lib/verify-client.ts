// Browser-side reimplementation of src/game/dice.ts's rollFor/hashChain,
// using the Web Crypto API instead of node:crypto — dice.ts is
// "server-only" and its node:crypto calls don't exist in a browser at
// all. This is what powers the verify page's "recompute client-side"
// button: the whole point is that it runs in the visitor's own browser,
// not a server round-trip.
//
// Must stay algorithmically identical to dice.ts (same rejection-sampling
// threshold, same HMAC message format, same hash join format) — see
// verify-client.test.ts, which asserts the two agree.

const REJECTION_THRESHOLD = 252;
export const GENESIS_HASH_BROWSER = "0".repeat(64);

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(seed: string, message: string): Promise<Uint8Array> {
  // dice.ts calls node:crypto's createHmac("sha256", seed) with `seed` as
  // a plain JS string — Node encodes a string key as its UTF-8 text bytes,
  // NOT as hex-decoded bytes, even though `seed` happens to look like hex.
  // Must match that exactly, or every HMAC here would use a completely
  // different key than the server did.
  //
  // Also: @types/node's global Uint8Array is generic over ArrayBufferLike
  // (includes SharedArrayBuffer); Web Crypto's BufferSource wants
  // ArrayBufferView<ArrayBuffer> specifically. These bytes are always
  // backed by a plain ArrayBuffer at runtime, so the cast is safe.
  const key = await crypto.subtle.importKey(
    "raw",
    textToBytes(seed) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textToBytes(message) as BufferSource);
  return new Uint8Array(signature);
}

export async function rollForBrowser(
  seed: string,
  gameId: string,
  rollIndex: number,
): Promise<{ d1: number; d2: number }> {
  const values: number[] = [];
  let extension = 0;

  while (values.length < 2) {
    const message = extension === 0 ? `${gameId}:${rollIndex}` : `${gameId}:${rollIndex}:ext${extension}`;
    const bytes = await hmacSha256(seed, message);
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

export async function hashChainBrowser(
  prevHash: string,
  gameId: string,
  rollIndex: number,
  playerId: string,
  d1: number,
  d2: number,
): Promise<string> {
  const payload = [prevHash, gameId, rollIndex, playerId, d1, d2].join("|");
  const digest = await crypto.subtle.digest("SHA-256", textToBytes(payload) as BufferSource);
  return bytesToHex(digest);
}

export interface BrowserRollRecord {
  rollIndex: number;
  playerId: string;
  d1: number;
  d2: number;
  prevHash: string;
  hash: string;
}

export interface BrowserVerifyResult {
  diceOk: boolean;
  diceMismatches: number[];
  chainOk: boolean;
  chainMismatches: number[];
  ok: boolean;
}

export async function verifyGameBrowser(
  seed: string,
  gameId: string,
  rolls: readonly BrowserRollRecord[],
): Promise<BrowserVerifyResult> {
  const diceMismatches: number[] = [];
  const chainMismatches: number[] = [];
  let expectedPrevHash = GENESIS_HASH_BROWSER;

  for (const roll of rolls) {
    const expectedDice = await rollForBrowser(seed, gameId, roll.rollIndex);
    if (expectedDice.d1 !== roll.d1 || expectedDice.d2 !== roll.d2) {
      diceMismatches.push(roll.rollIndex);
    }

    const expectedHash = await hashChainBrowser(
      expectedPrevHash,
      gameId,
      roll.rollIndex,
      roll.playerId,
      roll.d1,
      roll.d2,
    );
    if (roll.prevHash !== expectedPrevHash || roll.hash !== expectedHash) {
      chainMismatches.push(roll.rollIndex);
    }
    expectedPrevHash = roll.hash;
  }

  return {
    diceOk: diceMismatches.length === 0,
    diceMismatches,
    chainOk: chainMismatches.length === 0,
    chainMismatches,
    ok: diceMismatches.length === 0 && chainMismatches.length === 0,
  };
}
