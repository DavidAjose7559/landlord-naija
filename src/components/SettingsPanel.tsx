"use client";

import { useState } from "react";
import { STARTING_CASH_OPTIONS } from "@/game/board";
import { MAP_LIST, MAPS } from "@/game/maps";
import type { GameSettings } from "@/game/types";
import type { PublicGame } from "@/lib/api/public-game";
import { dollars, formatCAD } from "@/lib/money";
import { MapThumbnail } from "./MapThumbnail";
import { Modal } from "./Modal";

interface SettingsPanelProps {
  game: PublicGame;
  isHost: boolean;
  roomCode: string;
  clientToken: string | undefined;
}

const TURN_LIMIT_OPTIONS = [0, 60, 120, 300];

// (Task 11) "Three preset chips at the top... each sets everything at
// once. The full list collapses behind Customise. This is the largest
// UX win on the screen — most hosts will never expand it." Only the
// gameplay-flavour fields (money/rules/pace) — a preset shouldn't touch
// room setup (map, seat count, privacy), which isn't part of what
// "Classic"/"Fast"/"House rules" mean.
const PRESETS: { id: string; label: string; description: string; settings: Partial<GameSettings> }[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Auctions off · even build · double rent · $1,500 · no limit",
    settings: {
      auctionsEnabled: false,
      evenBuild: true,
      doubleRentOnFullSet: true,
      startingCashCents: dollars(1500),
      turnTimeLimitSeconds: 0,
    },
  },
  {
    id: "fast",
    label: "Fast",
    description: "60s turn limit · $2,000 start · auctions on",
    settings: {
      turnTimeLimitSeconds: 60,
      startingCashCents: dollars(2000),
      auctionsEnabled: true,
      freeParkingSkipsTurn: false,
    },
  },
  {
    id: "house",
    label: "House rules",
    description: "Free Parking jackpot · manual bankruptcy · auctions on",
    settings: {
      freeParkingCash: true,
      allowManualBankruptcy: true,
      auctionsEnabled: true,
    },
  },
];

export function SettingsPanel({ game, isHost, roomCode, clientToken }: SettingsPanelProps) {
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [customiseOpen, setCustomiseOpen] = useState(false);
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

      {/* (Task 11) Three preset chips — the largest UX win on this screen.
          A host who just wants to play never has to open the full list. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={!isHost || busy}
            onClick={() => patch(preset.settings)}
            title={preset.description}
            className="flex-1 rounded-2xl bg-surface-2 px-3 py-2.5 text-left transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            <span className="block text-sm font-semibold text-ink">{preset.label}</span>
            <span className="block text-[11px] text-muted">{preset.description}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setCustomiseOpen((v) => !v)}
        className="self-start text-xs font-medium text-accent hover:brightness-110"
      >
        {customiseOpen ? "Hide customise ▲" : "Customise ▾"}
      </button>

      {customiseOpen && (
        <div className="flex flex-col gap-5">
          <SettingGroup title="Room">
            <SettingRow
              title="Map"
              description={map.tagline}
              isHost={isHost}
              control={
                <button
                  type="button"
                  disabled={!isHost || busy}
                  onClick={() => setMapPickerOpen(true)}
                  className="flex items-center gap-2 rounded-full bg-surface-2 py-1.5 pr-3 pl-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                >
                  {/* (Task 11) The settings row's own map control now shows
                      the same real mini board as the picker modal — not
                      just a name, an actual preview. */}
                  <MapThumbnail map={map} />
                  {map.name} · Change map &gt;
                </button>
              }
            />
            <SettingRow
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
              title="Private room"
              description="Off = listed for anyone to find and join"
              isHost={isHost}
              control={<Toggle checked={settings.privateRoom} disabled={!isHost || busy} onChange={(v) => patch({ privateRoom: v })} />}
            />
            <SettingRow
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
          </SettingGroup>

          <SettingGroup title="Money">
            <SettingRow
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
              title="Free Parking jackpot"
              description="Tax and fee payments pool up, paid to whoever lands there"
              isHost={isHost}
              control={
                <Toggle checked={settings.freeParkingCash} disabled={!isHost || busy} onChange={(v) => patch({ freeParkingCash: v })} />
              }
            />
            <SettingRow
              title="Mortgaging"
              description="Off = properties can never be mortgaged"
              isHost={isHost}
              control={
                <Toggle checked={settings.mortgageEnabled} disabled={!isHost || busy} onChange={(v) => patch({ mortgageEnabled: v })} />
              }
            />
          </SettingGroup>

          <SettingGroup title="Rules">
            <SettingRow
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
              title="Even build rule"
              description="Off = houses can be built unevenly within a region"
              isHost={isHost}
              control={<Toggle checked={settings.evenBuild} disabled={!isHost || busy} onChange={(v) => patch({ evenBuild: v })} />}
            />
            <SettingRow
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
              title="Auctions"
              description="Off = Buy or Decline, unbought stays with the bank. On = Buy or Auction, no plain decline."
              isHost={isHost}
              control={
                <Toggle
                  checked={settings.auctionsEnabled}
                  disabled={!isHost || busy}
                  onChange={(v) => patch({ auctionsEnabled: v })}
                />
              }
            />
            <SettingRow
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
              title="Trading"
              description="Off = players can't propose trades"
              isHost={isHost}
              control={
                <Toggle checked={settings.tradingEnabled} disabled={!isHost || busy} onChange={(v) => patch({ tradingEnabled: v })} />
              }
            />
          </SettingGroup>

          <SettingGroup title="Pace">
            <SettingRow
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
            <SettingRow
              title="Free Parking skips a turn"
              description="Landing there makes you miss your next turn"
              isHost={isHost}
              control={
                <Toggle
                  checked={settings.freeParkingSkipsTurn}
                  disabled={!isHost || busy}
                  onChange={(v) => patch({ freeParkingSkipsTurn: v })}
                />
              }
            />
          </SettingGroup>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      {mapPickerOpen && (
        <Modal onClose={() => setMapPickerOpen(false)}>
          <h3 className="text-lg font-bold text-ink">Choose a map</h3>
          {MAP_LIST.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                void patch({ mapId: m.id });
                setMapPickerOpen(false);
              }}
              className={`flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                m.id === settings.mapId ? "bg-accent/20 ring-1 ring-accent" : "border border-white/8 bg-surface-2 hover:bg-white/10"
              }`}
            >
              <MapThumbnail map={m} />
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {m.name}
                  {m.theme === "heritage" && (
                    <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-medium tracking-wide text-gold uppercase">
                      Heritage
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted">{m.tagline}</span>
                <span className="flex flex-wrap gap-x-1.5 gap-y-0.5 pt-1 text-[11px] text-muted">
                  {m.regions.map((r) => (
                    <span key={r.id}>{r.name}</span>
                  ))}
                </span>
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMapPickerOpen(false)}
            className="mt-2 self-end rounded-full bg-surface-2 px-4 py-1.5 text-xs font-semibold text-ink"
          >
            Close
          </button>
        </Modal>
      )}
    </div>
  );
}

// (Task 11) Four groups, not two — Room · Money · Rules · Pace.
function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[11px] font-semibold tracking-widest text-muted uppercase">{title}</span>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function SettingRow({
  title,
  description,
  isHost,
  control,
}: {
  title: string;
  description: string;
  isHost: boolean;
  control: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-3 ${isHost ? "" : "opacity-60"}`}>
      <div className="flex flex-1 flex-col">
        {/* (Task 11) Labels 14px at 100%, descriptions 12px at 60% —
            text-ink/text-muted already land there (--mid is ~64% ink). */}
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-muted">{description}</span>
      </div>
      {control}
    </div>
  );
}

// (Task 11) 44x24px — h-6 w-11 in Tailwind's default scale (6*4=24,
// 11*4=44) — already at spec size; kept as-is rather than shrunk further,
// since going smaller than the reference size wasn't what was asked.
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
