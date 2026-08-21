"use client";

import { installDiagnostics } from "@/lib/diagnostics";

// Called at module scope (not inside useEffect) so the console/network
// ring buffer is listening from the moment this client bundle evaluates —
// before first paint, not just after first mount — well before anyone
// opens the bug report form. installDiagnostics() no-ops during SSR
// (guards on `typeof window`) and only ever wires its listeners once.
// Mounted in the root layout; renders nothing.
installDiagnostics();

export function DiagnosticsBoot() {
  return null;
}
