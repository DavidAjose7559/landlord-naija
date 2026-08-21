// Persists a player's seat in a game across refreshes. Keyed by room code
// (not a single global key) so a browser can hold a seat in more than one
// room at once.

export interface PlayerSession {
  playerId: string;
  clientToken: string;
}

function storageKey(roomCode: string): string {
  return `landlord-naija:${roomCode}`;
}

export function loadSession(roomCode: string): PlayerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(roomCode));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as PlayerSession).playerId === "string" &&
      typeof (parsed as PlayerSession).clientToken === "string"
    ) {
      return parsed as PlayerSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(roomCode: string, session: PlayerSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(roomCode), JSON.stringify(session));
  } catch {
    // localStorage can throw (private browsing, quota) — not persisting a
    // seat isn't fatal, the player just has to rejoin after a refresh.
  }
}

export function clearSession(roomCode: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(roomCode));
  } catch {
    // ignore
  }
}
