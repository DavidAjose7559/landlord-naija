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

- **Four maps** (`src/game/maps/`) — Naija Edition (Lagos, Abuja, Enugu, Port Harcourt, Ibadan,
  Kano...), World Tour (one country per colour group), Canada, and Classic — same 40-space layout
  and rules underneath, only names and card flavour differ. Naija Edition's two card decks are
  **Owambe** (mostly good news) and **Village People** (chaos).
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

## Tests

```bash
pnpm test
```

Covers the board/card data, the dice/fairness module (including a chi-square distribution check
and a browser-vs-server parity check for the two HMAC implementations), the full rules engine
(including a 200-turn simulated game asserting cash never goes negative or fractional), and the
API routes end-to-end against a hand-written fake Supabase client.
