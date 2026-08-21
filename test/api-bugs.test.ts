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
import { POST as postBug, GET as getBugs } from "@/app/api/bugs/route";
import { PATCH as patchBug } from "@/app/api/bugs/[id]/route";

const fakeAdmin = supabaseAdmin as unknown as FakeSupabaseAdmin;

function ctx(code: string) {
  return { params: Promise.resolve({ code }) };
}
function idCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

// x-forwarded-for defaults to a per-call random value so tests that post
// without a clientToken (falling back to the IP-keyed rate-limit bucket)
// don't collide with each other's bucket across the file — only the
// dedicated rate-limit test deliberately reuses one identity.
function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `test-${Math.random().toString(36).slice(2)}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
function patchJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CLIENT_ENV = {
  userAgent: "vitest",
  viewportWidth: 1280,
  viewportHeight: 800,
  online: true,
  devicePixelRatio: 2,
};

function bugPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    roomCode: "AAAAAA",
    path: "/game/AAAAAA",
    description: "the dice sound never stops looping",
    severity: "annoying",
    commitSha: "deadbeef",
    client: CLIENT_ENV,
    diagnostics: [],
    ...overrides,
  };
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
  vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/bugs", () => {
  it("does not mutate game state — the game row is byte-identical before and after", async () => {
    const { roomCode, guest } = await createJoinAndStart();

    const before = await getGame(new Request(`http://test/api/games/${roomCode}`), ctx(roomCode));
    const beforeBody = await before.json();

    const res = await postBug(
      postJson("http://test/api/bugs", bugPayload({ roomCode, clientToken: guest.clientToken })),
    );
    expect(res.status).toBe(201);

    const after = await getGame(new Request(`http://test/api/games/${roomCode}`), ctx(roomCode));
    const afterBody = await after.json();

    expect(afterBody).toEqual(beforeBody);
  });

  it("still accepts a report with no clientToken at all (spectator)", async () => {
    const { roomCode } = await createJoinAndStart();

    const res = await postBug(postJson("http://test/api/bugs", bugPayload({ roomCode })));
    expect(res.status).toBe(201);

    expect(fakeAdmin.db.bugReports).toHaveLength(1);
    expect(fakeAdmin.db.bugReports[0].reporter_player_id).toBeNull();
    expect(fakeAdmin.db.bugReports[0].snapshot.reporter.name).toBe("Spectator");
  });

  it("captures a full snapshot: settings, mapId, turn info, players, and reporter identity", async () => {
    const { roomCode, host } = await createJoinAndStart();

    const res = await postBug(
      postJson("http://test/api/bugs", bugPayload({ roomCode, clientToken: host.clientToken })),
    );
    expect(res.status).toBe(201);

    const row = fakeAdmin.db.bugReports[0];
    expect(row.snapshot.game.room.roomCode).toBe(roomCode);
    expect(row.snapshot.game.room.mapId).toBe("naija");
    expect(row.snapshot.game.turn.turnPhase).toBe("awaiting_roll");
    expect(row.snapshot.game.players).toHaveLength(2);
    expect(row.snapshot.reporter.playerId).toBe(host.playerId);
    expect(row.snapshot.reporter.name).toBe("Ada");
    expect(row.snapshot.client.userAgent).toBe("vitest");
  });

  it("submits successfully with no roomCode at all — the game field is simply omitted", async () => {
    const res = await postBug(
      postJson(
        "http://test/api/bugs",
        bugPayload({ roomCode: undefined, path: "/rules", description: "the rules page has a typo" }),
      ),
    );
    expect(res.status).toBe(201);

    const row = fakeAdmin.db.bugReports[0];
    expect(row.game_id).toBeNull();
    expect(row.room_code).toBeNull();
    expect(row.snapshot.game).toBeNull();
    expect(row.snapshot.path).toBe("/rules");
    expect(row.snapshot.reporter.playerId).toBeNull();
    expect(row.snapshot.reporter.name).toBe("Anonymous");
    expect(row.snapshot.client.userAgent).toBe("vitest");
    expect(row.description).toBe("the rules page has a typo");
  });

  it("rejects the 6th report from the same player within the rate-limit window", async () => {
    const { roomCode, host } = await createJoinAndStart();

    for (let i = 0; i < 5; i++) {
      const res = await postBug(
        postJson("http://test/api/bugs", bugPayload({ roomCode, clientToken: host.clientToken })),
      );
      expect(res.status).toBe(201);
    }

    const sixth = await postBug(
      postJson("http://test/api/bugs", bugPayload({ roomCode, clientToken: host.clientToken })),
    );
    expect(sixth.status).toBe(429);
    expect(fakeAdmin.db.bugReports).toHaveLength(5);
  });

  it("rejects an empty description", async () => {
    const { roomCode } = await createJoinAndStart();
    const res = await postBug(postJson("http://test/api/bugs", bugPayload({ roomCode, description: "" })));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/bugs", () => {
  it("returns 404 without a secret", async () => {
    const { roomCode } = await createJoinAndStart();
    await postBug(postJson("http://test/api/bugs", bugPayload({ roomCode })));

    const res = await getBugs(new Request("http://test/api/bugs"));
    expect(res.status).toBe(404);
  });

  it("returns 404 with the wrong secret", async () => {
    const res = await getBugs(new Request("http://test/api/bugs?secret=wrong"));
    expect(res.status).toBe(404);
  });

  it("returns markdown for open reports with the right secret", async () => {
    const { roomCode } = await createJoinAndStart();
    await postBug(postJson("http://test/api/bugs", bugPayload({ roomCode, description: "board renders blank" })));

    const res = await getBugs(new Request("http://test/api/bugs?secret=test-admin-secret&unresolved=true"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("board renders blank");
    expect(text).toContain("Repro hint:");
  });
});

describe("PATCH /api/bugs/[id]", () => {
  it("returns 404 without the secret and does not change the row", async () => {
    const { roomCode } = await createJoinAndStart();
    await postBug(postJson("http://test/api/bugs", bugPayload({ roomCode })));
    const id = fakeAdmin.db.bugReports[0].id;

    const res = await patchBug(patchJson(`http://test/api/bugs/${id}`, { resolved: true }), idCtx(id));
    expect(res.status).toBe(404);
    expect(fakeAdmin.db.bugReports[0].resolved).toBe(false);
  });

  it("toggles resolved with the right secret", async () => {
    const { roomCode } = await createJoinAndStart();
    await postBug(postJson("http://test/api/bugs", bugPayload({ roomCode })));
    const id = fakeAdmin.db.bugReports[0].id;

    const res = await patchBug(
      patchJson(`http://test/api/bugs/${id}?secret=test-admin-secret`, { resolved: true }),
      idCtx(id),
    );
    expect(res.status).toBe(200);
    expect(fakeAdmin.db.bugReports[0].resolved).toBe(true);
  });
});
