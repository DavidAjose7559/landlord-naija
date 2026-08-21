// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashChain, rollFor } from "@/game/dice";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { FakeSupabaseAdmin } from "./fakeSupabase";

vi.mock("@/lib/supabase/server", async () => {
  const { FakeSupabaseAdmin } = await import("./fakeSupabase");
  return { supabaseAdmin: new FakeSupabaseAdmin() };
});

// Import route handlers *after* the mock is declared (vi.mock is hoisted
// above all imports by Vitest regardless of textual order, but importing
// them down here keeps the intent obvious).
import { POST as createGame } from "@/app/api/games/route";
import { GET as getGame } from "@/app/api/games/[code]/route";
import { POST as joinGame } from "@/app/api/games/[code]/join/route";
import { POST as startGame } from "@/app/api/games/[code]/start/route";
import { POST as postAction } from "@/app/api/games/[code]/action/route";
import { GET as getVerify } from "@/app/api/games/[code]/verify/route";

const fakeAdmin = supabaseAdmin as unknown as FakeSupabaseAdmin;

function ctx(code: string) {
  return { params: Promise.resolve({ code }) };
}

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(url: string): Request {
  return new Request(url, { method: "GET" });
}

async function createAndJoinTwo() {
  const createRes = await createGame(postJson("http://test/api/games", {}));
  const created = await createRes.json();
  const roomCode: string = created.roomCode;

  const join1Res = await joinGame(
    postJson(`http://test/api/games/${roomCode}/join`, { name: "Ada", token: "danfo" }),
    ctx(roomCode),
  );
  const join1 = await join1Res.json();

  const join2Res = await joinGame(
    postJson(`http://test/api/games/${roomCode}/join`, { name: "Bola", token: "keke" }),
    ctx(roomCode),
  );
  const join2 = await join2Res.json();

  return {
    roomCode,
    serverSeedHash: created.serverSeedHash,
    host: { playerId: join1.playerId, clientToken: join1.clientToken },
    guest: { playerId: join2.playerId, clientToken: join2.clientToken },
  };
}

async function createJoinAndStart() {
  const setup = await createAndJoinTwo();
  await startGame(postJson(`http://test/api/games/${setup.roomCode}/start`, { clientToken: setup.host.clientToken }), ctx(setup.roomCode));
  return setup;
}

beforeEach(() => {
  fakeAdmin.reset();
});

describe("POST /api/games", () => {
  it("creates a game and returns only the room code and seed hash, never the seed", async () => {
    const res = await createGame(postJson("http://test/api/games", {}));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(body.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body).not.toHaveProperty("serverSeed");
    expect(body).not.toHaveProperty("seed");
  });

  it("rejects a body with unexpected fields", async () => {
    const res = await createGame(postJson("http://test/api/games", { hack: true }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/games/[code]/join", () => {
  it("creates a player and returns a player id + client token", async () => {
    const createRes = await createGame(postJson("http://test/api/games", {}));
    const { roomCode } = await createRes.json();

    const res = await joinGame(postJson(`http://test/api/games/${roomCode}/join`, { name: "Ada", token: "danfo" }), ctx(roomCode));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(typeof body.playerId).toBe("string");
    expect(body.clientToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects joining with a token already taken in that game", async () => {
    const createRes = await createGame(postJson("http://test/api/games", {}));
    const { roomCode } = await createRes.json();
    await joinGame(postJson(`http://test/api/games/${roomCode}/join`, { name: "Ada", token: "danfo" }), ctx(roomCode));

    const res = await joinGame(postJson(`http://test/api/games/${roomCode}/join`, { name: "Bola", token: "danfo" }), ctx(roomCode));
    expect(res.status).toBe(409);
  });

  it("rejects joining a game that has already started", async () => {
    const setup = await createJoinAndStart();
    const res = await joinGame(
      postJson(`http://test/api/games/${setup.roomCode}/join`, { name: "Chidi", token: "gele" }),
      ctx(setup.roomCode),
    );
    expect(res.status).toBe(409);
  });

  it("404s for an unknown room code", async () => {
    const res = await joinGame(postJson("http://test/api/games/ZZZZZZ/join", { name: "Ada", token: "danfo" }), ctx("ZZZZZZ"));
    expect(res.status).toBe(404);
  });

  it("rejects an invalid room code shape before ever hitting the DB", async () => {
    const res = await joinGame(postJson("http://test/api/games/nope/join", { name: "Ada", token: "danfo" }), ctx("nope"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/games/[code]/start", () => {
  it("rejects a non-host trying to start", async () => {
    const setup = await createAndJoinTwo();
    const res = await startGame(
      postJson(`http://test/api/games/${setup.roomCode}/start`, { clientToken: setup.guest.clientToken }),
      ctx(setup.roomCode),
    );
    expect(res.status).toBe(403);
  });

  it("rejects starting with fewer than 2 players", async () => {
    const createRes = await createGame(postJson("http://test/api/games", {}));
    const { roomCode } = await createRes.json();
    const joinRes = await joinGame(postJson(`http://test/api/games/${roomCode}/join`, { name: "Ada", token: "danfo" }), ctx(roomCode));
    const { clientToken } = await joinRes.json();

    const res = await startGame(postJson(`http://test/api/games/${roomCode}/start`, { clientToken }), ctx(roomCode));
    expect(res.status).toBe(409);
  });

  it("the host starts the game with 2+ players", async () => {
    const setup = await createAndJoinTwo();
    const res = await startGame(
      postJson(`http://test/api/games/${setup.roomCode}/start`, { clientToken: setup.host.clientToken }),
      ctx(setup.roomCode),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("active");
    expect(body.turnPhase).toBe("awaiting_roll");
    expect(body.state.players).toHaveLength(2);
  });
});

describe("GET /api/games/[code]", () => {
  it("hides the seed while the game is active", async () => {
    const setup = await createJoinAndStart();
    const res = await getGame(getReq(`http://test/api/games/${setup.roomCode}`), ctx(setup.roomCode));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.serverSeedHash).toBe(setup.serverSeedHash);
    expect(body.serverSeed).toBeNull();
  });

  it("404s for an unknown room code", async () => {
    const res = await getGame(getReq("http://test/api/games/ZZZZZZ"), ctx("ZZZZZZ"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/games/[code]/action", () => {
  it("rejects a request from an unrecognized client token", async () => {
    const setup = await createJoinAndStart();
    const res = await postAction(
      postJson(`http://test/api/games/${setup.roomCode}/action`, { clientToken: "not-a-real-token", action: { type: "ROLL" } }),
      ctx(setup.roomCode),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an action from a player when it isn't their turn", async () => {
    const setup = await createJoinAndStart(); // host is seat 0, so it's their turn first
    const res = await postAction(
      postJson(`http://test/api/games/${setup.roomCode}/action`, { clientToken: setup.guest.clientToken, action: { type: "ROLL" } }),
      ctx(setup.roomCode),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a client-supplied dice value, cash amount, or position", async () => {
    const setup = await createJoinAndStart();
    const withDice = await postAction(
      postJson(`http://test/api/games/${setup.roomCode}/action`, {
        clientToken: setup.host.clientToken,
        action: { type: "ROLL", d1: 6, d2: 6 },
      }),
      ctx(setup.roomCode),
    );
    // zod's .strict() rejects the unknown d1/d2 fields outright.
    expect(withDice.status).toBe(400);
  });

  it("resolves ROLL server-side and appends a correctly hash-chained roll", async () => {
    const setup = await createJoinAndStart();
    const res = await postAction(
      postJson(`http://test/api/games/${setup.roomCode}/action`, { clientToken: setup.host.clientToken, action: { type: "ROLL" } }),
      ctx(setup.roomCode),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(fakeAdmin.db.rolls).toHaveLength(1);

    const roll = fakeAdmin.db.rolls[0];
    expect(roll.roll_index).toBe(0);
    expect(roll.player_id).toBe(setup.host.playerId);
    expect(roll.die_1).toBeGreaterThanOrEqual(1);
    expect(roll.die_1).toBeLessThanOrEqual(6);

    const expectedHash = hashChain("0".repeat(64), fakeAdmin.db.games[0].id, 0, setup.host.playerId, roll.die_1, roll.die_2);
    expect(roll.hash).toBe(expectedHash);
    expect(roll.prev_hash).toBe("0".repeat(64));
  });

  it("returns ok:false without writing anything when the action has no effect", async () => {
    const setup = await createJoinAndStart();
    // It's awaiting_roll, not awaiting_end_turn, so END_TURN is a no-op.
    const res = await postAction(
      postJson(`http://test/api/games/${setup.roomCode}/action`, { clientToken: setup.host.clientToken, action: { type: "END_TURN" } }),
      ctx(setup.roomCode),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(fakeAdmin.db.events).toHaveLength(0);
  });

  it("rate limits to 20 requests per 10 seconds per client token", async () => {
    const setup = await createJoinAndStart();
    let lastStatus = 200;
    for (let i = 0; i < 21; i++) {
      const res = await postAction(
        postJson(`http://test/api/games/${setup.roomCode}/action`, { clientToken: setup.host.clientToken, action: { type: "END_TURN" } }),
        ctx(setup.roomCode),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("GET /api/games/[code]/verify", () => {
  it("refuses to verify a game that hasn't finished", async () => {
    const setup = await createJoinAndStart();
    const res = await getVerify(getReq(`http://test/api/games/${setup.roomCode}`), ctx(setup.roomCode));
    expect(res.status).toBe(409);
  });

  it("reveals the seed and recomputes a valid roll ledger for a finished game", async () => {
    const setup = await createJoinAndStart();
    const game = fakeAdmin.db.games[0];
    const seed = fakeAdmin.db.gameSecrets[0].server_seed;

    const { d1, d2 } = rollFor(seed, game.id, 0); // must match the seed to verify as fair
    const hash = hashChain("0".repeat(64), game.id, 0, setup.host.playerId, d1, d2);
    fakeAdmin.db.rolls.push({
      game_id: game.id,
      roll_index: 0,
      player_id: setup.host.playerId,
      die_1: d1,
      die_2: d2,
      prev_hash: "0".repeat(64),
      hash,
    });
    game.status = "finished";

    const res = await getVerify(getReq(`http://test/api/games/${setup.roomCode}`), ctx(setup.roomCode));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.serverSeed).toBe(seed);
    expect(body.rolls).toHaveLength(1);
    expect(body.verification.ok).toBe(true);
    expect(body.verification.diceOk).toBe(true);
    expect(body.verification.chainOk).toBe(true);
  });

  it("flags a tampered roll in the ledger", async () => {
    const setup = await createJoinAndStart();
    const game = fakeAdmin.db.games[0];

    const hash = hashChain("0".repeat(64), game.id, 0, setup.host.playerId, 3, 4);
    fakeAdmin.db.rolls.push({
      game_id: game.id,
      roll_index: 0,
      player_id: setup.host.playerId,
      die_1: 6, // tampered: doesn't match what hash was computed from
      die_2: 6,
      prev_hash: "0".repeat(64),
      hash,
    });
    game.status = "finished";

    const res = await getVerify(getReq(`http://test/api/games/${setup.roomCode}`), ctx(setup.roomCode));
    const body = await res.json();

    expect(body.verification.ok).toBe(false);
    expect(body.verification.diceMismatches).toEqual([0]);
  });
});
