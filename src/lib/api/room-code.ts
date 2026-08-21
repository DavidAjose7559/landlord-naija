import "server-only";

import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Matches the games.room_code CHECK constraint: ^[A-Z0-9]{6}$.
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}
