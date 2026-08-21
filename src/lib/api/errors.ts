import "server-only";

import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function zodErrorMessage(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // Anything else is a bug, not a client mistake — don't leak internals.
  console.error(error);
  return NextResponse.json({ error: "internal server error" }, { status: 500 });
}
