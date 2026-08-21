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

