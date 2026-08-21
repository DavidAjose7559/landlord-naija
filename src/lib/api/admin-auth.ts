import "server-only";

// Gates GET/PATCH /api/bugs and the /bugs review page. Deliberately NOT the
// DEV_HARNESS_SECRET/NODE_ENV pattern: bug reports are only useful once
// there's a production audience filing them, so the review surface must
// stay reachable in production — the secret is what keeps it private, not
// an environment check. Same "wrong secret looks identical to no secret"
// shape as the dev harness otherwise: a bad guess gets a plain 404, never
// a 401/403 that would confirm the route exists.
export function isAdminAuthorized(secret: string | null | undefined): boolean {
  const configured = process.env.ADMIN_SECRET;
  if (!configured) return false;
  if (!secret) return false;
  return secret === configured;
}
