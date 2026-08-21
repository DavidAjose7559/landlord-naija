"use client";

import { useState } from "react";
import type { ColorGroup } from "@/game/board";
import { MAPS } from "@/game/maps";
import type { PlayerState } from "@/game/types";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import { COLOR_GROUP_HEX } from "@/lib/board-colors";
import type { PlayerSession } from "@/lib/session";
import { Money } from "./Money";
import { TokenIcon } from "./TokenIcon";

interface PlayerPanelProps {
  game: PublicGame;
  session: PlayerSession | null;
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}

interface OwnedSpaceInfo {
  index: number;
  name: string;
  color: ColorGroup | null;
  groupKey: string;
  houses: number;
  hotel: boolean;
  mortgaged: boolean;
  houseCost: number | null;
}

function ownedSpaces(game: PublicGame, playerId: string): OwnedSpaceInfo[] {
  const spaces = MAPS[game.state.settings.mapId].spaces;
  return Object.entries(game.state.ownership)
    .filter(([, own]) => own.ownerId === playerId)
    .map(([idxStr, own]) => {
      const idx = Number(idxStr);
      const space = spaces[idx];
      const color = space.type === "property" ? space.color : null;
      const groupKey = color ?? (space.type === "transport" ? "transport" : "utility");
      return {
        index: idx,
        name: space.name,
        color,
        groupKey,
        houses: own.houses,
        hotel: own.hotel,
        mortgaged: own.mortgaged,
        houseCost: space.type === "property" ? space.houseCost : null,
      };
    })
    .sort((a, b) => a.index - b.index);
}

function groupByColor(owned: OwnedSpaceInfo[]): Map<string, OwnedSpaceInfo[]> {
  const groups = new Map<string, OwnedSpaceInfo[]>();
  for (const space of owned) {
    const list = groups.get(space.groupKey) ?? [];
    list.push(space);
    groups.set(space.groupKey, list);
  }
  return groups;
}

export function PlayerPanel({ game, session, dispatch }: PlayerPanelProps) {
  const [busySpace, setBusySpace] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: ClientAction, spaceIndex: number) {
    setBusySpace(spaceIndex);
    setMessage(null);
    const result = await dispatch(action);
    if (result && !result.ok) setMessage(result.reason ?? "That didn't work.");
    setBusySpace(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {game.state.players.map((player, i) => {
        const isCurrent = i === game.currentPlayerIndex;
        const isMe = player.id === session?.playerId;
        const propertyCount = ownedSpaces(game, player.id).length;

        return (
          <div
            key={player.id}
            className={`flex flex-col gap-3 rounded-2xl px-4 py-3 ${
              isCurrent ? "border border-white/8 bg-surface-2" : "bg-surface"
            } ${player.bankrupt ? "opacity-40" : ""}`}
          >
            <div className="flex items-center gap-3">
              <TokenIcon token={player.token} className="text-xl" />
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-medium text-ink">
                  {player.name}
                  {isMe ? " (you)" : ""}
                </span>
                <span className="text-xs text-muted">
                  {propertyCount} propert{propertyCount === 1 ? "y" : "ies"}
                  {player.inJail ? " · in Kirikiri" : ""}
                  {player.bankrupt ? " · bankrupt" : ""}
                </span>
              </div>
              <Money cents={player.cashCents} className="font-semibold text-ink" />
            </div>

            {isMe && !player.bankrupt && <Portfolio game={game} player={player} onAct={act} busySpace={busySpace} />}
          </div>
        );
      })}
      {message && <p className="px-2 text-xs text-danger">{message}</p>}
    </div>
  );
}

function Portfolio({
  game,
  player,
  onAct,
  busySpace,
}: {
  game: PublicGame;
  player: PlayerState;
  onAct: (action: ClientAction, spaceIndex: number) => void;
  busySpace: number | null;
}) {
  const owned = ownedSpaces(game, player.id);
  if (owned.length === 0) {
    return <p className="text-xs text-muted">No properties yet.</p>;
  }
  const groups = groupByColor(owned);

  return (
    <div className="flex flex-col gap-3 border-t border-white/5 pt-3">
      {Array.from(groups.entries()).map(([key, spaces]) => (
        <div key={key} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {spaces[0].color && (
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: COLOR_GROUP_HEX[spaces[0].color] }}
              />
            )}
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{key}</span>
          </div>
          {spaces.map((space) => (
            <div key={space.index} className="flex items-center gap-2 text-xs">
              <span className={`flex-1 text-ink ${space.mortgaged ? "text-muted line-through" : ""}`}>
                {space.name}
                {space.hotel ? " · hotel" : space.houses > 0 ? ` · ${space.houses}h` : ""}
              </span>
              {space.houseCost !== null && !space.mortgaged && (
                <>
                  <button
                    type="button"
                    disabled={busySpace === space.index}
                    onClick={() => onAct({ type: "BUILD_HOUSE", spaceIndex: space.index }, space.index)}
                    className="rounded-full bg-accent/20 px-2.5 py-1 font-medium text-accent hover:bg-accent/30 disabled:opacity-40"
                  >
                    Build
                  </button>
                  {(space.houses > 0 || space.hotel) && (
                    <button
                      type="button"
                      disabled={busySpace === space.index}
                      onClick={() => onAct({ type: "SELL_HOUSE", spaceIndex: space.index }, space.index)}
                      className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-ink hover:bg-white/10 disabled:opacity-40"
                    >
                      Sell
                    </button>
                  )}
                </>
              )}
              {!space.mortgaged && space.houses === 0 && !space.hotel && (
                <button
                  type="button"
                  disabled={busySpace === space.index}
                  onClick={() => onAct({ type: "MORTGAGE", spaceIndex: space.index }, space.index)}
                  className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-ink hover:bg-white/10 disabled:opacity-40"
                >
                  Mortgage
                </button>
              )}
              {space.mortgaged && (
                <button
                  type="button"
                  disabled={busySpace === space.index}
                  onClick={() => onAct({ type: "UNMORTGAGE", spaceIndex: space.index }, space.index)}
                  className="rounded-full bg-accent/20 px-2.5 py-1 font-medium text-accent hover:bg-accent/30 disabled:opacity-40"
                >
                  Unmortgage
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
