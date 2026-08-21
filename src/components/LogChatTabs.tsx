"use client";

import { useEffect, useRef, useState } from "react";
import type { Space } from "@/game/board";
import type { PlayerState } from "@/game/types";
import { useChatMessages } from "@/hooks/useChatMessages";
import type { PlayerSession } from "@/lib/session";
import { ChatPanel } from "./ChatPanel";
import { EventLog } from "./EventLog";

interface LogChatTabsProps {
  gameId: string;
  roomCode: string;
  session: PlayerSession | null;
  players: readonly PlayerState[];
  spaces: readonly Space[];
  jailLabel: string;
  deckLabels: { treasure: string; surprise: string };
}

// The panel was already crowded, so chat lives as a second tab next to
// the event log rather than a whole extra area — this same tree is what
// both the desktop side column and the mobile bottom sheet render (see
// game/[code]/page.tsx's single panelContent), so both get chat for free.
export function LogChatTabs({ gameId, roomCode, session, players, spaces, jailLabel, deckLabels }: LogChatTabsProps) {
  const [tab, setTab] = useState<"log" | "chat">("log");
  const { messages } = useChatMessages(gameId);
  const seenCountRef = useRef(0);
  const [hasUnread, setHasUnread] = useState(false);

  // Only the count matters here, not which messages — arriving while the
  // chat tab is already open is "seen" the instant it renders.
  useEffect(() => {
    if (tab === "chat") {
      seenCountRef.current = messages.length;
      setHasUnread(false);
    } else if (messages.length > seenCountRef.current) {
      setHasUnread(true);
    }
  }, [messages, tab]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 rounded-full bg-surface-2 p-1 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setTab("log")}
          className={`flex-1 rounded-full py-1.5 transition-colors ${
            tab === "log" ? "bg-accent text-accent-foreground" : "text-muted hover:text-ink"
          }`}
        >
          Log
        </button>
        <button
          type="button"
          onClick={() => setTab("chat")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 transition-colors ${
            tab === "chat" ? "bg-accent text-accent-foreground" : "text-muted hover:text-ink"
          }`}
        >
          Chat
          {hasUnread && <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />}
        </button>
      </div>

      {tab === "log" ? (
        <EventLog gameId={gameId} players={players} spaces={spaces} jailLabel={jailLabel} deckLabels={deckLabels} />
      ) : (
        <ChatPanel roomCode={roomCode} session={session} players={players} messages={messages} />
      )}
    </div>
  );
}
