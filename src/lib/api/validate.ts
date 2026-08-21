import "server-only";

import { z, type ZodType } from "zod";
import { ApiError, zodErrorMessage } from "./errors";

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    const text = await request.text();
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "invalid JSON body");
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError(400, zodErrorMessage(result.error));
  }
  return result.data;
}

const roomCodeSchema = z.string().regex(/^[A-Z0-9]{6}$/, "invalid room code");

export function parseRoomCode(code: string): string {
  const result = roomCodeSchema.safeParse(code);
  if (!result.success) throw new ApiError(400, "invalid room code");
  return result.data;
}
