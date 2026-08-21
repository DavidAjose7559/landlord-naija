"use client";

import { installBreadcrumbs } from "@/lib/breadcrumbs";
import { installDiagnostics } from "@/lib/diagnostics";

// Called at module scope (not inside useEffect) so both ring buffers are
// listening from the moment this client bundle evaluates — before first
// paint, not just after first mount — well before anyone opens the bug
// report form. Both installers no-op during SSR (guard on `typeof
// window`) and only ever wire their listeners once. Mounted in the root
// layout; renders nothing.
installDiagnostics();
installBreadcrumbs();

export function DiagnosticsBoot() {
  return null;
}
