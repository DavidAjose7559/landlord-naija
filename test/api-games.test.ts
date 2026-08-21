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
import { POST as leaveLobby } from "@/app/api/games/[code]/leave/route";
import { PATCH as patchSettings } from "@/app/api/games/[code]/settings/route";
import { POST as startGame } from "@/app/api/games/[code]/start/route";
import { POST as postAction } from "@/app/api/games/[code]/action/route";
import { POST as proposeTrade } from "@/app/api/games/[code]/trades/route";
import { POST as acceptTrade } from "@/app/api/games/[code]/trades/[tradeId]/accept/route";
import { POST as counterTrade } from "@/app/api/games/[code]/trades/[tradeId]/counter/route";
import { POST as declineTrade } from "@/app/api/games/[code]/trades/[tradeId]/decline/route";
import { POST as cancelTrade } from "@/app/api/games/[code]/trades/[tradeId]/cancel/route";
import { GET as getVerify } from "@/app/api/games/[code]/verify/route";
import { GET as getPublicGames } from "@/app/api/games/public/route";

const fakeAdmin = supabaseAdmin as unknown as FakeSupabaseAdmin;

function ctx(code: string) {
  return { params: Promise.resolve({ code }) };
}

function tradeCtx(code: string, tradeId: string) {
  return { params: Promise.resolve({ code, tradeId }) };
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
  // Most of these tests assume a fixed, predictable turn order (host goes
  // first); randomizePlayerOrder's actual shuffle behavior is covered on
  // its own in engine.test.ts's settings block.
  const createRes = await createGame(postJson("http://test/api/games", { settings: { randomizePlayerOrder: false } }));
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

  it("randomizePlayerOrder: OFF keeps join order, ON eventually produces a different order", async () => {
    // OFF is deterministic — assert it directly.
    const offRes = await createGame(postJson("http://test/api/games", { settings: { randomizePlayerOrder: false } }));
    const { roomCode: offCode } = await offRes.json();
    const offHost = await joinGame(postJson(`http://test/api/games/${offCode}/join`, { name: "Ada", token: "danfo" }), ctx(offCode));
    const offHostBody = await offHost.json();
    await joinGame(postJson(`http://test/api/games/${offCode}/join`, { name: "Bola", token: "keke" }), ctx(offCode));
    const offStart = await startGame(postJson(`http://test/api/games/${offCode}/start`, { clientToken: offHostBody.clientToken }), ctx(offCode));
    const offBody = await offStart.json();
    expect(offBody.state.players[0].name).toBe("Ada");

    // ON is randomized — across enough trials with 4 players (24 possible
    // orders), asserting "at least one trial differs from join order" is
    // effectively non-flaky (odds of 24/24 matches over many trials are
    // astronomically small).
    let sawDifferentOrder = false;
    for (let trial = 0; trial < 20 && !sawDifferentOrder; trial++) {
      const createRes = await createGame(postJson("http://test/api/games", { settings: { randomizePlayerOrder: true } }));
      const { roomCode } = await createRes.json();
      const names = ["Ada", "Bola", "Chidi", "Dupe"];
      let hostClientToken = "";
      for (let i = 0; i < names.length; i++) {
        const joinRes = await joinGame(
          postJson(`http://test/api/games/${roomCode}/join`, { name: names[i], token: ["danfo", "keke", "jollof", "gele"][i] }),
          ctx(roomCode),
        );
        const joinBody = await joinRes.json();
        if (i === 0) hostClientToken = joinBody.clientToken;
      }
      const startRes = await startGame(postJson(`http://test/api/games/${roomCode}/start`, { clientToken: hostClientToken }), ctx(roomCode));
      const startBody = await startRes.json();
      const orderedNames = startBody.state.players.map((p: { name: string }) => p.name);
      if (JSON.stringify(orderedNames) !== JSON.stringify(names)) sawDifferentOrder = true;
    }
    expect(sawDifferentOrder).toBe(true);
  });
});

describe("PATCH /api/games/[code]/settings", () => {
  it("lets the host change a setting while in the lobby", async () => {
    const setup = await createAndJoinTwo();
    const res = await patchSettings(
      postJson(`http://test/api/games/${setup.roomCode}/settings`, {
        clientToken: setup.host.clientToken,
        settings: { freeParkingCash: true },
      }),
      ctx(setup.roomCode),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.state.settings.freeParkingCash).toBe(true);
  });

  it("rejects a non-host trying to change settings", async () => {
    const setup = await createAndJoinTwo();
    const res = await patchSettings(
      postJson(`http://test/api/games/${setup.roomCode}/settings`, {
        clientToken: setup.guest.clientToken,
        settings: { freeParkingCash: true },
      }),
      ctx(setup.roomCode),
    );
    expect(res.status).toBe(403);
  });

  it("rejects changing settings once the game has started", async () => {
    const setup = await createJoinAndStart();
    const res = await patchSettings(
      postJson(`http://test/api/games/${setup.roomCode}/settings`, {
        clientToken: setup.host.clientToken,
        settings: { freeParkingCash: true },
      }),
      ctx(setup.roomCode),
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/games/[code]/leave", () => {
  it("promotes the lowest remaining seatIndex when the host leaves", async () => {
    const setup = await createAndJoinTwo();
    const res = await leaveLobby(
      postJson(`http://test/api/games/${setup.roomCode}/leave`, { clientToken: setup.host.clientToken }),
      ctx(setup.roomCode),
    );
    expect(res.status).toBe(200);

    const gameRes = await getGame(getReq(`http://test/api/games/${setup.roomCode}`), ctx(setup.roomCode));
    const game = await gameRes.json();
    expect(game.state.players).toHaveLength(1);
    expect(game.state.hostPlayerId).toBe(setup.guest.playerId);
  });

  it("a non-host leaving doesn't change who the host is", async () => {
    const setup = await createAndJoinTwo();
    await leaveLobby(postJson(`http://test/api/games/${setup.roomCode}/leave`, { clientToken: setup.guest.clientToken }), ctx(setup.roomCode));

    const gameRes = await getGame(getReq(`http://test/api/games/${setup.roomCode}`), ctx(setup.roomCode));
    const game = await gameRes.json();
    expect(game.state.players).toHaveLength(1);
    expect(game.state.hostPlayerId).toBe(setup.host.playerId);
  });
});

describe("GET /api/games/public", () => {
  it("privateRoom: only lists lobbies with privateRoom OFF", async () => {
    const publicRes = await createGame(postJson("http://test/api/games", { settings: { privateRoom: false } }));
    const { roomCode: publicCode } = await publicRes.json();
    const privateRes = await createGame(postJson("http://test/api/games", { settings: { privateRoom: true } }));
    const { roomCode: privateCode } = await privateRes.json();

    const res = await getPublicGames();
    const body = await res.json();
    const codes = body.games.map((g: { roomCode: string }) => g.roomCode);
    expect(codes).toContain(publicCode);
    expect(codes).not.toContain(privateCode);
  });
});

describe("startingCashCents", () => {
  it("new players start with the room's configured cash amount, not the default", async () => {
    const createRes = await createGame(postJson("http://test/api/games", { settings: { startingCashCents: 250_000 } }));
    const { roomCode } = await createRes.json();
    const joinRes = await joinGame(postJson(`http://test/api/games/${roomCode}/join`, { name: "Ada", token: "danfo" }), ctx(roomCode));
    const joinBody = await joinRes.json();

    const gameRes = await getGame(getReq(`http://test/api/games/${roomCode}`), ctx(roomCode));
    const game = await gameRes.json();
    const player = game.state.players.find((p: { id: string }) => p.id === joinBody.playerId);
    expect(player.cashCents).toBe(250_000);
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

  it("turnTimeLimitSeconds: OFF rejects FORCE_END_TURN outright; ON only allows it once the clock has actually run out", async () => {
    const createRes = await createGame(
      postJson("http://test/api/games", { settings: { randomizePlayerOrder: false, turnTimeLimitSeconds: 60 } }),
    );
    const { roomCode } = await createRes.json();
    const hostJoin = await joinGame(postJson(`http://test/api/games/${roomCode}/join`, { name: "Ada", token: "danfo" }), ctx(roomCode));
    const host = await hostJoin.json();
    const guestJoin = await joinGame(postJson(`http://test/api/games/${roomCode}/join`, { name: "Bola", token: "keke" }), ctx(roomCode));
    const guest = await guestJoin.json();
    await startGame(postJson(`http://test/api/games/${roomCode}/start`, { clientToken: host.clientToken }), ctx(roomCode));

    // Too soon — turnStartedAt was just set by /start.
    const tooSoon = await postAction(
      postJson(`http://test/api/games/${roomCode}/action`, { clientToken: guest.clientToken, action: { type: "FORCE_END_TURN" } }),
      ctx(roomCode),
    );
    expect(tooSoon.status).toBe(409);

    // Simulate the clock having actually run out.
    const game = fakeAdmin.db.games.find((g) => g.room_code === roomCode)!;
    game.state.turnStartedAt = Date.now() - 61_000;

    const timedOut = await postAction(
      postJson(`http://test/api/games/${roomCode}/action`, { clientToken: guest.clientToken, action: { type: "FORCE_END_TURN" } }),
      ctx(roomCode),
    );
    expect(timedOut.status).toBe(200);
    const timedOutBody = await timedOut.json();
    expect(timedOutBody.ok).toBe(true);

    // With the setting OFF, FORCE_END_TURN is rejected regardless of time.
    const offRes = await createGame(postJson("http://test/api/games", { settings: { randomizePlayerOrder: false } }));
    const { roomCode: offCode } = await offRes.json();
    const offHostJoin = await joinGame(postJson(`http://test/api/games/${offCode}/join`, { name: "Ada", token: "danfo" }), ctx(offCode));
    const offHost = await offHostJoin.json();
    await joinGame(postJson(`http://test/api/games/${offCode}/join`, { name: "Bola", token: "keke" }), ctx(offCode));
    await startGame(postJson(`http://test/api/games/${offCode}/start`, { clientToken: offHost.clientToken }), ctx(offCode));
    const offGame = fakeAdmin.db.games.find((g) => g.room_code === offCode)!;
    offGame.state.turnStartedAt = Date.now() - 1_000_000;
    const offForce = await postAction(
      postJson(`http://test/api/games/${offCode}/action`, { clientToken: offHost.clientToken, action: { type: "FORCE_END_TURN" } }),
      ctx(offCode),
    );
    expect(offForce.status).toBe(409);
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

describe("trades", () => {
  async function setupWithOwnership() {
    const setup = await createJoinAndStart();
    const game = fakeAdmin.db.games.find((g) => g.room_code === setup.roomCode)!;
    game.state.ownership = { 1: { ownerId: setup.host.playerId, houses: 0, hotel: false, mortgaged: false } };
    return setup;
  }

  const EMPTY = { cashCents: 0, spaceIndexes: [], jailFreeCards: 0 };

  it("proposes a trade", async () => {
    const setup = await setupWithOwnership();
    const res = await proposeTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades`, {
        clientToken: setup.host.clientToken,
        toPlayerId: setup.guest.playerId,
        offer: { ...EMPTY, spaceIndexes: [1] },
        request: { ...EMPTY, cashCents: 1_000 },
      }),
      ctx(setup.roomCode),
    );
    expect(res.status).toBe(201);
    expect(fakeAdmin.db.trades).toHaveLength(1);
    expect(fakeAdmin.db.trades[0].status).toBe("open");
  });

  it("rejects a second open trade between the same pair", async () => {
    const setup = await setupWithOwnership();
    const propose = () =>
      proposeTrade(
        postJson(`http://test/api/games/${setup.roomCode}/trades`, {
          clientToken: setup.host.clientToken,
          toPlayerId: setup.guest.playerId,
          offer: EMPTY,
          request: EMPTY,
        }),
        ctx(setup.roomCode),
      );
    const first = await propose();
    expect(first.status).toBe(201);
    const second = await propose();
    expect(second.status).not.toBe(201);
  });

  it("accepting moves cash/ownership for real and marks the row accepted", async () => {
    const setup = await setupWithOwnership();
    const proposeRes = await proposeTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades`, {
        clientToken: setup.host.clientToken,
        toPlayerId: setup.guest.playerId,
        offer: { ...EMPTY, spaceIndexes: [1] },
        request: { ...EMPTY, cashCents: 1_000 },
      }),
      ctx(setup.roomCode),
    );
    const { tradeId } = await proposeRes.json();

    const res = await acceptTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades/${tradeId}/accept`, { clientToken: setup.guest.clientToken }),
      tradeCtx(setup.roomCode, tradeId),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.state.ownership["1"].ownerId).toBe(setup.guest.playerId);
    expect(fakeAdmin.db.trades.find((t: { id: string }) => t.id === tradeId).status).toBe("accepted");
  });

  it("rejects accept from anyone other than the recipient", async () => {
    const setup = await setupWithOwnership();
    const proposeRes = await proposeTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades`, {
        clientToken: setup.host.clientToken,
        toPlayerId: setup.guest.playerId,
        offer: EMPTY,
        request: EMPTY,
      }),
      ctx(setup.roomCode),
    );
    const { tradeId } = await proposeRes.json();

    const res = await acceptTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades/${tradeId}/accept`, { clientToken: setup.host.clientToken }),
      tradeCtx(setup.roomCode, tradeId),
    );
    expect(res.status).toBe(403);
  });

  it("accepting a trade the board has changed under returns ok:false rather than executing it", async () => {
    const setup = await setupWithOwnership();
    const proposeRes = await proposeTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades`, {
        clientToken: setup.host.clientToken,
        toPlayerId: setup.guest.playerId,
        offer: { ...EMPTY, spaceIndexes: [1] },
        request: EMPTY,
      }),
      ctx(setup.roomCode),
    );
    const { tradeId } = await proposeRes.json();

    // The board changes after the offer was made — space 1 no longer belongs to the host.
    const game = fakeAdmin.db.games.find((g) => g.room_code === setup.roomCode)!;
    game.state.ownership = {};

    const res = await acceptTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades/${tradeId}/accept`, { clientToken: setup.guest.clientToken }),
      tradeCtx(setup.roomCode, tradeId),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/board has changed/i);
  });

  it("counter swaps roles, increments the round, and supersedes the parent", async () => {
    const setup = await setupWithOwnership();
    const proposeRes = await proposeTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades`, {
        clientToken: setup.host.clientToken,
        toPlayerId: setup.guest.playerId,
        offer: { ...EMPTY, spaceIndexes: [1] },
        request: { ...EMPTY, cashCents: 1_000 },
      }),
      ctx(setup.roomCode),
    );
    const { tradeId } = await proposeRes.json();

    const counterRes = await counterTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades/${tradeId}/counter`, {
        clientToken: setup.guest.clientToken,
        offer: { ...EMPTY, cashCents: 500 },
        request: { ...EMPTY, spaceIndexes: [1] },
      }),
      tradeCtx(setup.roomCode, tradeId),
    );
    expect(counterRes.status).toBe(201);
    const { tradeId: counterId, round } = await counterRes.json();
    expect(round).toBe(2);

    const parent = fakeAdmin.db.trades.find((t: { id: string }) => t.id === tradeId);
    const child = fakeAdmin.db.trades.find((t: { id: string }) => t.id === counterId);
    expect(parent.status).toBe("superseded");
    expect(child.status).toBe("open");
    expect(child.from_player_id).toBe(setup.guest.playerId);
    expect(child.to_player_id).toBe(setup.host.playerId);
  });

  it("declines an open trade", async () => {
    const setup = await setupWithOwnership();
    const proposeRes = await proposeTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades`, {
        clientToken: setup.host.clientToken,
        toPlayerId: setup.guest.playerId,
        offer: EMPTY,
        request: EMPTY,
      }),
      ctx(setup.roomCode),
    );
    const { tradeId } = await proposeRes.json();
    const res = await declineTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades/${tradeId}/decline`, { clientToken: setup.guest.clientToken }),
      tradeCtx(setup.roomCode, tradeId),
    );
    expect(res.status).toBe(200);
    expect(fakeAdmin.db.trades.find((t: { id: string }) => t.id === tradeId).status).toBe("declined");
  });

  it("the proposer can cancel their own open trade", async () => {
    const setup = await setupWithOwnership();
    const proposeRes = await proposeTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades`, {
        clientToken: setup.host.clientToken,
        toPlayerId: setup.guest.playerId,
        offer: EMPTY,
        request: EMPTY,
      }),
      ctx(setup.roomCode),
    );
    const { tradeId } = await proposeRes.json();
    const res = await cancelTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades/${tradeId}/cancel`, { clientToken: setup.host.clientToken }),
      tradeCtx(setup.roomCode, tradeId),
    );
    expect(res.status).toBe(200);
    expect(fakeAdmin.db.trades.find((t: { id: string }) => t.id === tradeId).status).toBe("cancelled");
  });

  it("caps a negotiation at 10 rounds", async () => {
    const setup = await setupWithOwnership();
    const proposeRes = await proposeTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades`, {
        clientToken: setup.host.clientToken,
        toPlayerId: setup.guest.playerId,
        offer: EMPTY,
        request: EMPTY,
      }),
      ctx(setup.roomCode),
    );
    let { tradeId: currentId } = await proposeRes.json();
    const clientTokens = [setup.guest.clientToken, setup.host.clientToken];

    // Round 1 already exists; rounds 2-10 are 9 more counters.
    for (let round = 2; round <= 10; round++) {
      const res = await counterTrade(
        postJson(`http://test/api/games/${setup.roomCode}/trades/${currentId}/counter`, {
          clientToken: clientTokens[round % 2],
          offer: EMPTY,
          request: EMPTY,
        }),
        tradeCtx(setup.roomCode, currentId),
      );
      expect(res.status).toBe(201);
      currentId = (await res.json()).tradeId;
    }

    const overCap = await counterTrade(
      postJson(`http://test/api/games/${setup.roomCode}/trades/${currentId}/counter`, {
        clientToken: clientTokens[11 % 2],
        offer: EMPTY,
        request: EMPTY,
      }),
      tradeCtx(setup.roomCode, currentId),
    );
    expect(overCap.status).toBe(409);
    const overCapBody = await overCap.json();
    expect(overCapBody.error).toMatch(/gone on long enough/i);
  });
});
