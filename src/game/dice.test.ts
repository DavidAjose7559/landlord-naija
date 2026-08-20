// @vitest-environment node
//
// dice.ts imports "server-only", which throws if the module resolves under
// the "browser" condition. The project's default test environment is
// jsdom (for React component tests); this file overrides that back to
// plain node, which is also the correct environment for testing pure
// Node crypto code.
import { beforeAll, describe, expect, it } from "vitest";
import { GENESIS_HASH, createServerSeed, hashChain, rollFor, verifyGame } from "./dice";

const SEED = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
const GAME_ID = "test-game";

function chiSquare(counts: number[], expectedEach: number): number {
  return counts.reduce((sum, observed) => sum + (observed - expectedEach) ** 2 / expectedEach, 0);
}

describe("createServerSeed", () => {
  it("returns a 64 hex char seed and its sha256 hash", () => {
    const { seed, hash } = createServerSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different seed every call", () => {
    const a = createServerSeed();
    const b = createServerSeed();
    expect(a.seed).not.toBe(b.seed);
  });
});

describe("rollFor", () => {
  it("is deterministic across 1000 repeated calls with the same inputs", () => {
    const first = rollFor(SEED, GAME_ID, 42);
    for (let i = 0; i < 1000; i++) {
      expect(rollFor(SEED, GAME_ID, 42)).toEqual(first);
    }
  });

  it("produces integer dice 1-6 across 50,000 rolls", () => {
    for (let i = 0; i < 50_000; i++) {
      const { d1, d2 } = rollFor(SEED, GAME_ID, i);
      expect(Number.isInteger(d1)).toBe(true);
      expect(Number.isInteger(d2)).toBe(true);
      expect(d1).toBeGreaterThanOrEqual(1);
      expect(d1).toBeLessThanOrEqual(6);
      expect(d2).toBeGreaterThanOrEqual(1);
      expect(d2).toBeLessThanOrEqual(6);
    }
  });

  describe("distribution over 120,000 rolls", () => {
    const N = 120_000;
    const d1Counts = [0, 0, 0, 0, 0, 0];
    const d2Counts = [0, 0, 0, 0, 0, 0];
    const sumCounts = new Array(13).fill(0); // index 2..12 used

    beforeAll(() => {
      for (let i = 0; i < N; i++) {
        const { d1, d2 } = rollFor(SEED, GAME_ID, i);
        d1Counts[d1 - 1]++;
        d2Counts[d2 - 1]++;
        sumCounts[d1 + d2]++;
      }
    });

    it("keeps each face within 2% of 1/6 for both dice", () => {
      const expected = N / 6;
      const tolerance = expected * 0.02;
      for (const face of [0, 1, 2, 3, 4, 5]) {
        expect(Math.abs(d1Counts[face] - expected)).toBeLessThanOrEqual(tolerance);
        expect(Math.abs(d2Counts[face] - expected)).toBeLessThanOrEqual(tolerance);
      }
    });

    it("has a chi-square statistic below 15.09 (5 df, p=0.01) for each die", () => {
      const expected = N / 6;
      const chi2D1 = chiSquare(d1Counts, expected);
      const chi2D2 = chiSquare(d2Counts, expected);

      console.log(`chi-square d1: ${chi2D1.toFixed(4)}`);
      console.log(`chi-square d2: ${chi2D2.toFixed(4)}`);
      console.log(`d1 counts: ${d1Counts.join(", ")}`);
      console.log(`d2 counts: ${d2Counts.join(", ")}`);

      expect(chi2D1).toBeLessThan(15.09);
      expect(chi2D2).toBeLessThan(15.09);
    });

    it("matches the expected 1/36..6/36..1/36 two-dice sum curve", () => {
      const expectedProportion: Record<number, number> = {
        2: 1 / 36,
        3: 2 / 36,
        4: 3 / 36,
        5: 4 / 36,
        6: 5 / 36,
        7: 6 / 36,
        8: 5 / 36,
        9: 4 / 36,
        10: 3 / 36,
        11: 2 / 36,
        12: 1 / 36,
      };

      for (let sum = 2; sum <= 12; sum++) {
        const observedProportion = sumCounts[sum] / N;
        const expected = expectedProportion[sum];
        const relativeError = Math.abs(observedProportion - expected) / expected;
        expect(relativeError).toBeLessThan(0.08);
      }
    });
  });

  it("produces no short repeating pattern across sequential rollIndex values", () => {
    const encoded: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const { d1, d2 } = rollFor(SEED, GAME_ID, i);
      encoded.push(d1 * 10 + d2); // 36 distinct possible values
    }

    for (let period = 1; period <= 100; period++) {
      let matches = 0;
      for (let i = period; i < encoded.length; i++) {
        if (encoded[i] === encoded[i - period]) matches++;
      }
      const total = encoded.length - period;
      // Truly uncorrelated pairs coincidentally match about 1/36 (~2.8%) of
      // the time; a repeating pattern would match at or near 100%.
      expect(matches / total).toBeLessThan(0.15);
    }
  });

  it("changes seed, gameId, or rollIndex all independently affect the outcome", () => {
    const base = rollFor(SEED, GAME_ID, 7);
    const differentSeed = rollFor("f".repeat(64), GAME_ID, 7);
    const differentGame = rollFor(SEED, "other-game", 7);
    const differentIndex = rollFor(SEED, GAME_ID, 8);

    const asArray = (r: { d1: number; d2: number }) => [r.d1, r.d2];
    expect(asArray(differentSeed)).not.toEqual(asArray(base));
    expect(asArray(differentGame)).not.toEqual(asArray(base));
    expect(asArray(differentIndex)).not.toEqual(asArray(base));
  });
});

describe("verifyGame", () => {
  it("returns ok:true for a correct ledger", () => {
    const rolls = Array.from({ length: 10 }, (_, rollIndex) => ({
      rollIndex,
      ...rollFor(SEED, GAME_ID, rollIndex),
    }));

    const result = verifyGame(SEED, GAME_ID, rolls);
    expect(result).toEqual({ ok: true, mismatches: [] });
  });

  it("flags the exact index of a tampered roll", () => {
    const rolls = Array.from({ length: 10 }, (_, rollIndex) => ({
      rollIndex,
      ...rollFor(SEED, GAME_ID, rollIndex),
    }));

    rolls[3] = { ...rolls[3], d1: (rolls[3].d1 % 6) + 1 };

    const result = verifyGame(SEED, GAME_ID, rolls);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([3]);
  });

  it("flags multiple tampered indexes", () => {
    const rolls = Array.from({ length: 10 }, (_, rollIndex) => ({
      rollIndex,
      ...rollFor(SEED, GAME_ID, rollIndex),
    }));

    rolls[1] = { ...rolls[1], d2: (rolls[1].d2 % 6) + 1 };
    rolls[6] = { ...rolls[6], d1: (rolls[6].d1 % 6) + 1 };

    const result = verifyGame(SEED, GAME_ID, rolls);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([1, 6]);
  });
});

describe("hashChain", () => {
  it("uses 64 zeros as the genesis prevHash", () => {
    expect(GENESIS_HASH).toBe("0".repeat(64));
    expect(GENESIS_HASH.length).toBe(64);
  });

  it("returns a deterministic sha256 hex digest", () => {
    const a = hashChain(GENESIS_HASH, GAME_ID, 0, "player-1", 3, 4);
    const b = hashChain(GENESIS_HASH, GAME_ID, 0, "player-1", 3, 4);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes if any field changes", () => {
    const base = hashChain(GENESIS_HASH, GAME_ID, 0, "player-1", 3, 4);
    expect(hashChain("f".repeat(64), GAME_ID, 0, "player-1", 3, 4)).not.toBe(base);
    expect(hashChain(GENESIS_HASH, "other-game", 0, "player-1", 3, 4)).not.toBe(base);
    expect(hashChain(GENESIS_HASH, GAME_ID, 1, "player-1", 3, 4)).not.toBe(base);
    expect(hashChain(GENESIS_HASH, GAME_ID, 0, "player-2", 3, 4)).not.toBe(base);
    expect(hashChain(GENESIS_HASH, GAME_ID, 0, "player-1", 4, 4)).not.toBe(base);
    expect(hashChain(GENESIS_HASH, GAME_ID, 0, "player-1", 3, 5)).not.toBe(base);
  });
});
