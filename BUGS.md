# Section H bug log

Found via live browser testing (Chrome MCP), not the automated test suite.
Each entry: repro steps, root cause, fix, and re-verification status.

## 1. TradePanel shows "Propose Trade" even when tradingEnabled is off

**Repro:** Host turns `tradingEnabled` off in lobby settings, starts the game.
Any player still sees an active "Propose Trade" button, can fill out a full
offer, and only discovers trading is disabled after submitting (409 "trading
is disabled for this room").

**Root cause:** `tradingEnabled` was enforced server-side (the engine's
`handleExecuteAcceptedTrade` and the `POST .../trades` route both check it)
but TradePanel.tsx never checked `game.state.settings.tradingEnabled` at
all — the button renders unconditionally whenever the player has a session
and there's another player to trade with.

**Status:** fixed — TradePanel now returns null entirely when
`tradingEnabled` is off (settings are frozen at game start, so there's
never an existing thread to preserve in that case).

## 2. PlayerPanel shows "Mortgage" even when mortgageEnabled is off

Same pattern as bug #1, found while auditing for it: the Mortgage button
in a player's portfolio never checked `game.state.settings.mortgageEnabled`
— clicking it with the setting off would silently no-op server-side
(handleMortgage returns early) and surface as a generic "action had no
effect" message instead of the button just not being there.

**Status:** fixed — button now also requires
`game.state.settings.mortgageEnabled`.

## 3. POST .../trades/[tradeId]/counter is silently blocked by ad-blockers

**Repro:** From a normal Chrome tab, calling
`POST /api/games/[code]/trades/[tradeId]/counter` fails client-side with
`TypeError: Failed to fetch`; Chrome's own network log shows a 503. The
identically-structured sibling routes (`accept`, `decline`, `cancel`) work
fine from the same tab.

**Root cause:** Not a server bug — confirmed by hitting the exact same URL
with `curl` outside the browser, which got a normal `401` (correct
rejection of a bogus token, proving the route itself works). The word
"counter" is a common tracker/analytics path segment
(`/counter`, `/*counter*`) that ad-blocking and privacy extensions
(uBlock/EasyPrivacy-style lists) block by pattern, and this Chrome
profile has one active. Any real user running a similar blocker would
have "Counter" silently fail in the trade negotiation UI with no
indication why — a genuine, if unusual, product risk.

**Fix:** renamed the route from `.../trades/[tradeId]/counter` to
`.../trades/[tradeId]/negotiate` (and updated TradePanel.tsx's fetch call
to match) — same behavior, a path word blocklists don't target.

**Status:** fixed and re-verified against the live deployment after
redeploying.

## 4. Illegal build attempts only ever say "action had no effect"

**Repro:** Own a full unmortgaged region with `evenBuild` on, build a house
on one property, then try to build a *second* house on that same property
before the others in the region have any. The engine correctly rejects it
(no state change), but the API's blanket fallback for any rejected action
is the generic "action had no effect" — not specific to the even-build
rule, or to any other rejection reason across the whole app.

**Root cause:** `canBuildHouse` (and every other `can*`/`handle*` validity
check in the engine) only ever returns a boolean or silently no-ops —
there's no channel for a specific rejection reason to reach the client.
Fixing this for every action type would be a much larger change than this
pass has room for.

**Fix (scoped to what the scenario actually named):** new exported
`buildHouseBlockedReason(state, playerId, spaceIndex)` — pure, no secrets,
same pattern as `netWorth`/`computeDebtReliefPlan` — returns a specific
human reason or `null`. PlayerPanel's Build button now disables itself
with that reason as a tooltip *before* the player can click into a no-op,
rather than reacting to a vague error after the fact.

**Not fixed, flagging honestly:** every other action type (mortgage, buy,
pay rent, jail actions, etc.) still only surfaces "action had no effect"
on rejection. None of those came up as confusing in this pass — they're
all either clearly unavailable in the UI already (buttons don't render
when the action wouldn't apply) or straightforward enough that the
generic message is adequate — but it's the same underlying gap, just not
severe enough elsewhere to warrant the same treatment under this pass's
time budget.

## 5. "Help me raise it" silently disappears instead of reporting it can't cover the debt

**Repro:** Owe a debt bigger than everything you own could possibly raise
(e.g. a hotel-tier rent against a near-empty, nearly-asset-free player).
The debt panel shows "Pay" and "Declare bankrupt" — "Help me raise it" is
just not there. A player with *some* assets but an insufficient plan gets
exactly the same silent omission.

**Repro tooling note:** found while using the new dev-only
`POST /api/dev/seed-state` harness (see below) to set up scenario 20 —
seeding a hotel-covered monopoly for one player and a near-broke second
player, then landing the second player on it via a real `ROLL` (dice still
computed from the actual server seed; only the position was seeded).

**Root cause:** ActionBar.tsx's `DebtPanel` only rendered the button when
`plan?.sufficient` — `computeDebtReliefPlan` returning "even fully
liquidating you won't cover this" wasn't distinguished from "the button
just doesn't apply here." The spec's own wording called for this button to
*report* it can't cover the debt, not vanish.

**Fix:** button now renders whenever there's a shortfall, regardless of
sufficiency. Its modal branches on `plan.sufficient`: the existing preview
flow when true, and a new explanatory modal when false — "You don't have
anything left to mortgage or sell" when `plan.operations` is empty, or the
exact projected shortfall (`Mortgaging and selling everything you have
would only raise you to $X — still short by $Y`) when it isn't. No Confirm
button in the insufficient case, since `RAISE_DEBT_HELP` is itself a
deliberate no-op there (`handleRaiseDebtHelp` returns early unless
`plan.sufficient`) — matching that rather than offering an action that
would do nothing.

**Status:** fixed and live-verified (both the empty-plan message and the
underlying bankruptcy-transfer flow it sits in front of) against a local
dev server with the new seed-state harness.

## Notes (not bugs)

- Auction UI ("waiting for X to bid or pass…", auction ordering starting
  with the next active player after the decliner) confirmed rendering
  correctly live. Couldn't complete a full bid-through-win cycle in the
  same session because I lost the third test player's clientToken
  (captured only `res.status` on that join call, not the body) — a
  testing-harness mistake, not a product issue. The bid/win mechanics
  themselves are already covered precisely by dedicated engine tests
  (`auction: the highest bidder wins the property and pays their bid`,
  etc.). Re-verified end-to-end in a fresh room later in this pass.

- Added a dev-only `POST /api/dev/seed-state` harness (migration
  `0007_dev_seed_state.sql`) to unblock the two scenarios that were
  previously untested because reaching them by real dice took 60-160
  rounds: monopoly rent-doubling (exact cash delta) and bankruptcy with a
  player creditor. Never reachable in production — gated on
  `NODE_ENV !== "production"` AND a `DEV_HARNESS_SECRET`, both checked
  before the request body is even parsed, failing closed to a generic 404
  either way. The DB function additionally refuses to touch a game whose
  status is `active` unless the caller passes `confirmActive: true`, so a
  stray call can't silently rewrite a real in-progress game. All three
  live-verified against a local dev server:
  - **Monopoly rent doubling**: seeded P2 owning both darkblue properties
    unmortgaged/houseless, landed P1 on one via a real `ROLL` (the seed
    only pre-positions the player — the dice themselves still come from
    the actual server seed). `doubleRentOnFullSet: true` charged exactly
    $80 (2× the $40 base rent); a second room with it `false` charged
    exactly $40. Confirmed via the exact cash delta and the event log
    ("Ada paid Bola $80/$40 rent on Eko Atlantic").
  - **Bankruptcy with a player creditor**: seeded P2 with a hotel-covered
    monopoly and P1 with $50 cash, one already-mortgaged bare property, and
    a jail-free card, then landed P1 on the hotel for an unpayable $3,000
    rent. With `bankruptcyTransfersAssets: true`: the property, its
    mortgaged flag, the jail-free card, and the remaining cash all moved to
    P2. With it `false` (in a 3-player room, so the game didn't end the
    instant P1 went bankrupt): the property returned to the bank fully
    unmortgaged, P2 received only the cash (not the jail-free card, which
    the engine correctly never transfers when the setting is off), and P2
    then landed on the freed space and bought it fresh. This is also where
    bug #5 above was found.
  - **Simulated disconnect** (dev-only "Simulate disconnect (10s)" button
    in the game view, same NODE_ENV guard): live-verified with precise
    timing — the reconnecting banner renders within 300ms, an explicit
    focus-triggered refetch attempt is suppressed for the full window (zero
    API calls in the first 1.5s), and exactly one clean resync fetch fires
    once the window ends. No duplicate events is also architecturally
    guaranteed (`EventLog` dedupes incoming rows by `seq`; `useGame`
    replaces state wholesale rather than accumulating it).

