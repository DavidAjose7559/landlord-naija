"use client";

import { useEffect, useState } from "react";
import { TRANSPORT_INDEXES, UTILITY_INDEXES } from "@/game/board";
import { netWorth } from "@/game/engine";
import { MAPS } from "@/game/maps";
import type { PlayerState, PlayerToken } from "@/game/types";
import type { PublicGame } from "@/lib/api/public-game";
import { COLOR_GROUP_VAR, TRANSPORT_PLATE_COLOR, UTILITY_PLATE_COLOR } from "@/lib/board-colors";
import type { PlayerSession } from "@/lib/session";
import { PLAYER_TOKEN_COLOR } from "@/lib/tokens";
import { AnimatedMoney } from "./AnimatedMoney";
import { TokenIcon } from "./TokenIcon";

interface PlayerPanelProps {
  game: PublicGame;
  session: PlayerSession | null;
}

// (Task 8) One pip per region/transport/utility group the player holds
// anything in — "tiny coloured bars showing which regions each player
// holds, ringed when a set is complete. You can see someone assembling a
// monopoly without opening anything." Replaces "0 properties" / "No
// properties yet", which said the same nothing twice, and the old
// per-property Build/Mortgage list, which is redundant now that those
// actions live in the property popover (task 6) — a glance-only panel and
// a click-to-act popover doing the same job twice was the clutter task 8
// is about removing, not something to keep in parallel.
interface PipGroup {
  key: string;
  color: string;
  complete: boolean;
}

function pipGroups(game: PublicGame, playerId: string): PipGroup[] {
  const map = MAPS[game.state.settings.mapId];
  const groups: PipGroup[] = [];

  for (const region of map.regions) {
    const owned = region.spaceIndexes.filter((idx) => game.state.ownership[idx]?.ownerId === playerId);
    if (owned.length === 0) continue;
    groups.push({ key: region.id, color: COLOR_GROUP_VAR[region.id], complete: owned.length === region.spaceIndexes.length });
  }

  const ownedTransport = TRANSPORT_INDEXES.filter((idx) => game.state.ownership[idx]?.ownerId === playerId);
  if (ownedTransport.length > 0) {
    groups.push({ key: "transport", color: TRANSPORT_PLATE_COLOR, complete: ownedTransport.length === TRANSPORT_INDEXES.length });
  }

  const ownedUtility = UTILITY_INDEXES.filter((idx) => game.state.ownership[idx]?.ownerId === playerId);
  if (ownedUtility.length > 0) {
    groups.push({ key: "utility", color: UTILITY_PLATE_COLOR, complete: ownedUtility.length === UTILITY_INDEXES.length });
  }

  return groups;
}

function PropertyPips({ groups }: { groups: PipGroup[] }) {
  if (groups.length === 0) {
    return <span className="text-xs text-muted">No properties yet</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {groups.map((g) => (
        <span
          key={g.key}
          className="h-2.5 w-4 rounded-[2px]"
          style={{
            backgroundColor: g.color,
            boxShadow: g.complete ? `0 0 0 1.5px var(--color-canvas), 0 0 0 3px ${g.color}` : undefined,
          }}
          title={g.key}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function CrownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M4 18h16l1.2-8.4-4.2 2.8L12 6l-5 6.4-4.2-2.8L4 18z" />
    </svg>
  );
}

function TurnArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M5 12h13M12 6l7 6-7 6" />
    </svg>
  );
}

const RING_R = 16;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

// (Task 8) "Countdown ring when the turn timer is on" — ticks locally off
// game.state.turnStartedAt exactly like BoardCenterControls' own
// TurnCountdownPill, so the two never disagree. Only mounted for the
// active player's own avatar, and only when a turn time limit is
// actually set, so the panel isn't re-rendering every second for a
// feature most rooms have off.
function Avatar({
  token,
  isActive,
  isLeader,
  turnProgress,
}: {
  token: PlayerToken;
  isActive: boolean;
  isLeader: boolean;
  turnProgress: number | null;
}) {
  const color = PLAYER_TOKEN_COLOR[token];
  return (
    <div className="relative h-9 w-9 shrink-0">
      {turnProgress !== null && (
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
          <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--s3)" strokeWidth="2" />
          <circle
            cx="18"
            cy="18"
            r={RING_R}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - turnProgress)}
          />
        </svg>
      )}
      <div
        className="absolute inset-[3px] flex items-center justify-center rounded-full text-base text-white"
        style={{ backgroundColor: color }}
      >
        <TokenIcon token={token} />
      </div>
      {isLeader && (
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-black/70 ring-2 ring-canvas">
          <CrownIcon className="h-2.5 w-2.5" />
        </span>
      )}
      {isActive && (
        <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-foreground ring-2 ring-canvas">
          <TurnArrowIcon className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  );
}

function useTurnProgress(game: PublicGame, isActive: boolean): number | null {
  const limitSeconds = game.state.settings.turnTimeLimitSeconds;
  const startedAt = game.state.turnStartedAt;
  const [now, setNow] = useState(() => Date.now());

  const hasTimer = isActive && limitSeconds > 0 && Boolean(startedAt);

  useEffect(() => {
    if (!hasTimer) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasTimer]);

  if (!hasTimer || !startedAt) return null;
  const remaining = Math.max(0, startedAt + limitSeconds * 1000 - now);
  return remaining / (limitSeconds * 1000);
}

function PlayerRow({ game, session, player, index }: { game: PublicGame; session: PlayerSession | null; player: PlayerState; index: number }) {
  const isActive = index === game.currentPlayerIndex && game.status === "active";
  const isMe = player.id === session?.playerId;
  const leaderId = leaderPlayerId(game);
  const isLeader = player.id === leaderId && !player.bankrupt;
  const turnProgress = useTurnProgress(game, isActive);

  return (
    <div
      className={`relative flex items-center gap-3 rounded-2xl py-2.5 pr-4 pl-3.5 transition-opacity ${
        player.bankrupt ? "opacity-30" : isActive ? "opacity-100" : "opacity-55"
      }`}
    >
      {isActive && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden="true" />}

      <Avatar token={player.token} isActive={isActive} isLeader={isLeader} turnProgress={turnProgress} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {player.name}
            {isMe ? " (you)" : ""}
          </span>
          <AnimatedMoney cents={player.cashCents} className="text-sm font-semibold text-ink" />
        </div>
        <PropertyPips groups={pipGroups(game, player.id)} />
      </div>
    </div>
  );
}

// Highest net worth among non-bankrupt players — null once fewer than two
// are still standing (a "leader" of one isn't meaningful, and the winner
// screen already covers the actual end-of-game case).
function leaderPlayerId(game: PublicGame): string | null {
  const alive = game.state.players.filter((p) => !p.bankrupt);
  if (alive.length < 2) return null;
  let best: { id: string; value: number } | null = null;
  for (const p of alive) {
    const value = netWorth(game.state, p.id);
    if (!best || value > best.value) best = { id: p.id, value };
  }
  return best?.id ?? null;
}

export function PlayerPanel({ game, session }: PlayerPanelProps) {
  return (
    <div className="flex flex-col gap-1">
      {game.state.players.map((player, i) => (
        <PlayerRow key={player.id} game={game} session={session} player={player} index={i} />
      ))}
    </div>
  );
}
