"use client";

import { useState } from "react";
import { STARTING_CASH_OPTIONS } from "@/game/board";
import { MAP_LIST, MAPS } from "@/game/maps";
import type { GameSettings } from "@/game/types";
import type { PublicGame } from "@/lib/api/public-game";
import { formatCAD } from "@/lib/money";

interface SettingsPanelProps {
  game: PublicGame;
  isHost: boolean;
  roomCode: string;
  clientToken: string | undefined;
}

const TURN_LIMIT_OPTIONS = [0, 60, 120, 300];

export function SettingsPanel({ game, isHost, roomCode, clientToken }: SettingsPanelProps) {
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = game.state.settings;
  const map = MAPS[settings.mapId];

  async function patch(update: Partial<GameSettings>) {
    if (!isHost || !clientToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${roomCode}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientToken, settings: update }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        throw new Error(body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "couldn't update that setting");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't update that setting");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-wide text-ink uppercase">Game settings</h2>
        {!isHost && <span className="text-[11px] text-muted">Only the host can change these</span>}
      </div>

      <SettingRow
        icon={map.flagEmoji}
        title="Map"
        description={map.tagline}
        isHost={isHost}
        control={
          <button
            type="button"
            disabled={!isHost || busy}
            onClick={() => setMapPickerOpen(true)}
            className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
          >
            {map.name} · Change map &gt;
          </button>
        }
      />

      <SettingRow
        icon="👥"
        title="Max players"
        description="2 to 8 players per room"
        isHost={isHost}
        control={
          <select
            disabled={!isHost || busy}
            value={settings.maxPlayers}
            onChange={(e) => patch({ maxPlayers: Number(e.target.value) })}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
          >
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        }
      />

      <SettingRow
        icon="🔒"
        title="Private room"
        description="Off = listed for anyone to find and join"
        isHost={isHost}
        control={<Toggle checked={settings.privateRoom} disabled={!isHost || busy} onChange={(v) => patch({ privateRoom: v })} />}
      />

      <SettingRow
        icon="💵"
        title="Starting cash"
        description="How much every player starts with"
        isHost={isHost}
        control={
          <select
            disabled={!isHost || busy}
            value={settings.startingCashCents}
            onChange={(e) => patch({ startingCashCents: Number(e.target.value) })}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
          >
            {STARTING_CASH_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {formatCAD(c)}
              </option>
            ))}
          </select>
        }
      />

      <SettingRow
        icon="🔀"
        title="Randomize turn order"
        description="Off = seating order is turn order"
        isHost={isHost}
        control={
          <Toggle
            checked={settings.randomizePlayerOrder}
            disabled={!isHost || busy}
            onChange={(v) => patch({ randomizePlayerOrder: v })}
          />
        }
      />

      <h2 className="mt-2 text-sm font-bold tracking-wide text-ink uppercase">Gameplay rules</h2>

      <SettingRow
        icon="✌️"
        title="Double rent on full set"
        description="Unimproved rent doubles once you own a whole region"
        isHost={isHost}
        control={
          <Toggle
            checked={settings.doubleRentOnFullSet}
            disabled={!isHost || busy}
            onChange={(v) => patch({ doubleRentOnFullSet: v })}
          />
        }
      />

      <SettingRow
        icon="🅿️"
        title="Free Parking jackpot"
        description="Tax and fee payments pool up, paid to whoever lands there"
        isHost={isHost}
        control={
          <Toggle checked={settings.freeParkingCash} disabled={!isHost || busy} onChange={(v) => patch({ freeParkingCash: v })} />
        }
      />

      <SettingRow
        icon="🔨"
        title="Auction declined properties"
        description="Off = a declined property just stays with the bank"
        isHost={isHost}
        control={
          <Toggle
            checked={settings.auctionOnDecline}
            disabled={!isHost || busy}
            onChange={(v) => patch({ auctionOnDecline: v })}
          />
        }
      />

      <SettingRow
        icon="🚔"
        title="Collect rent while jailed"
        description="Off = no rent owed to an owner currently in jail"
        isHost={isHost}
        control={
          <Toggle
            checked={settings.collectRentWhileJailed}
            disabled={!isHost || busy}
            onChange={(v) => patch({ collectRentWhileJailed: v })}
          />
        }
      />

      <SettingRow
        icon="🏦"
        title="Mortgaging"
        description="Off = properties can never be mortgaged"
        isHost={isHost}
        control={
          <Toggle checked={settings.mortgageEnabled} disabled={!isHost || busy} onChange={(v) => patch({ mortgageEnabled: v })} />
        }
      />

      <SettingRow
        icon="🏗️"
        title="Even build rule"
        description="Off = houses can be built unevenly within a region"
        isHost={isHost}
        control={<Toggle checked={settings.evenBuild} disabled={!isHost || busy} onChange={(v) => patch({ evenBuild: v })} />}
      />

      <SettingRow
        icon="🏳️"
        title="Manual bankruptcy"
        description="On = players can quit and declare bankrupt any time"
        isHost={isHost}
        control={
          <Toggle
            checked={settings.allowManualBankruptcy}
            disabled={!isHost || busy}
            onChange={(v) => patch({ allowManualBankruptcy: v })}
          />
        }
      />

      <SettingRow
        icon="📦"
        title="Bankruptcy transfers assets"
        description="Off = a bankrupt player's properties return to the bank instead"
        isHost={isHost}
        control={
          <Toggle
            checked={settings.bankruptcyTransfersAssets}
            disabled={!isHost || busy}
            onChange={(v) => patch({ bankruptcyTransfersAssets: v })}
          />
        }
      />

      <SettingRow
        icon="🤝"
        title="Trading"
        description="Off = players can't propose trades"
        isHost={isHost}
        control={
          <Toggle checked={settings.tradingEnabled} disabled={!isHost || busy} onChange={(v) => patch({ tradingEnabled: v })} />
        }
      />

      <SettingRow
        icon="⏱️"
        title="Turn time limit"
        description="Skip a player's turn if they take too long"
        isHost={isHost}
        control={
          <select
            disabled={!isHost || busy}
            value={settings.turnTimeLimitSeconds}
            onChange={(e) => patch({ turnTimeLimitSeconds: Number(e.target.value) })}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
          >
            {TURN_LIMIT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? "Off" : `${s / 60} min`}
              </option>
            ))}
          </select>
        }
      />

      {error && <p className="text-xs text-danger">{error}</p>}

      {mapPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-2xl bg-surface p-6">
            <h3 className="text-lg font-bold text-ink">Choose a map</h3>
            {MAP_LIST.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  void patch({ mapId: m.id });
                  setMapPickerOpen(false);
                }}
                className={`flex flex-col gap-1 rounded-xl px-4 py-3 text-left transition-colors ${
                  m.id === settings.mapId ? "bg-accent/20 ring-1 ring-accent" : "bg-surface-2 hover:bg-white/10"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span className="text-lg">{m.flagEmoji}</span>
                  {m.name}
                </span>
                <span className="text-xs text-muted">{m.tagline}</span>
                <span className="flex flex-wrap gap-1 pt-1 text-[11px] text-muted">
                  {m.regions.map((r) => (
                    <span key={r.id}>{r.flagEmoji ?? ""} {r.name}</span>
                  ))}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMapPickerOpen(false)}
              className="mt-2 self-end rounded-full bg-surface-2 px-4 py-1.5 text-xs font-semibold text-ink"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingRow({
  icon,
  title,
  description,
  isHost,
  control,
}: {
  icon: string;
  title: string;
  description: string;
  isHost: boolean;
  control: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-3 ${isHost ? "" : "opacity-60"}`}>
      <span className="text-lg">{icon}</span>
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-muted">{description}</span>
      </div>
      {control}
    </div>
  );
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-accent" : "bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-5.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
