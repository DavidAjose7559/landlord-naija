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
import { GET as getGame } from "@/app/api/games/[code]/route";
import { POST as postChat } from "@/app/api/games/[code]/chat/route";

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

async function createAndJoin() {
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

  return {
    roomCode,
    host: { playerId: join1.playerId, clientToken: join1.clientToken },
    guest: { playerId: join2.playerId, clientToken: join2.clientToken },
  };
}

async function createJoinAndStart() {
  const setup = await createAndJoin();
  await startGame(postJson(`http://test/api/games/${setup.roomCode}/start`, { clientToken: setup.host.clientToken }), ctx(setup.roomCode));
  return setup;
}

beforeEach(() => {
  fakeAdmin.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/games/[code]/chat", () => {
  it("does not mutate game state — the game row is byte-identical before and after", async () => {
    const { roomCode, host } = await createJoinAndStart();

    const before = await getGame(new Request(`http://test/api/games/${roomCode}`), ctx(roomCode));
    const beforeBody = await before.json();

    const res = await postChat(
      postJson(`http://test/api/games/${roomCode}/chat`, { clientToken: host.clientToken, body: "gl everyone" }),
      ctx(roomCode),
    );
    expect(res.status).toBe(201);

    const after = await getGame(new Request(`http://test/api/games/${roomCode}`), ctx(roomCode));
    const afterBody = await after.json();

    expect(afterBody).toEqual(beforeBody);
  });

  it("works in the lobby, before the game has started", async () => {
    const { roomCode, host } = await createAndJoin();

    const res = await postChat(
      postJson(`http://test/api/games/${roomCode}/chat`, { clientToken: host.clientToken, body: "hey!" }),
      ctx(roomCode),
    );
    expect(res.status).toBe(201);
    expect(fakeAdmin.db.messages).toHaveLength(1);
  });

  it("stores the sender's player_id, game_id, and body", async () => {
    const { roomCode, host } = await createJoinAndStart();

    await postChat(
      postJson(`http://test/api/games/${roomCode}/chat`, { clientToken: host.clientToken, body: "nice roll" }),
      ctx(roomCode),
    );

    const game = fakeAdmin.db.games[0];
    const row = fakeAdmin.db.messages[0];
    expect(row.game_id).toBe(game.id);
    expect(row.player_id).toBe(host.playerId);
    expect(row.body).toBe("nice roll");
  });

  it("rejects a spectator — no clientToken at all", async () => {
    const { roomCode } = await createJoinAndStart();

    const res = await postChat(postJson(`http://test/api/games/${roomCode}/chat`, { clientToken: "", body: "hi" }), ctx(roomCode));
    expect(res.status).toBe(400); // empty clientToken fails the min(1) schema check
    expect(fakeAdmin.db.messages).toHaveLength(0);
  });

  it("rejects an invalid clientToken that isn't a real player", async () => {
    const { roomCode } = await createJoinAndStart();

    const res = await postChat(
      postJson(`http://test/api/games/${roomCode}/chat`, { clientToken: "not-a-real-token", body: "hi" }),
      ctx(roomCode),
    );
    expect(res.status).toBe(401);
    expect(fakeAdmin.db.messages).toHaveLength(0);
  });

  it("rejects an empty message", async () => {
    const { roomCode, host } = await createJoinAndStart();
    const res = await postChat(
      postJson(`http://test/api/games/${roomCode}/chat`, { clientToken: host.clientToken, body: "   " }),
      ctx(roomCode),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a message over 300 characters", async () => {
    const { roomCode, host } = await createJoinAndStart();
    const res = await postChat(
      postJson(`http://test/api/games/${roomCode}/chat`, { clientToken: host.clientToken, body: "x".repeat(301) }),
      ctx(roomCode),
    );
    expect(res.status).toBe(400);
  });

  it("rejects the 11th message from the same player within the rate-limit window", async () => {
    const { roomCode, host } = await createJoinAndStart();

    for (let i = 0; i < 10; i++) {
      const res = await postChat(
        postJson(`http://test/api/games/${roomCode}/chat`, { clientToken: host.clientToken, body: `msg ${i}` }),
        ctx(roomCode),
      );
      expect(res.status).toBe(201);
    }

    const eleventh = await postChat(
      postJson(`http://test/api/games/${roomCode}/chat`, { clientToken: host.clientToken, body: "one more" }),
      ctx(roomCode),
    );
    expect(eleventh.status).toBe(429);
    expect(fakeAdmin.db.messages).toHaveLength(10);
  });
});
