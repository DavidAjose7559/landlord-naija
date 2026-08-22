"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TokenIcon } from "@/components/TokenIcon";
import { useChatMessages } from "@/hooks/useChatMessages";
import { useGame } from "@/hooks/useGame";
import { PLAYER_TOKEN_LABEL, TOKEN_SETS } from "@/lib/tokens";
import { PLAYER_COLOR_HEX, PLAYER_COLOR_LABEL, PLAYER_COLORS, type PlayerColor } from "@/lib/player-colors";
import type { PlayerToken } from "@/game/types";

export default function LobbyPage() {
  const { code } = useParams<{ code: string }>();
  const roomCode = code.toUpperCase();
  const router = useRouter();
  const { game, loading, error, session, reconnecting, setSession } = useGame(roomCode);
  // Called unconditionally (before the loading/error early returns below)
  // since hooks can't be conditional — the hook itself no-ops until
  // game?.id resolves, same as every other game-derived hook here.
  const { messages } = useChatMessages(game?.id);

  const [name, setName] = useState("");
  const [token, setToken] = useState<PlayerToken | null>(null);
  const [color, setColor] = useState<PlayerColor | null>(null);
  const [tokenSetId, setTokenSetId] = useState<"naija" | "classic">("naija");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [hostChangedNotice, setHostChangedNotice] = useState<string | null>(null);
  const prevHostId = useRef<string | null>(null);

  useEffect(() => {
    if (game && game.status !== "lobby") {
      router.replace(`/game/${roomCode}`);
    }
  }, [game, roomCode, router]);

  useEffect(() => {
    if (!game) return;
    const hostId = game.state.hostPlayerId;
    if (prevHostId.current && hostId && hostId !== prevHostId.current) {
      const host = game.state.players.find((p) => p.id === hostId);
      if (host) {
        setHostChangedNotice(`${host.name} is now the host.`);
        setTimeout(() => setHostChangedNotice(null), 4000);
      }
    }
    prevHostId.current = hostId;
  }, [game]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setJoinError("pick a piece");
      return;
    }
    setJoinError(null);
    setJoining(true);
    try {
      const res = await fetch(`/api/games/${roomCode}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), token, ...(color ? { color } : {}) }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "failed to join",
        );
      }
      const { playerId, clientToken } = body as { playerId: string; clientToken: string };
      setSession({ playerId, clientToken });
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "failed to join");
    } finally {
      setJoining(false);
    }
  }

  async function handleStart(clientToken: string) {
    setStarting(true);
    try {
      await fetch(`/api/games/${roomCode}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientToken }),
      });
    } finally {
      setStarting(false);
    }
  }

  async function handleLeave(clientToken: string) {
    await fetch(`/api/games/${roomCode}/leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientToken }),
    });
    setSession(null);
  }

  function copy(text: string, which: "code" | "link") {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  if (loading) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }

  if (error && !game) {
    return <CenteredMessage>{error}</CenteredMessage>;
  }

  // Once the game has actually started, this page is just a brief stop on
  // the way to the board (see the redirect effect above) — never flash the
  // stale join form for a game that's no longer accepting new players.
  if (!game || game.status !== "lobby") return null;

  const takenTokens = new Set(game.state.players.map((p) => p.token));
  const takenColors = new Set(game.state.players.map((p) => p.color));
  const isHost = session?.playerId === game.state.hostPlayerId;
  const canStart = game.state.players.length >= 2;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center gap-10 bg-canvas px-6 py-16">
      {reconnecting && (
        <div className="flex items-center gap-2 self-stretch rounded-2xl bg-surface-2 px-4 py-2.5 text-center text-xs text-ink">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Reconnecting…
        </div>
      )}

      {hostChangedNotice && (
        <div className="self-stretch rounded-2xl bg-surface-2 px-4 py-2.5 text-center text-xs text-ink">
          {hostChangedNotice}
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => copy(roomCode, "code")}
          className="rounded-2xl bg-surface px-8 py-4 text-5xl font-bold tracking-[0.2em] text-ink transition-colors hover:bg-surface-2"
          title="Click to copy"
        >
          {roomCode}
        </button>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span>{copied === "code" ? "Copied!" : "Tap the code to copy it"}</span>
          <button
            type="button"
            onClick={() => copy(typeof window !== "undefined" ? window.location.href : "", "link")}
            className="font-medium text-accent hover:brightness-110"
          >
            {copied === "link" ? "Link copied!" : "Copy share link"}
          </button>
        </div>
      </div>

      {!session ? (
        <form onSubmit={handleJoin} className="flex w-full flex-col items-center gap-6">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={40}
            className="w-full max-w-xs rounded-full bg-surface px-6 py-3 text-center text-base text-ink placeholder:text-muted focus:outline-none"
          />
          <div className="flex w-full max-w-xs flex-col gap-3">
            <div className="flex gap-1 rounded-full bg-surface p-1">
              {TOKEN_SETS.map((set) => (
                <button
                  key={set.id}
                  type="button"
                  onClick={() => setTokenSetId(set.id)}
                  className={`flex-1 rounded-full py-1.5 text-xs font-semibold tracking-wide uppercase transition-colors ${
                    tokenSetId === set.id ? "bg-accent text-accent-foreground" : "text-muted hover:text-ink"
                  }`}
                >
                  {set.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {TOKEN_SETS.find((s) => s.id === tokenSetId)!.tokens.map((t) => {
                const takenByOther = takenTokens.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={takenByOther}
                    onClick={() => setToken(t)}
                    className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-3 text-2xl transition-colors ${
                      token === t ? "bg-accent text-accent-foreground" : "bg-surface text-ink hover:bg-surface-2"
                    } ${takenByOther ? "opacity-30" : ""}`}
                  >
                    <TokenIcon token={t} />
                    <span className="text-[11px] font-medium">{PLAYER_TOKEN_LABEL[t]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* (Task 10b) Explicit colour picker, separate from the token
              picker above — ownership rings and every player-identity dot
              key off this now, not the token. Optional: leaving it unset
              (the default) auto-assigns the most distinct remaining
              colour server-side on join, so this works even if nobody
              picks. */}
          <div className="flex w-full max-w-xs flex-col gap-2">
            <span className="px-1 text-xs font-medium tracking-widest text-muted uppercase">Colour (optional)</span>
            <div className="grid grid-cols-4 gap-2">
              {PLAYER_COLORS.map((c) => {
                const takenByOther = takenColors.has(c);
                const selected = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={takenByOther}
                    onClick={() => setColor(selected ? null : c)}
                    aria-label={PLAYER_COLOR_LABEL[c]}
                    aria-pressed={selected}
                    title={takenByOther ? `${PLAYER_COLOR_LABEL[c]} — taken` : PLAYER_COLOR_LABEL[c]}
                    className={`aspect-square rounded-full transition-transform ${
                      selected ? "ring-2 ring-ink ring-offset-2 ring-offset-canvas" : ""
                    } ${takenByOther ? "cursor-not-allowed opacity-25 grayscale" : "hover:scale-110"}`}
                    style={{ backgroundColor: PLAYER_COLOR_HEX[c] }}
                  />
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={joining || !name.trim() || !token}
            className="rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-foreground transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {joining ? "Joining…" : "Take a seat"}
          </button>
          {joinError && <p className="text-sm text-danger">{joinError}</p>}
        </form>
      ) : (
        <>
          <div className="flex w-full flex-col gap-2">
            <AnimatePresence initial={false}>
              {game.state.players.map((player) => (
                <motion.div
                  key={player.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 26 }}
                  className="flex items-center gap-4 rounded-2xl bg-surface px-5 py-3"
                >
                  <span className="relative">
                    <TokenIcon token={player.token} className="text-2xl" />
                    <span
                      className="absolute -right-1 -bottom-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface"
                      style={{ backgroundColor: PLAYER_COLOR_HEX[player.color] }}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="flex-1 text-left font-medium text-ink">{player.name}</span>
                  {player.id === game.state.hostPlayerId && <span className="text-xs font-semibold text-accent">HOST</span>}
                  {player.id === session.playerId && <span className="text-xs text-muted">you</span>}
                </motion.div>
              ))}
            </AnimatePresence>
            {game.state.players.length < game.state.settings.maxPlayers && (
              <p className="px-5 py-2 text-sm text-muted">Waiting for more players to join…</p>
            )}
          </div>

          <SettingsPanel game={game} isHost={isHost} roomCode={roomCode} clientToken={session.clientToken} />

          <button
            type="button"
            onClick={() => handleLeave(session.clientToken)}
            className="text-xs font-medium text-muted hover:text-danger"
          >
            Leave room
          </button>

          {isHost && (
            <button
              type="button"
              onClick={() => handleStart(session.clientToken)}
              disabled={!canStart || starting}
              className="rounded-full bg-accent px-10 py-3.5 text-base font-semibold text-accent-foreground transition-colors hover:brightness-110 disabled:opacity-40"
            >
              {starting ? "Starting…" : canStart ? "Start Game" : "Need at least 2 players"}
            </button>
          )}
          {!isHost && <p className="text-sm text-muted">Waiting for the host to start the game…</p>}
        </>
      )}

      {/* Readable even before joining (a soon-to-be spectator watching the
          lobby fill up) — ChatPanel itself gates posting on session, not
          this page. */}
      <div className="w-full max-w-md">
        <ChatPanel roomCode={roomCode} session={session} players={game.state.players} messages={messages} />
      </div>

      <div className="mt-4 flex max-w-md flex-col items-center gap-3 text-center">
        <code className="break-all rounded-lg bg-surface px-4 py-2 text-xs text-muted">{game.serverSeedHash}</code>
        <p className="text-xs leading-relaxed text-muted">
          Every dice roll in this game is generated from a secret seed committed to before the first roll. When the
          game ends, the seed is revealed and you can verify every single roll yourself.
        </p>
      </div>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 text-center text-muted">
      {children}
    </div>
  );
}
