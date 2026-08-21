import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminAuthorized } from "@/lib/api/admin-auth";
import { callRpc } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";

const patchSchema = z.object({ resolved: z.boolean() }).strict();

// Only field the /bugs review page can change on a report — everything
// else (the snapshot, description, severity) is a record of what
// happened, not editable after the fact.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    if (!isAdminAuthorized(url.searchParams.get("secret"))) {
      throw new ApiError(404, "not found");
    }

    const body = await parseJsonBody(request, patchSchema);
    await callRpc("set_bug_report_resolved", { p_id: id, p_resolved: body.resolved });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
