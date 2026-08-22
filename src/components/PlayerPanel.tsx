"use client";

import { useState } from "react";
import type { ColorGroup } from "@/game/board";
import {
  buildHouseBlockedReason,
  getMortgageableSpace,
  mortgageBlockedReason,
  sellHouseBlockedReason,
  unmortgageBlockedReason,
} from "@/game/engine";
import { MAPS } from "@/game/maps";
import type { PlayerState } from "@/game/types";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import { COLOR_GROUP_VAR } from "@/lib/board-colors";
import { formatCAD } from "@/lib/money";
import type { PlayerSession } from "@/lib/session";
import { Money } from "./Money";
import { TokenIcon } from "./TokenIcon";

interface PlayerPanelProps {
  game: PublicGame;
  session: PlayerSession | null;
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
  onInspect?: (spaceIndex: number, anchor?: DOMRect) => void;
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
  mortgageValue: number;
  unmortgageCost: number;
}

function ownedSpaces(game: PublicGame, playerId: string): OwnedSpaceInfo[] {
  const spaces = MAPS[game.state.settings.mapId].spaces;
  return Object.entries(game.state.ownership)
    .filter(([, own]) => own.ownerId === playerId)
    .map(([idxStr, own]) => {
      const idx = Number(idxStr);
      const space = spaces[idx];
      const mortgageable = getMortgageableSpace(game.state, idx);
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
        mortgageValue: mortgageable?.mortgageValue ?? 0,
        unmortgageCost: mortgageable?.unmortgageCost ?? 0,
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

export function PlayerPanel({ game, session, dispatch, onInspect }: PlayerPanelProps) {
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

            {isMe && !player.bankrupt && (
              <Portfolio game={game} player={player} onAct={act} busySpace={busySpace} onInspect={onInspect} />
            )}
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
  onInspect,
}: {
  game: PublicGame;
  player: PlayerState;
  onAct: (action: ClientAction, spaceIndex: number) => void;
  busySpace: number | null;
  onInspect?: (spaceIndex: number, anchor?: DOMRect) => void;
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
                style={{ backgroundColor: COLOR_GROUP_VAR[spaces[0].color] }}
              />
            )}
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{key}</span>
          </div>
          {spaces.map((space) => (
            <div key={space.index} className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => onInspect?.(space.index)}
                aria-label={`Inspect ${space.name}`}
                className={`flex-1 truncate text-left text-ink hover:underline ${space.mortgaged ? "text-muted line-through" : ""}`}
              >
                {space.name}
                {space.hotel ? " · hotel" : space.houses > 0 ? ` · ${space.houses}h` : ""}
              </button>
              {space.houseCost !== null && (
                <>
                  {(() => {
                    const blockedReason = buildHouseBlockedReason(game.state, player.id, space.index);
                    const thisLevel = space.hotel ? 5 : space.houses;
                    const label =
                      thisLevel >= 5
                        ? "Max built"
                        : `Build ${thisLevel === 4 ? "hotel" : "house"} — −${formatCAD(space.houseCost)}`;
                    return (
                      <button
                        type="button"
                        disabled={busySpace === space.index || blockedReason !== null}
                        title={blockedReason ?? undefined}
                        onClick={() => onAct({ type: "BUILD_HOUSE", spaceIndex: space.index }, space.index)}
                        className="rounded-full bg-accent/20 px-2.5 py-1 font-medium text-accent hover:bg-accent/30 disabled:opacity-40"
                      >
                        {label}
                      </button>
                    );
                  })()}
                  {(space.houses > 0 || space.hotel) &&
                    (() => {
                      const blockedReason = sellHouseBlockedReason(game.state, player.id, space.index);
                      const label = `Sell ${space.hotel ? "hotel" : "house"} — +${formatCAD(Math.floor(space.houseCost / 2))}`;
                      return (
                        <button
                          type="button"
                          disabled={busySpace === space.index || blockedReason !== null}
                          title={blockedReason ?? undefined}
                          onClick={() => onAct({ type: "SELL_HOUSE", spaceIndex: space.index }, space.index)}
                          className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-ink hover:bg-white/10 disabled:opacity-40"
                        >
                          {label}
                        </button>
                      );
                    })()}
                </>
              )}
              {!space.mortgaged &&
                game.state.settings.mortgageEnabled &&
                (() => {
                  const blockedReason = mortgageBlockedReason(game.state, player.id, space.index);
                  return (
                    <button
                      type="button"
                      disabled={busySpace === space.index || blockedReason !== null}
                      title={blockedReason ?? undefined}
                      onClick={() => onAct({ type: "MORTGAGE", spaceIndex: space.index }, space.index)}
                      className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-ink hover:bg-white/10 disabled:opacity-40"
                    >
                      {`Mortgage — +${formatCAD(space.mortgageValue)}`}
                    </button>
                  );
                })()}
              {space.mortgaged &&
                (() => {
                  const blockedReason = unmortgageBlockedReason(game.state, player.id, space.index);
                  return (
                    <button
                      type="button"
                      disabled={busySpace === space.index || blockedReason !== null}
                      title={blockedReason ?? undefined}
                      onClick={() => onAct({ type: "UNMORTGAGE", spaceIndex: space.index }, space.index)}
                      className="rounded-full bg-accent/20 px-2.5 py-1 font-medium text-accent hover:bg-accent/30 disabled:opacity-40"
                    >
                      {`Unmortgage — −${formatCAD(space.unmortgageCost)}`}
                    </button>
                  );
                })()}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
