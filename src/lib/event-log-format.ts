// Pure event->sentence formatting for EventLog.tsx, pulled out of the
// "use client" component so it can be unit tested without dragging in a
// real Supabase client (see event-log-format.test.ts, which feeds it real
// reduce()/GameEvent output rather than hand-built payloads).

import type { Space } from "@/game/board";
import type { PlayerState } from "@/game/types";
import { formatCAD } from "@/lib/money";

export interface EventRow {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

function playerName(players: readonly PlayerState[], id: unknown): string {
  return players.find((p) => p.id === id)?.name ?? "Someone";
}

function spaceNameIn(spaces: readonly Space[], index: unknown): string {
  const i = Number(index);
  return spaces[i]?.name ?? "somewhere";
}

function isGoToJailSpace(spaces: readonly Space[], index: unknown): boolean {
  return spaces[Number(index)]?.type === "gotojail";
}

interface OfferLike {
  cashCents: number;
  spaceIndexes: number[];
  jailFreeCards: number;
}

// "Ogba + $200" / "Ikoyi" / "a jail-free card" — mirrors TradePanel's own
// offerText so a trade reads identically here and in the trade UI itself.
function offerSummary(offer: OfferLike, spaces: readonly Space[]): string {
  const parts: string[] = [];
  for (const idx of offer.spaceIndexes) parts.push(spaceNameIn(spaces, idx));
  if (offer.cashCents > 0) parts.push(formatCAD(offer.cashCents));
  if (offer.jailFreeCards > 0) parts.push(`${offer.jailFreeCards} jail-free card${offer.jailFreeCards > 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(" + ") : "nothing";
}

// One rendered line, with whether it reads as a consequence of the turn
// currently in progress (indented) or as its own top-level event.
export interface Line {
  seq: number;
  text: string;
  indent: boolean;
}

// Turns the flat {type, payload}[] event stream into narrated lines. This
// does two things beyond a 1:1 event->sentence mapping:
//   1. merges a handful of fixed event sequences that only make sense
//      together (a roll and the landing it caused; a card draw and the
//      cash it moved; a roll and the jail-exit it triggered) into one
//      sentence, so a card draw doesn't read as two disconnected lines;
//   2. tracks which lines are "inside" the roll that's currently in
//      progress vs. their own top-level event, so the caller can indent
//      turn consequences under the roll that caused them.
export function buildLines(
  events: EventRow[],
  players: readonly PlayerState[],
  spaces: readonly Space[],
  jailLabel: string,
  deckLabels: { treasure: string; surprise: string },
): Line[] {
  const lines: Line[] = [];
  let indent = false; // true once a ROLLED header has opened this turn's block

  const at = (i: number): EventRow | undefined => events[i];
  const push = (seq: number, text: string, opts: { indent?: boolean; topLevel?: boolean } = {}) => {
    lines.push({ seq, text, indent: opts.topLevel ? false : (opts.indent ?? indent) });
  };

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const p = event.payload;
    const spaceName = (index: unknown) => spaceNameIn(spaces, index);
    const deckName = (deck: unknown) => (deck === "surprise" ? deckLabels.surprise : deckLabels.treasure);

    switch (event.type) {
      case "GAME_STARTED":
        push(event.seq, "The game has started.", { topLevel: true });
        break;

      case "SETTINGS_UPDATED":
        push(event.seq, "The host changed the game settings.", { topLevel: true });
        break;

      case "ROLLED": {
        const name = playerName(players, p.playerId);
        const d1 = Number(p.d1);
        const d2 = Number(p.d2);
        const total = d1 + d2;
        const isDoubles = Boolean(p.isDoubles);
        const totalText = isDoubles ? `${total} (${d1} and ${d2})` : `${total}`;
        const next = at(i + 1);
        const next2 = at(i + 2);

        // Jail doubles-escape: no movement, turn ends right there.
        if (next?.type === "JAIL_ESCAPED" && next.payload.method === "doubles" && next.payload.playerId === p.playerId) {
          push(event.seq, `${name} rolled doubles and left ${jailLabel}.`, { indent: false });
          i += 1; // consume JAIL_ESCAPED
          indent = false;
          break;
        }

        // Three doubles in a row: straight to jail, no intermediate move.
        if (next?.type === "SENT_TO_JAIL" && next.payload.reason === "rolled three doubles in a row") {
          push(event.seq, `${name} rolled ${totalText} — three doubles in a row, sent to ${jailLabel}.`, {
            indent: false,
          });
          i += 1; // consume SENT_TO_JAIL
          indent = false;
          break;
        }

        // Forced fine on the 3rd stuck jail turn, then a forced move.
        if (next?.type === "JAIL_ESCAPED" && next.payload.method === "forcedFine") {
          const amount = formatCAD(Number(next.payload.amount));
          push(event.seq, `${name} paid the ${amount} fine and left ${jailLabel}.`, { indent: false });
          i += 1; // consume JAIL_ESCAPED; the forced MOVED renders via its own consequence line(s)
          indent = true;
          break;
        }

        // Normal landing: rolled + moved (+ sent to jail, if that's what's there).
        if (next?.type === "MOVED" && next.payload.playerId === p.playerId) {
          if (isGoToJailSpace(spaces, next.payload.to) && next2?.type === "SENT_TO_JAIL") {
            push(event.seq, `${name} rolled ${totalText} and landed on Go To Jail — sent to ${jailLabel}.`, {
              indent: false,
            });
            i += 2; // consume MOVED + SENT_TO_JAIL
            indent = false;
            break;
          }
          const landed = `${name} rolled ${totalText} and landed on ${spaceName(next.payload.to)}.`;
          push(event.seq, isDoubles ? `${landed} Doubles — rolling again.` : landed, { indent: false });
          i += 1; // consume MOVED
          indent = true;
          break;
        }

        // Still stuck in jail, non-doubles, not yet the 3rd turn.
        push(event.seq, `${name} rolled ${totalText} — still stuck in ${jailLabel}.`, { indent: false });
        indent = false;
        break;
      }

      case "PASSED_GO":
        push(event.seq, `${playerName(players, p.playerId)} passed GO and collected ${formatCAD(Number(p.amount))}.`);
        break;

      case "PROPERTY_PURCHASED":
        push(event.seq, `${playerName(players, p.playerId)} bought ${spaceName(p.spaceIndex)} for ${formatCAD(Number(p.price))}.`);
        break;

      case "PROPERTY_DECLINED": {
        const next = at(i + 1);
        const name = playerName(players, p.playerId);
        if (next?.type === "AUCTION_STARTED" && next.payload.spaceIndex === p.spaceIndex) {
          push(event.seq, `${name} declined ${spaceName(p.spaceIndex)}. It's up for auction.`);
        } else {
          push(event.seq, `${name} declined ${spaceName(p.spaceIndex)}. It stays with the bank.`);
        }
        break;
      }

      case "RENT_PAID":
        push(
          event.seq,
          `${playerName(players, p.payerId)} paid ${playerName(players, p.payeeId)} ${formatCAD(Number(p.amount))} rent on ${spaceName(p.spaceIndex)}.`,
        );
        break;

      case "TAX_PAID":
        push(event.seq, `${playerName(players, p.playerId)} paid ${formatCAD(Number(p.amount))} ${spaceName(p.spaceIndex)} to the bank.`);
        break;

      case "FREE_PARKING_PAID":
        push(event.seq, `${playerName(players, p.playerId)} collected the ${spaceName(20)} jackpot: ${formatCAD(Number(p.amount))}.`);
        break;

      case "CARD_DRAWN": {
        const name = playerName(players, p.playerId);
        const label = deckName(p.deck);
        const text = String(p.text);
        // Card text always ends with its own punctuation — append the
        // consequence as a new sentence, not a second trailing period.
        const base = `${name} drew a ${label} card: ${text}`;

        // Consume whatever consequence event(s) immediately follow, in the
        // same reduce() batch, so the draw and its effect read as one line
        // instead of two disconnected ones. A moveTo/moveBack card that
        // pays GO pushes PASSED_GO before MOVED — fold that in too rather
        // than let it show as an unrelated line below.
        const leadingGo = at(i + 1);
        const passedGo = leadingGo?.type === "PASSED_GO" && leadingGo.payload.playerId === p.playerId;
        const offset = passedGo ? 1 : 0;
        const goNote = passedGo ? ` Passed GO and collected ${formatCAD(Number(leadingGo!.payload.amount))}.` : "";
        const next = at(i + 1 + offset);
        const next2 = at(i + 2 + offset);

        if (next?.type === "CARD_CASH_COLLECTED" && next.payload.playerId === p.playerId) {
          push(event.seq, `${base} Collected ${formatCAD(Number(next.payload.amount))}.`);
          i += 1;
          break;
        }
        if (next?.type === "CARD_CASH_PAID" && next.payload.playerId === p.playerId) {
          push(event.seq, `${base} Paid ${formatCAD(Number(next.payload.amount))}.`);
          i += 1;
          break;
        }
        if (next?.type === "CARD_CASH_COLLECTED_FROM_EACH" && next.payload.playerId === p.playerId) {
          push(
            event.seq,
            `${base} Collected ${formatCAD(Number(next.payload.amountPerPlayer))} from each player — ${formatCAD(Number(next.payload.totalAmount))} total.`,
          );
          i += 1;
          break;
        }
        if (next?.type === "CARD_CASH_PAID_TO_EACH" && next.payload.playerId === p.playerId) {
          push(
            event.seq,
            `${base} Paid each player ${formatCAD(Number(next.payload.amountPerPlayer))} — ${formatCAD(Number(next.payload.totalAmount))} total.`,
          );
          i += 1;
          break;
        }
        if (next?.type === "CARD_JAIL_FREE_RECEIVED" && next.payload.playerId === p.playerId) {
          push(event.seq, `${base} Kept it for later.`);
          i += 1;
          break;
        }
        if (next?.type === "SENT_TO_JAIL" && next.payload.playerId === p.playerId) {
          push(event.seq, `${base} Sent to ${jailLabel}.`);
          i += 1;
          break;
        }
        if (next?.type === "DEBT_PENDING" && next.payload.playerId === p.playerId) {
          push(event.seq, `${base} Owes ${formatCAD(Number(next.payload.amount))}.`);
          i += 1;
          break;
        }
        if (next?.type === "MOVED" && next.payload.playerId === p.playerId) {
          if (next2?.type === "RENT_PAID" && next2.payload.payerId === p.playerId) {
            push(
              event.seq,
              `${base}${goNote} Landed on ${spaceName(next.payload.to)}, paid ${playerName(players, next2.payload.payeeId)} ${formatCAD(Number(next2.payload.amount))} rent.`,
            );
            i += 2 + offset;
            break;
          }
          if (next2?.type === "DEBT_PENDING" && next2.payload.playerId === p.playerId) {
            push(
              event.seq,
              `${base}${goNote} Landed on ${spaceName(next.payload.to)}, owes ${formatCAD(Number(next2.payload.amount))}.`,
            );
            i += 2 + offset;
            break;
          }
          push(event.seq, `${base}${goNote} Landed on ${spaceName(next.payload.to)}.`);
          i += 1 + offset;
          break;
        }
        push(event.seq, `${base}${goNote}`);
        i += offset;
        break;
      }

      case "DEBT_PENDING":
        push(event.seq, `${playerName(players, p.playerId)} owes ${formatCAD(Number(p.amount))} and needs to raise funds.`);
        break;

      case "HOUSE_BUILT":
        push(
          event.seq,
          p.hotel
            ? `${playerName(players, p.playerId)} built a hotel on ${spaceName(p.spaceIndex)} for ${formatCAD(Number(p.price))}.`
            : `${playerName(players, p.playerId)} built a house on ${spaceName(p.spaceIndex)} for ${formatCAD(Number(p.price))}. Now ${Number(p.houses)} house${Number(p.houses) === 1 ? "" : "s"}.`,
        );
        break;

      case "HOUSE_SOLD":
        push(event.seq, `${playerName(players, p.playerId)} sold a house on ${spaceName(p.spaceIndex)} for ${formatCAD(Number(p.amount))}.`);
        break;

      case "MORTGAGED":
        push(event.seq, `${playerName(players, p.playerId)} mortgaged ${spaceName(p.spaceIndex)} for +${formatCAD(Number(p.amount))}.`);
        break;

      case "UNMORTGAGED":
        push(event.seq, `${playerName(players, p.playerId)} unmortgaged ${spaceName(p.spaceIndex)} for -${formatCAD(Number(p.amount))}.`);
        break;

      case "SENT_TO_JAIL": {
        // Only reachable standalone here (roll-triggered and card-triggered
        // cases are consumed above); still cover it defensively.
        push(event.seq, `${playerName(players, p.playerId)} was sent to ${jailLabel}.`);
        break;
      }

      case "JAIL_ESCAPED": {
        const name = playerName(players, p.playerId);
        if (p.method === "fine") {
          push(event.seq, `${name} paid the ${formatCAD(Number(p.amount))} fine and left ${jailLabel}.`, { topLevel: true });
        } else if (p.method === "card") {
          push(event.seq, `${name} used a Get Out card and left ${jailLabel}.`, { topLevel: true });
        } else {
          // doubles/forcedFine reach here only if the ROLLED merge above
          // didn't fire (defensive fallback — shouldn't normally happen).
          push(event.seq, `${name} left ${jailLabel}.`, { topLevel: true });
        }
        break;
      }

      case "PLAYER_BANKRUPT": {
        const name = playerName(players, p.playerId);
        const next = at(i + 1);
        // PROPERTIES_RETURNED_TO_MARKET fires whenever assets DIDN'T follow
        // the cash to the creditor (settings.bankruptcyTransfersAssets off)
        // — that, not creditorId === "bank", is what decides the wording:
        // a real player can still be owed the cash while the bank keeps
        // the properties.
        if (next?.type === "PROPERTIES_RETURNED_TO_MARKET" && next.payload.playerId === p.playerId) {
          push(event.seq, `${name} is bankrupt. Assets returned to the bank.`, { topLevel: true });
          i += 1;
          break;
        }
        const line =
          p.creditorId === "bank"
            ? `${name} is bankrupt. Assets returned to the bank.`
            : `${name} is bankrupt. All assets transferred to ${playerName(players, p.creditorId)}.`;
        push(event.seq, line, { topLevel: true });
        break;
      }

      case "GAME_OVER":
        push(event.seq, `${playerName(players, p.winnerPlayerId)} wins the game!`, { topLevel: true });
        break;

      case "TRADE_ACCEPTED": {
        const fromName = playerName(players, p.fromPlayerId);
        const toName = playerName(players, p.toPlayerId);
        const give = offerSummary(p.give as OfferLike, spaces);
        const receive = offerSummary(p.receive as OfferLike, spaces);
        push(event.seq, `${fromName} and ${toName} agreed a trade: ${give} for ${receive}.`, { topLevel: true });
        break;
      }

      case "AUCTION_STARTED":
        push(event.seq, `${spaceName(p.spaceIndex)} is up for auction.`, { topLevel: true });
        break;

      case "BID_PLACED":
        push(event.seq, `${playerName(players, p.playerId)} bid ${formatCAD(Number(p.amount))}.`, { topLevel: true });
        break;

      case "AUCTION_PASSED":
        push(event.seq, `${playerName(players, p.playerId)} passed on the auction.`, { topLevel: true });
        break;

      case "AUCTION_WON":
        push(
          event.seq,
          `${playerName(players, p.playerId)} won the auction for ${spaceName(p.spaceIndex)} at ${formatCAD(Number(p.amount))}.`,
          { topLevel: true },
        );
        break;

      case "AUCTION_ENDED_NO_WINNER":
        push(event.seq, `The auction for ${spaceName(p.spaceIndex)} ended with no bids — it stays with the bank.`, {
          topLevel: true,
        });
        break;

      case "TURN_TIMED_OUT":
        push(event.seq, `${playerName(players, p.playerId)}'s turn timed out.`, { topLevel: true });
        break;

      case "PROPERTIES_RETURNED_TO_MARKET":
        break; // folded into the PLAYER_BANKRUPT line above

      case "DEBT_RELIEF_APPLIED":
        push(event.seq, `${playerName(players, p.playerId)} raised cash to cover their debt.`);
        break;

      default:
        break; // MOVED/TURN_ENDED are purely structural — never their own line
    }

    if (event.type === "TURN_ENDED") indent = false;
  }

  return lines;
}
