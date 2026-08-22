"use client";

import type { PlayerState } from "@/game/types";
import { useChatMessages } from "@/hooks/useChatMessages";
import type { PlayerSession } from "@/lib/session";
import { ChatPanel } from "./ChatPanel";

interface ChatSectionProps {
  gameId: string;
  roomCode: string;
  session: PlayerSession | null;
  players: readonly PlayerState[];
}

// (Fix B) The event log moved into the board's own centre (see
// BoardEventLog), so this sidebar slot is Chat alone now — no more tabs to
// switch between.
export function ChatSection({ gameId, roomCode, session, players }: ChatSectionProps) {
  const { messages } = useChatMessages(gameId);

  return (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-xs font-semibold tracking-widest text-muted uppercase">Chat</span>
      <ChatPanel roomCode={roomCode} session={session} players={players} messages={messages} />
    </div>
  );
}
