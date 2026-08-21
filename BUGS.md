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

## 6. handleMortgage/handleUnmortgage had no turn or phase gate at all

**Spec:** voluntary mortgaging — raising cash by mortgaging a property when
you're *not* in debt, purely to fund building elsewhere, interleaved freely
with build/sell/unmortgage on your own turn.

**Repro (found while auditing, not from a report):** with an opponent's
turn active, `MORTGAGE`/`UNMORTGAGE` on your own property still applied —
`handleMortgage`/`handleUnmortgage` checked property ownership but never
checked whose turn it was or what `turnPhase` the game was in. A player
could mortgage or unmortgage mid-opponent's-turn, mid-auction, or mid-
someone-else's-debt.

**Fix:** both now gate on `currentPlayer(state).id === playerId`, matching
every other action handler, and exclude only `turnPhase === "game_over"` —
mortgage/unmortgage are legal in any phase of your own turn, including
`awaiting_payment` (see the interpretation note below).

**Already correct, verified by direct code read, no changes needed:**
- **Building blocked by a mortgaged region-mate:** `ownsFullUnmortgagedGroup`
  (added for the property inspector) already requires every property in the
  color group to be owned *and* unmortgaged before `canBuildHouse` allows a
  build — this is scoped per-`space.color`, so mortgaging properties in one
  region was already structurally incapable of blocking a build in an
  unrelated region. The core "mortgage region A, build region B, same turn"
  scenario worked correctly with zero engine changes.
- **Mortgaged-but-still-owned:** mortgaging only flips `own.mortgaged`, never
  deletes the ownership entry, so a mortgaged property can never appear
  available for another player to buy — set-completion blocking (rule 4)
  falls out of the data model for free.
- **No rent while mortgaged:** `resolveLanding` returns immediately when
  `own.mortgaged` is true, before rent is ever computed.
- **Unmortgage cost:** `computeMortgage` in `board.ts` already computes
  `Math.ceil(mortgageValue * 1.1)` — mortgage value plus 10%, rounded up.
- **Trading a mortgaged property:** `handleExecuteAcceptedTrade` only
  reassigns `ownerId` on transferred spaces; `mortgaged`/`houses`/`hotel`
  carry over untouched, so the receiving player inherits the mortgage as-is.

**UI:** PlayerPanel's Mortgage button used to be hidden entirely whenever
the property had houses (rather than shown-and-disabled), and Sell/
Mortgage/Unmortgage had no reason-surfacing at all. New exported
`mortgageBlockedReason`/`unmortgageBlockedReason`/`sellHouseBlockedReason`
(same pattern as `buildHouseBlockedReason` from bug #4) now back every one
of the four portfolio buttons, each disabled-with-tooltip before the click
rather than erroring after it. Every button also shows its exact cash
delta (`Mortgage — +$25`, `Unmortgage — −$27.50`, `Build house — −$50`,
`Sell house — +$25`), computed from the same `mortgageValue`/
`unmortgageCost`/`houseCost` fields the engine charges from — never
re-derived or guessed.

**Interpretation note, disclosed rather than silently deviating from the
literal spec:** the spec's wording is "available in any turn_phase except
resolving_debt." This codebase's debt phase is `awaiting_payment`, and it's
already the phase `computeDebtReliefPlan`'s "help me raise it" flow uses to
call `handleMortgage`/`handleSellHouse` directly — a previously-shipped,
tested self-service debt-relief path (see bug #5). Excluding
`awaiting_payment` from mortgage/unmortgage/sell-house, as the literal spec
text asks, would have regressed that feature. Kept `awaiting_payment`
reachable for those three (a debtor raising cash to pay down what they owe
is exactly as legitimate a use as the voluntary case this spec is about),
and excluded it only for `BUILD_HOUSE` — taking on new expansion while you
owe an unresolved debt stays disallowed, matching both spec intent and
pre-existing design.

**Status:** fixed and verified — 4 new engine unit tests (bare-property
mortgage cash delta + zero rent; house-present mortgage rejection; build
rejected when a region-mate is mortgaged; the core mortgage-region-A-then-
build-region-B-same-turn scenario) plus a live two-tab local run against a
running dev server via the `POST /api/dev/seed-state` harness: seeded a
player owning two brown and three lightblue properties, mortgaged both
brown properties and built a house on a lightblue property through the
real UI in one tab, and confirmed in a second, unauthenticated spectating
tab — no manual refresh — that cash, the event log ("Ada mortgaged Agege.",
"Ada mortgaged Mushin.", "Ada built a house on Ojuelegba."), the dimmed
diagonal strike on both mortgaged spaces, and the new house marker all
updated live.

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

- Added a property inspector — click or tap any board space (or a property
  name in a player's portfolio) to open a read-only card: full rent ladder,
  current applicable rent highlighted with a reason, mortgage/build costs,
  owner, region overview strip, or a plain-language explainer for tax/GO/
  jail/free-parking/card spaces. No action buttons, no state mutation. No
  gaps found against the spec — nothing pre-existing to compare against
  (grepped for any prior "inspector"/property-card component; found none).
  `computePropertyRent`/`computeTransportRent`/`computeUtilityRent`/
  `ownsFullUnmortgagedGroup`/`ownedPropertyIndexesInGroup` were exported
  from `engine.ts` (previously module-private) specifically so the card
  imports the exact functions `resolveLanding` charges rent with, rather
  than re-deriving the number — the new engine.test.ts describe block
  asserts each one's return value against what `reduce()` actually charges
  a player landing there, for every property tier plus transport/utility
  ownership counts. Live-verified in two browser tabs: a non-current player
  opened a full monopoly's card, a mortgaged property, an unowned transport,
  and an unowned utility mid-opponent's-turn with zero effect on server
  state (confirmed via a direct API read before/after — turnPhase, both
  players' cash, and the full ownership map were byte-identical); real
  keyboard Tab+Enter opened a card; Escape and tap-outside both closed it;
  the mobile viewport correctly switched to a bottom sheet with the same
  content. Modal.tsx picked up `role="dialog"`/`aria-modal`/Escape-to-close
  as a small, generically-useful side effect — every modal in the app gets
  Escape now, not just this one. **Not verified**: the mobile sheet's
  swipe-down-to-close gesture. Two different synthetic-drag approaches
  (CDP's `left_click_drag` and a manually-dispatched multi-step
  `PointerEvent` sequence) both failed to trigger Framer Motion's
  `onDragEnd`, most likely because its gesture recognizer requires trusted,
  OS-originated pointer events that scripted/CDP input doesn't reliably
  produce — not something specific to this component, since the drag
  implementation directly mirrors `MobileSheet.tsx`'s already-shipped,
  real-user-tested drag-to-resize handle (same `drag="y"` +
  `dragConstraints` + `onDragEnd`-threshold pattern). Tap-outside-to-close
  works on the mobile sheet as a confirmed alternative dismissal path.

- Added an in-game bug report button — a small 🐛 pill fixed to the bottom
  corner in both the lobby and the board view, always enabled (no turn
  gating, no session requirement — a spectator can file one), opening a
  compact form (free-text description + a 3-way severity picker,
  `mortgageBlockedReason`-style disabled state isn't relevant here since
  there's nothing to block). Submitting only ever `POST`s to `/api/bugs`,
  never through the game's own action route — there is no code path from
  this button to a game-state mutation, which the new
  "does not mutate game state" unit test asserts directly (byte-identical
  `GET /api/games/[code]` response before and after a submission).

  Everything except the description/severity is captured automatically:
  the server independently re-derives room/game id, full state, settings,
  mapId, turn_phase, current player vs. reporter, every player's cash/
  position/properties/jail/bankrupt status, the last 20 events, last 5
  rolls, and any open trade threads with full round history — all read
  fresh from the DB, never trusted from the client, since a malicious or
  just-plain-stale client shouldn't be able to fabricate what a report
  says the game state was. Only the truly client-only half (user agent,
  viewport, online state, device pixel ratio, and a 20-entry ring buffer
  of console errors/uncaught exceptions/unhandled rejections/failed fetch
  calls, installed once at app boot in `src/lib/diagnostics.ts`) comes from
  the request body as-is, since the server has no way to observe any of
  that itself.

  New `bug_reports` table (migration `0008_bug_reports.sql`), no RLS
  policies at all — same treatment as `player_secrets`/`game_secrets` —
  writes go through a `create_bug_report` RPC using the service role.
  `game_id` is `ON DELETE SET NULL` on purpose: a report has to outlive
  the game it describes. Rate-limited to 5 reports per 10 minutes, keyed
  by `clientToken` when the reporter has a seat and by IP otherwise.

  Review surface at `/bugs`, gated by `?secret=` matching `ADMIN_SECRET` —
  deliberately NOT the `DEV_HARNESS_SECRET`/`NODE_ENV` pattern, since
  reports only matter once real players are filing them in production;
  the secret alone is what keeps it private. Wrong or missing secret is a
  plain 404 (via `next/navigation`'s `notFound()`), same
  don't-confirm-the-route-exists posture as the dev harness. Each report
  expands to its full JSON snapshot and has a "Copy for Claude Code"
  button producing a single markdown block (description, severity, commit
  SHA, a curated state slice, last events, captured console/network
  errors, and a one-line repro hint derived from `turn_phase` + the
  reporter's board position) — `GET /api/bugs?secret=...&unresolved=true`
  returns the same markdown concatenated for every open report, for
  pulling a whole game night's bugs in one paste.

  **Verified:** 13 new unit tests (10 for `/api/bugs`'s POST/GET and
  `/api/bugs/[id]`'s PATCH, 3 for the `/bugs` page's secret gating) against
  the same hand-written fake Supabase client every other route test uses —
  covering the no-mutation guarantee, the rate limit's 6th-request
  rejection, spectator (no `clientToken`) submissions, and 404s on a
  missing/wrong secret for both the page and the API. Migration
  `0008_bug_reports.sql` applied to the real Supabase project (confirmed
  via a direct `create_bug_report` RPC probe, then cleaned up).

  Live two-tab browser verification against a local dev server pointed at
  that real project: two-player room, Bola (non-current) filed a report
  mid-Ada's-turn (`awaiting_roll`). In Bola's tab, the form closed and
  "Logged. Thanks — that helps." appeared. In Ada's tab: zero disruption —
  no toast, no modal, Roll still enabled, event log still "Nothing has
  happened yet." `GET /api/games/[code]` before and after the submission
  came back **byte-identical** (`diff` on the two responses produced no
  output), the same check used for the property inspector pass. `/bugs`
  with the secret listed the report with the full snapshot — room, turn
  info (`turnPhase: "awaiting_roll"`, current player Ada, reporter not the
  current player), settings, mapId, both players' cash/position, an empty
  event/roll/trade history (nothing had happened yet in this fresh room —
  confirms those arrays are wired to real queries, not hardcoded), and
  client info (real user agent, viewport, dpr). "Copy for Claude Code"
  showed a "Copied!" confirmation (`navigator.clipboard.writeText`
  permission was granted in the automated browser; reading the OS
  clipboard back was not — `clipboard-read` sat at `prompt`, which a
  synthetic click can't answer — so the copy itself was verified via the
  UI's "Copied!" state plus `GET /api/bugs?unresolved=true`, which renders
  through the exact same shared `formatBugReportMarkdown` function and
  produced correct, complete markdown including a repro hint). The
  resolved checkbox was toggled live and persisted. Confirmed 404 (no
  body leaked) on `/bugs`, `/api/bugs`, and `/api/bugs/[id]` with a
  missing or wrong secret, both via unit tests and directly with `curl`
  against the running dev server.

## 7. Bug report button was mounted per-page, not global

**Repro:** the 🐛 button only existed on the two pages that explicitly
imported and rendered `<BugReportButton>` (the board and the lobby). Every
other route — home, `/rules`, the fairness/verify page, and any future page
— had no way to file a report at all, and nothing would have caught a new
page silently missing it.

**Fix:** `BugReportButton` is now mounted exactly once, in the root layout,
after `{children}`. It's also been rewritten to take no props at all —
previously it needed `roomCode`/`session` threaded down from whichever page
rendered it, which is exactly the kind of per-page wiring that's easy to
forget. It now derives the room code from the current path itself
(`usePathname()` + a regex against `/game/[code]...`) and loads that room's
session from `localStorage` at submit time — the same storage `useGame`
already reads, just read directly instead of threaded through props.

**Also fixed as part of the same pass:**
- **No-game submissions.** A report filed from a page with no active game
  (home, `/rules`) used to be impossible — the request schema required
  `roomCode`. The whole `game` half of the snapshot type
  (`BugReportGameSnapshot`) is now nullable as one unit, set to `null`
  when `roomCode` is absent from the request, rather than a bag of
  independently-nullable fields a caller could forget to check. A new
  `path` field (the route the reporter was actually on) is always
  captured, game or not.
- **Full-screen overlays sitting on top of the button.** WinnerScreen (and
  any other `z-50` full-screen takeover) previously had the same z-index
  as the bug button's `z-[45]` — a tie broken by DOM order, which happened
  to go the button's way before but wasn't guaranteed. Bumped to `z-[60]`,
  explicitly above every overlay in the app, so this can't regress if a
  future overlay is added at `z-50` or if the mount point ever moves.
- **Commit SHA showing "unknown" locally.** `NEXT_PUBLIC_COMMIT_SHA`
  fell back to `""` outside Vercel, which the button then mapped to
  `null`, which the markdown formatter rendered as "unknown" — the same
  label a genuinely indeterminate historical row would show. Falls back
  to the literal string `"local-dev"` now, so a report filed against
  `pnpm dev` reads unambiguously as local, not as "no idea what build
  this was."

**Status:** fixed and verified. Confirmed the button renders on `/`,
`/rules`, `/game/[code]/lobby`, `/game/[code]`, and
`/game/[code]/verify`. Drove a real game to a bankruptcy-triggered finish
(hotel-covered monopoly + an unpayable debt, same technique as the
seed-state harness notes below) to confirm the button — and, when opened,
its own modal — render visibly on top of the full-screen `WinnerScreen`
takeover rather than behind it. Submitted a report from `/rules` with no
active game and confirmed it succeeded ("Logged. Thanks — that helps."),
and that `GET /api/bugs` shows `(no active game — filed from /rules)` for
its relevant-state section rather than erroring or faking game data. New
unit test covers the no-roomCode case end-to-end (game_id/room_code null,
`snapshot.game` null, reporter "Anonymous"). Confirmed `Commit: local-dev`
locally; production commit SHA populating correctly is verified separately
once deployed (see README).

## 8. Fifth map ('original') and a per-map visual theme layer

Added a `theme: 'modern' | 'heritage'` field on `GameMap` — a property of
the map, never a user setting. Every colour, board-rendering value
(grid-rule weight, shadow, paper-grain strength) and font family a themed
component needs is a CSS custom property, defined at `:root` and
redefined per `[data-theme]` scope in `src/app/globals.css`; the page sets
`data-theme` on one ancestor element (`game/[code]/page.tsx` and
`lobby/page.tsx`, keyed off the current map's theme) and every token
cascades to descendants from there — `Board.tsx`, `PlayerPanel.tsx`, and
`PropertyInspector.tsx` never check which theme is active, they just
consume `--color-*`/`--board-*`/`--font-*` tokens (colour groups via
`src/lib/board-colors.ts`'s `COLOR_GROUP_VAR`, `var(--color-group-*)`
references, not raw hex — renamed from `COLOR_GROUP_HEX` since it no
longer holds hex at all).

**Real bug found while building this, not specific to heritage:** the
board's 9x9 interior isn't covered by any space — it was falling through
to the grid container's own background, `bg-board-line`, which exists
purely to draw the hairline rules in the gaps between adjacent cells.
Modern's line colour is a pale tan close to the board colour, so this
never looked wrong — same board-on-board wash either way. Heritage's line
colour is near-black, and the same fallthrough turned the entire centre
into a solid black void. Fixed by explicitly filling that 9x9 area with
`bg-board` as its own grid item — a correct fix in both themes, not a
heritage-only patch (`Board.tsx`).

Added `MapId 'original'` (registry: naija, worldTour, canada, classic,
original — classic untouched) with period place names on the existing
40-space skeleton, same 8 colour groups and $60→$400 price ladder, 16
treasure/16 surprise cards with period flavour. Passes every existing
per-map structural test with zero map-specific test code, since
`maps.test.ts` parametrizes over `MAP_LIST`.

Heritage treatment: pale sage board face with heavy 2px black rules
(vs. modern's 1px near-board-colour hairline), flat — `box-shadow: none`
— where modern casts a raised-slab shadow, ~4% paper grain (modern: 3%),
and Oswald (self-hosted via `next/font/google`, weights 500/700) for
property names/prices instead of Geist. The JAIL corner always renders an
unconditional "just visiting" strip (a space-type branch, not a theme
branch — modern's CSS just leaves it visually unified with the rest of
the corner).

Map picker (`SettingsPanel.tsx`) gets a `MapThumbnail` per map — a real
40px swatch scoped to that map's own `data-theme`, not a hand-drawn icon —
plus a gold "Heritage" badge on Original. First pass used only the board
colour and colour-group swatches to differentiate themes in the
thumbnail; at 40px, sage-vs-cream board colour was too close in lightness
to read at a glance even though it was resolving correctly (verified via
`getComputedStyle`). Added a 2px border in `var(--color-board-line)` —
heritage's near-black vs. modern's pale tan — which is what actually
makes the two read as different designs in the picker before you've
selected either.

**Verified:** 35 new structural tests (`test/theme.test.ts`) — every
rendering token defined by one theme is defined by the other, heritage's
`--h-*` palette and colour-group hex match the spec exactly, heritage is
flatter/heavier/grainier than modern per-token, heritage's display font
resolves to Oswald and modern's to Geist, zero raw hex literals in any
board/panel component or `board-colors.ts`, every map but 'original' is
`modern` and 'original' is `heritage`. `original` itself passes all 7
parametrized per-map assertions in `maps.test.ts` (40 spaces, type
counts, 2/3/3/3/3/3/3/2 regions, monotonic rent, choice/flat tax
placement, 16 cards/deck with exactly one jail-free each) — 36/36 passing
there, 236/236 across the whole suite.

Live-verified locally: created one game on `naija` and one on `original`,
screenshotted both boards side by side — sage-vs-parchment board face,
heavy black vs. hairline tan rules, flat vs. raised-shadow edge (visible
directly in the screenshot: the modern board casts a soft gradient onto
the table around it, heritage's sits flush), and condensed/bold Oswald
vs. Geist property names are all immediately visually distinct. Confirmed
legible at a ~375px mobile viewport (zoomed crop of "BISHOPSGATE RISE
$260" fully readable at that width). Confirmed via `document.fonts` and
`getComputedStyle` in-browser that `.board-space-name` resolves to
`Oswald, "Oswald Fallback"` at weight 700 on the heritage board and
`Geist, "Geist Fallback", ...` at weight 600 on modern, and that `Oswald`
appears in `document.fonts` with `status: "loaded"` — not a silent
fallback. Opened the map picker, confirmed all four modern maps render
visually identical thumbnails and Original's renders distinctly
(sage-tinted, black-bordered) with the gold Heritage badge.

