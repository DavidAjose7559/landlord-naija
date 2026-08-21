// @vitest-environment node
//
// dice.ts imports "server-only" (aliased away in tests, but this file
// wants to run under jsdom eventually anyway). More importantly: this
// test's whole point is proving verify-client.ts (Web Crypto) computes
// byte-for-byte the same thing as dice.ts (node:crypto) for the same
// inputs — if they ever disagreed, the verify page's "recompute
// client-side" button would be lying to players.
import { describe, expect, it } from "vitest";
import { hashChain, rollFor } from "@/game/dice";
import { GENESIS_HASH_BROWSER, hashChainBrowser, rollForBrowser, verifyGameBrowser } from "./verify-client";

const SEED = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
const GAME_ID = "verify-client-test-game";

describe("rollForBrowser vs rollFor", () => {
  it("agrees with the server implementation across 200 roll indexes", async () => {
    for (let i = 0; i < 200; i++) {
      const server = rollFor(SEED, GAME_ID, i);
      const browser = await rollForBrowser(SEED, GAME_ID, i);
      expect(browser).toEqual(server);
    }
  });

  it("agrees for a different seed and gameId too", async () => {
    const seed = "f".repeat(64);
    const gameId = "another-game";
    for (let i = 0; i < 50; i++) {
      const server = rollFor(seed, gameId, i);
      const browser = await rollForBrowser(seed, gameId, i);
      expect(browser).toEqual(server);
    }
  });
});

describe("hashChainBrowser vs hashChain", () => {
  it("agrees with the server implementation", async () => {
    const server = hashChain(GENESIS_HASH_BROWSER, GAME_ID, 0, "player-1", 3, 4);
    const browser = await hashChainBrowser(GENESIS_HASH_BROWSER, GAME_ID, 0, "player-1", 3, 4);
    expect(browser).toBe(server);
  });

  it("agrees across a chain of several rolls", async () => {
    let serverPrev = GENESIS_HASH_BROWSER;
    let browserPrev = GENESIS_HASH_BROWSER;
    for (let i = 0; i < 10; i++) {
      const { d1, d2 } = rollFor(SEED, GAME_ID, i);
      const serverHash = hashChain(serverPrev, GAME_ID, i, "player-1", d1, d2);
      const browserHash = await hashChainBrowser(browserPrev, GAME_ID, i, "player-1", d1, d2);
      expect(browserHash).toBe(serverHash);
      serverPrev = serverHash;
      browserPrev = browserHash;
    }
  });
});

describe("verifyGameBrowser", () => {
  it("verifies a correct ledger built with the real rollFor/hashChain", async () => {
    const rolls = [];
    let prevHash = GENESIS_HASH_BROWSER;
    for (let i = 0; i < 5; i++) {
      const { d1, d2 } = rollFor(SEED, GAME_ID, i);
      const hash = hashChain(prevHash, GAME_ID, i, "player-1", d1, d2);
      rolls.push({ rollIndex: i, playerId: "player-1", d1, d2, prevHash, hash });
      prevHash = hash;
    }

    const result = await verifyGameBrowser(SEED, GAME_ID, rolls);
    expect(result).toEqual({ diceOk: true, diceMismatches: [], chainOk: true, chainMismatches: [], ok: true });
  });

  it("flags a tampered die and a tampered hash independently", async () => {
    const rolls = [];
    let prevHash = GENESIS_HASH_BROWSER;
    for (let i = 0; i < 3; i++) {
      const { d1, d2 } = rollFor(SEED, GAME_ID, i);
      const hash = hashChain(prevHash, GAME_ID, i, "player-1", d1, d2);
      rolls.push({ rollIndex: i, playerId: "player-1", d1, d2, prevHash, hash });
      prevHash = hash;
    }

    rolls[1] = { ...rolls[1], d1: (rolls[1].d1 % 6) + 1 }; // dice mismatch
    rolls[2] = { ...rolls[2], hash: "f".repeat(64) }; // chain mismatch

    const result = await verifyGameBrowser(SEED, GAME_ID, rolls);
    expect(result.ok).toBe(false);
    expect(result.diceMismatches).toContain(1);
    expect(result.chainMismatches).toContain(2);
  });
});
