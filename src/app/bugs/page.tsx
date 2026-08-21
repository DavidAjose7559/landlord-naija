import { notFound } from "next/navigation";
import { isAdminAuthorized } from "@/lib/api/admin-auth";
import { loadBugReports } from "@/lib/api/bug-reports";
import { BugsList } from "@/components/BugsList";

// Review surface for every bug report filed via the in-game button.
// Deliberately NOT gated on NODE_ENV — reports only matter once there's a
// real audience filing them, so this has to stay reachable in production.
// ADMIN_SECRET (passed as ?secret=) is what keeps it private instead: no
// secret configured, or the wrong one, both render the plain 404 page —
// never a 401/403 that would confirm this route exists to someone probing
// without it.
export default async function BugsPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams;
  if (!isAdminAuthorized(secret)) {
    notFound();
  }

  const reports = await loadBugReports();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 bg-canvas px-6 py-12">
      <div>
        <h1 className="text-lg font-bold text-ink">Bug reports</h1>
        <p className="text-xs text-muted">
          {reports.length} report{reports.length === 1 ? "" : "s"} — newest first.
        </p>
      </div>
      <BugsList reports={reports} secret={secret ?? ""} />
    </div>
  );
}
