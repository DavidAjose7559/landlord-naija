"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessageRow } from "@/hooks/useChatMessages";
import type { PlayerState } from "@/game/types";
import type { PlayerSession } from "@/lib/session";
import { PLAYER_TOKEN_COLOR } from "@/lib/tokens";
import { TokenIcon } from "./TokenIcon";

// (Task 3) Short words, not emoji — the button label IS the message body
// that gets sent and displayed in the thread, so an emoji here wouldn't
// just be a decorative icon, it'd be device-inconsistent text sitting
// permanently in the chat log.
const REACTIONS = ["+1", "LOL", "NOOO", "DEAD", "LIT"];

interface ChatPanelProps {
  roomCode: string;
  session: PlayerSession | null;
  players: readonly PlayerState[];
  messages: ChatMessageRow[];
}

// Available at all times regardless of whose turn it is — no turn or
// phase gate anywhere in this component, and posting only ever hits
// POST /api/games/[code]/chat, which never touches games.state. A
// spectator (session === null) can read the thread but the input/
// reactions are replaced with a plain "Join to chat" hint.
export function ChatPanel({ roomCode, session, players, messages }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !session || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${roomCode}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientToken: session.clientToken, body: trimmed }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const message =
          body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : null;
        throw new Error(message ?? "couldn't send that");
      }
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't send that");
    } finally {
      setSending(false);
    }
  }

  function playerFor(id: string | null): PlayerState | undefined {
    return id ? players.find((p) => p.id === id) : undefined;
  }

  return (
    <div className="flex h-48 flex-col gap-2">
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-2xl bg-surface p-3"
      >
        {messages.length === 0 && <p className="text-xs text-muted">No messages yet.</p>}
        {messages.map((m) => {
          const sender = playerFor(m.player_id);
          const isOwn = session != null && m.player_id === session.playerId;
          const color = sender ? PLAYER_TOKEN_COLOR[sender.token] : undefined;
          return (
            <div key={m.id} className={`flex items-start gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]"
                style={{ backgroundColor: color ? `${color}33` : "var(--color-surface-2)" }}
              >
                {sender ? <TokenIcon token={sender.token} className="text-[10px]" /> : "?"}
              </span>
              <div className={`flex min-w-0 flex-col ${isOwn ? "items-end" : "items-start"}`}>
                <span className="text-[10px] font-medium" style={{ color }}>
                  {sender?.name ?? "Former player"}
                </span>
                <span
                  className={`max-w-[220px] rounded-2xl px-3 py-1.5 text-xs break-words text-ink ${
                    isOwn ? "bg-accent/20" : "bg-surface-2"
                  }`}
                >
                  {m.body}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {session ? (
        <>
          <div className="flex gap-1">
            {REACTIONS.map((word) => (
              <button
                key={word}
                type="button"
                onClick={() => void send(word)}
                disabled={sending}
                className="flex-1 rounded-full bg-surface-2 py-1 text-[11px] font-semibold tracking-wide text-ink hover:bg-white/10 disabled:opacity-40"
              >
                {word}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
            className="flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={300}
              placeholder="Say something…"
              className="flex-1 rounded-full bg-surface-2 px-3 py-1.5 text-xs text-ink placeholder:text-muted focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-40"
            >
              Send
            </button>
          </form>
          {error && <p className="text-[10px] text-danger">{error}</p>}
        </>
      ) : (
        <p className="text-center text-[11px] text-muted">Join to chat.</p>
      )}
    </div>
  );
}
