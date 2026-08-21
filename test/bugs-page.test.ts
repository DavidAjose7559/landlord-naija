// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isHTTPAccessFallbackError, getAccessFallbackHTTPStatus } from "next/dist/client/components/http-access-fallback/http-access-fallback";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { FakeSupabaseAdmin } from "./fakeSupabase";

vi.mock("@/lib/supabase/server", async () => {
  const { FakeSupabaseAdmin } = await import("./fakeSupabase");
  return { supabaseAdmin: new FakeSupabaseAdmin() };
});

import BugsPage from "@/app/bugs/page";

const fakeAdmin = supabaseAdmin as unknown as FakeSupabaseAdmin;

beforeEach(() => {
  fakeAdmin.reset();
  vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/bugs page", () => {
  it("404s (via next/navigation notFound) with no secret", async () => {
    await expect(BugsPage({ searchParams: Promise.resolve({}) })).rejects.toSatisfy((err: unknown) => {
      return isHTTPAccessFallbackError(err) && getAccessFallbackHTTPStatus(err as never) === 404;
    });
  });

  it("404s with the wrong secret", async () => {
    await expect(BugsPage({ searchParams: Promise.resolve({ secret: "wrong" }) })).rejects.toSatisfy((err: unknown) => {
      return isHTTPAccessFallbackError(err) && getAccessFallbackHTTPStatus(err as never) === 404;
    });
  });

  it("renders (does not throw) with the right secret", async () => {
    await expect(BugsPage({ searchParams: Promise.resolve({ secret: "test-admin-secret" }) })).resolves.toBeTruthy();
  });
});
