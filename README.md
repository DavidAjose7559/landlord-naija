# LANDLORD — Naija Edition

Buy Lagos. Own Naija. A provably-fair, real-time multiplayer Monopoly you play with friends over a
room code — no accounts, no app download.

Built with Next.js 15 (App Router), Supabase (Postgres, Realtime, RPC), TypeScript, Tailwind CSS,
and Framer Motion.

## How it works

- **Server-authoritative.** Every mutation — rolling, buying, building, trading, going bankrupt —
  is validated and applied by a pure rules engine (`src/game/engine.ts`) running server-side. The
  client never sends a dice value, a cash amount, or a board position; it only sends intent
  (`{ type: "ROLL" }`, `{ type: "BUY" }`, ...). See [Fairness](#fairness) for how the dice
  themselves are generated.
- **Realtime.** Game state, the roll ledger, and the activity feed all sync live over Supabase
  Realtime — no polling.
- **No accounts.** Joining a game hands your browser a secret `client_token`, stored in
  `localStorage` keyed by room code, that proves your seat on reconnect.

## Game features

- **Five maps** (`src/game/maps/`) — Naija Edition (Lagos, Abuja, Enugu, Port Harcourt, Ibadan,
  Kano...), World Tour (one country per colour group), Canada, Classic, and Original — same
  40-space layout and rules underneath, only names, card flavour, and (Original only) the visual
  theme differ. Naija Edition's two card decks are **Owambe** (mostly good news) and **Village
  People** (chaos).
- **Two visual themes.** Every map carries a `theme: 'modern' | 'heritage'` (never a user setting —
  picking the map picks the look). Naija/World Tour/Canada/Classic use **modern**, the parchment-
  on-felt board with a raised shadow. **Original** uses **heritage**: a flat, heavy-ruled vintage
  property-trading-board look with its own Oswald-set type. Every colour/shadow/grid-weight/font
  value a themed component needs is a CSS custom property redefined per `[data-theme]` scope in
  `src/app/globals.css` — `Board.tsx`, `PlayerPanel.tsx`, and `PropertyInspector.tsx` only ever
  consume those tokens (via `src/lib/board-colors.ts`'s `var(--color-group-*)` references, never a
  raw hex) and never check which theme is active.
- **Configurable rooms.** The host sets starting cash, whether rent doubles on a full colour-group
  monopoly, free parking cash, auctions, mortgaging, even-build, manual bankruptcy, whether
  bankruptcy transfers assets to the creditor or returns them to the bank, trading, and a turn time
  limit — all frozen once the game starts. See `/rules` in-app for what each one does.
- **Trading.** Any player can propose a cash/property/jail-free-card trade with any other player at
  any time; the recipient can accept, decline, or counter, and the full negotiation thread is
  visible to both sides.
- **Debt resolution.** A player who can't cover a debt gets an explicit panel — mortgage/sell
  proactively, or use "Help me raise it" for a server-computed plan (bare properties before houses)
  — rather than being auto-liquidated.
- **Chat.** A "Chat" tab next to the event log (lobby and board, any turn, any phase) — own
  messages align differently from everyone else's, a row of one-tap reactions (👍😂😭💀🔥) covers
  the "typing on a phone mid-game" case, and an unread dot lights the tab when a message arrives
  while you're looking at the log instead. Spectators can read but not post. Posting never touches
  game state.
- **In-game bug reports.** A small 🐛 button, always available (lobby or board, any turn, any
  player — even a spectator), opens a two-field form (what happened + severity) and silently
  attaches everything else: the full game state, settings, event log, roll ledger, open trades,
  browser/console diagnostics, an auto-captured screenshot, a 30-step click trail, and the exact
  commit deployed. Never touches game state. See [Bug reports](#bug-reports).

## Project structure

```
src/game/       pure game logic — board data, cards, dice/fairness, the rules engine (no I/O)
src/app/api/    route handlers — the only code allowed to write to the database
src/lib/api/    server-side helpers shared by the route handlers (Supabase queries, RPC calls, zod)
src/lib/        client-safe shared code (session storage, browser-side dice verification, tokens)
src/hooks/      useGame — the one hook every page uses to read/mutate a game
src/components/ the board, dice roller, player panel, action bar, event log, trade panel
supabase/migrations/   the full Postgres schema, RLS policies, and RPC functions
```

## Setup

### 1. Prerequisites

- Node 20+
- pnpm
- A [Supabase](https://supabase.com) project (free tier is fine)

### 2. Install

```bash
pnpm install
```

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in from your Supabase project's **Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

`SUPABASE_SERVICE_ROLE_KEY` is a secret — it bypasses every RLS policy and must never reach the
browser. It's only ever read by server-side code under `src/lib/api/` and `src/app/api/`, all of
which are guarded with `import "server-only"`.

Two more variables are optional:

- `DEV_HARNESS_SECRET` unlocks `POST /api/dev/seed-state`, a test-only backdoor for setting up
  board states directly instead of playing dice out for real. Only takes effect outside
  production to begin with — leave it unset in Production.
- `ADMIN_SECRET` gates the [bug report](#bug-reports) review surface (`/bugs` and
  `GET`/`PATCH /api/bugs`). Unlike `DEV_HARNESS_SECRET`, this one should stay set in
  Production — reports only matter once real players are filing them.

### 4. Apply the database migrations

The schema, row-level security policies, and RPC functions all live in `supabase/migrations/`, in
order. Using the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

`supabase db push` applies every migration in `supabase/migrations/` that hasn't already run
against the linked project. Every migration in this repo is written to be safe to re-run (`create
table if not exists`, guarded `alter table ... add column if not exists`, etc.) — reapplying an
already-applied migration is a no-op, not an error.

If you don't have the CLI set up, you can instead paste each migration file's contents into the
Supabase Dashboard's **SQL Editor** and run them in order (`0001_...` before `0002_...`) — that's
how this project's own database was originally set up.

### 5. Run it

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command             | What it does                                  |
| -------------------- | ---------------------------------------------- |
| `pnpm dev`            | Start the dev server                           |
| `pnpm build`          | Production build                               |
| `pnpm start`          | Run a production build                         |
| `pnpm test`           | Run the test suite once                        |
| `pnpm test:watch`     | Run the test suite in watch mode               |
| `pnpm lint`           | Lint                                            |

## Fairness

Every dice roll is generated from a secret 32-byte seed the server creates the moment a game is
created (`src/game/dice.ts`, `createServerSeed`). Its SHA-256 hash is published immediately — shown
on the lobby page — long before anyone rolls. The seed itself stays secret until the game ends.

Each roll is deterministic:

```
HMAC-SHA256(seed, `${gameId}:${rollIndex}`)
```

walked byte-by-byte with rejection sampling (bytes ≥ 252 are skipped, since 256 isn't evenly
divisible by 6 — this is what keeps `byte % 6` perfectly uniform instead of biased toward low
faces) to produce two dice values 1–6. Because the seed is already committed to via its published
hash, the outcome of every future roll is fixed the instant the game is created — nothing that
happens in between can change what a given `rollIndex` will produce.

Every roll is also written to an append-only ledger with a hash chain: each row's hash covers the
previous row's hash plus its own game ID, roll index, player, and dice —

```
sha256(prevHash|gameId|rollIndex|playerId|d1|d2)
```

— so the ledger can't be quietly edited, reordered, or have rows removed after the fact without
breaking the chain.

When a game finishes, the seed is revealed via `GET /api/games/[code]/verify`, alongside the full
roll ledger and a server-computed verification result. Every game's **Fairness** page
(`/game/[code]/verify`) also ships a **Verify** button that recomputes every single roll **in your
own browser** — `src/lib/verify-client.ts` reimplements the exact same HMAC/hash-chain algorithm
using the Web Crypto API (the server's implementation, `src/game/dice.ts`, is `server-only` and
uses Node's `node:crypto`, neither of which run in a browser) — and checks it against what was
actually recorded. Nobody has to take the server's word for it.

## Bug reports

Every lobby and board view has a small 🐛 button in the bottom corner — always there, never gated
on whose turn it is or even whether you have a seat. It opens a two-field form (a free-text "what
happened" and a severity picker) and submits to `POST /api/bugs`, which:

1. Independently re-reads the game's current state, settings, event log, roll ledger, and any open
   trade negotiations straight from the database — never trusts what the client claims about game
   state, since a stale or malicious client shouldn't be able to fabricate what a report says
   happened.
2. Attaches what only the browser can see: user agent, viewport, online state, device pixel ratio,
   the last 20 entries from a lightweight ring buffer (`src/lib/diagnostics.ts`, installed once at
   app boot) of console errors/uncaught exceptions/unhandled rejections/failed network requests,
   and the last 30 entries from a second ring buffer (`src/lib/breadcrumbs.ts`, same app-boot
   installer) of clicks and input focuses — element label only (`aria-label`/text/`title`, never a
   raw DOM path), never a typed value, and disabled-button clicks included (captured on
   `pointerdown` specifically, since a real `disabled` control never dispatches a `click` event at
   all).
3. Auto-captures a screenshot of the page as it looked the moment the 🐛 button was clicked
   (`html2canvas-pro` — not plain `html2canvas`, which can't parse the `oklab`/`oklch` colours
   Tailwind v4 compiles opacity modifiers to; dynamically imported so pages that never open the
   form never pay for it),
   compresses it to a size-capped JPEG client-side, and uploads it to a private Supabase Storage
   bucket (`bug-screenshots`) — the reporter can discard it or replace it with an uploaded file
   instead. A capture, compression, or upload failure never blocks the report itself from
   submitting; it just has no screenshot.
4. Inserts one row into a standalone `bug_reports` table (migrations `0008_bug_reports.sql`,
   `0010_bug_report_attachments.sql`) — `game_id` is `ON DELETE SET NULL` so a report outlives the
   game it came from. This path never touches `games`/`players`/`events`/`rolls`/`trades`; it
   cannot mutate a game even in principle.

Reports are reviewed at `/bugs?secret=<ADMIN_SECRET>` (see [Setup](#3-configure-environment-variables))
— newest first, each expandable to its full JSON snapshot and numbered click trail, with the
screenshot (if any) rendered inline via a short-lived signed URL generated server-side — the bucket
itself stays private — a resolved toggle, and a **"Copy for Claude Code"** button that produces one
paste-ready markdown block (description, severity, commit SHA, a curated state slice, recent
events, captured console/network errors, the click trail, and a repro hint).
`GET /api/bugs?secret=...&unresolved=true` returns that same markdown concatenated for every open
report — pull a whole session's bugs in one paste from the CLI. Missing or wrong secret is a plain
404 everywhere, same posture as the dev harness.

## Chat

A "Chat" tab sits next to the event log — same panel, so nothing new to find — available in the
lobby and on the board, in any turn phase, for any player. Posting goes through
`POST /api/games/[code]/chat`, authenticated by `client_token` exactly like every other action but
otherwise unrelated to it: chat never goes through the rules engine, never touches `games.state`,
and never writes an `events` row, so there is no path from a message to a game-state mutation.
Messages persist in a standalone `messages` table (migration `0009_messages.sql`) and sync the same
way the event log and trades do — an anon `SELECT` policy plus a Supabase Realtime subscription, no
polling. A spectator (no session) can read the thread but not post. Rate-limited to 10 messages per
15 seconds per player.

## Tests

```bash
pnpm test
```

Covers the board/card data, the dice/fairness module (including a chi-square distribution check
and a browser-vs-server parity check for the two HMAC implementations), the full rules engine
(including a 200-turn simulated game asserting cash never goes negative or fractional), and the
API routes end-to-end against a hand-written fake Supabase client.
