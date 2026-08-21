// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { FakeSupabaseAdmin } from "./fakeSupabase";

vi.mock("@/lib/supabase/server", async () => {
  const { FakeSupabaseAdmin } = await import("./fakeSupabase");
  return { supabaseAdmin: new FakeSupabaseAdmin() };
});

import { POST as createGame } from "@/app/api/games/route";
import { POST as joinGame } from "@/app/api/games/[code]/join/route";
import { POST as startGame } from "@/app/api/games/[code]/start/route";
import { POST as postAction } from "@/app/api/games/[code]/action/route";
import { POST as seedState } from "@/app/api/dev/seed-state/route";

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

async function createJoinAndStart() {
  const createRes = await createGame(postJson("http://test/api/games", { settings: { randomizePlayerOrder: false } }));
  const { roomCode } = await createRes.json();

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

  await startGame(postJson(`http://test/api/games/${roomCode}/start`, { clientToken: join1.clientToken }), ctx(roomCode));

  return {
    roomCode,
    host: { playerId: join1.playerId, clientToken: join1.clientToken },
    guest: { playerId: join2.playerId, clientToken: join2.clientToken },
  };
}

beforeEach(() => {
  fakeAdmin.reset();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEV_HARNESS_SECRET", "test-harness-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/dev/seed-state", () => {
  it("returns 404 when NODE_ENV is production, even with a correct secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { roomCode } = await createJoinAndStart();

    const res = await seedState(
      postJson("http://test/api/dev/seed-state", { devSecret: "test-harness-secret", roomCode, confirmActive: true }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when DEV_HARNESS_SECRET isn't configured at all", async () => {
    vi.stubEnv("DEV_HARNESS_SECRET", "");
    const { roomCode } = await createJoinAndStart();

    const res = await seedState(
      postJson("http://test/api/dev/seed-state", { devSecret: "anything", roomCode, confirmActive: true }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 401/403) when the provided secret doesn't match", async () => {
    const { roomCode } = await createJoinAndStart();

    const res = await seedState(
      postJson("http://test/api/dev/seed-state", { devSecret: "wrong-secret", roomCode, confirmActive: true }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses to seed an active game without confirmActive: true", async () => {
    const { roomCode, host } = await createJoinAndStart();

    const res = await seedState(
      postJson("http://test/api/dev/seed-state", {
        devSecret: "test-harness-secret",
        roomCode,
        confirmActive: false,
        players: { [host.playerId]: { cashCents: 5000 } },
      }),
    );
    expect(res.status).toBe(409);

    // and nothing actually changed
    const gameRes = await seedState(
      postJson("http://test/api/dev/seed-state", { devSecret: "test-harness-secret", roomCode, confirmActive: true }),
    );
    const body = await gameRes.json();
    const hostAfter = body.state.players.find((p: { id: string }) => p.id === host.playerId);
    expect(hostAfter.cashCents).not.toBe(5000);
  });

  it("patches player cash, jail status, and property ownership on an active game with confirmActive: true", async () => {
    const { roomCode, host, guest } = await createJoinAndStart();

    const res = await seedState(
      postJson("http://test/api/dev/seed-state", {
        devSecret: "test-harness-secret",
        roomCode,
        confirmActive: true,
        players: {
          [host.playerId]: { cashCents: 5000, inJail: true, jailTurns: 2 },
        },
        ownership: {
          "37": { ownerId: guest.playerId, hotel: true },
        },
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    const hostAfter = body.state.players.find((p: { id: string }) => p.id === host.playerId);
    expect(hostAfter.cashCents).toBe(5000);
    expect(hostAfter.inJail).toBe(true);
    expect(hostAfter.jailTurns).toBe(2);
    expect(body.state.ownership["37"]).toMatchObject({
      ownerId: guest.playerId,
      hotel: true,
      houses: 0,
      mortgaged: false,
    });
  });

  it("landOn positions a player so their next real ROLL lands exactly on the target space", async () => {
    const { roomCode, host } = await createJoinAndStart();

    const seedRes = await seedState(
      postJson("http://test/api/dev/seed-state", {
        devSecret: "test-harness-secret",
        roomCode,
        confirmActive: true,
        landOn: { playerId: host.playerId, spaceIndex: 24 },
      }),
    );
    expect(seedRes.status).toBe(200);
    const seeded = await seedRes.json();
    expect(seeded.turnPhase).toBe("awaiting_roll");

    const rollRes = await postAction(
      postJson(`http://test/api/games/${roomCode}/action`, { clientToken: host.clientToken, action: { type: "ROLL" } }),
      ctx(roomCode),
    );
    const rolled = await rollRes.json();
    const hostAfter = rolled.state.players.find((p: { id: string }) => p.id === host.playerId);
    expect(hostAfter.position).toBe(24);
  });
});
