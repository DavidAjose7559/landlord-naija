// Winner-screen game stats, computed purely from the event log (+ total
// roll count) — no server round trip beyond fetching those, since both
// are already anon-readable. Deliberately approximate where the event
// log doesn't carry enough detail to be exact (see each field's comment)
// rather than adding new event types this late just to back a stats
// strip; every field is clearly a best-effort summary, not a fairness
// claim (that's what /verify is for).

export interface StatEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface GameStats {
  totalTurns: number;
  totalRolls: number;
  biggestRent: { amount: number; payerId: string; payeeId: string } | null;
  mostLandedSpaceIndex: number | null;
  totalTradesCompleted: number;
  longestJailStay: { playerId: string; rollsSpentJailed: number } | null;
  totalMoneyThroughBank: number;
}

function numberOf(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function computeGameStats(events: readonly StatEvent[], totalRolls: number): GameStats {
  let totalTurns = 0;
  let biggestRent: GameStats["biggestRent"] = null;
  const landedCounts = new Map<number, number>();
  let totalTradesCompleted = 0;
  let totalMoneyThroughBank = 0;

  // Jail stay: count each player's own ROLLED events between a
  // SENT_TO_JAIL and their next JAIL_ESCAPED — an approximation of "how
  // many of their own turns they spent jailed" that only needs events
  // already logged, not a new event type.
  const jailedSince = new Map<string, number>(); // playerId -> rolls counted so far this stay
  let longestJailStay: GameStats["longestJailStay"] = null;

  for (const event of events) {
    const p = event.payload;
    switch (event.type) {
      case "TURN_ENDED":
        totalTurns += 1;
        break;
      case "ROLLED": {
        const playerId = String(p.playerId ?? "");
        if (jailedSince.has(playerId)) {
          jailedSince.set(playerId, (jailedSince.get(playerId) ?? 0) + 1);
        }
        break;
      }
      case "MOVED": {
        const to = numberOf(p.to);
        landedCounts.set(to, (landedCounts.get(to) ?? 0) + 1);
        break;
      }
      case "RENT_PAID": {
        const amount = numberOf(p.amount);
        if (!biggestRent || amount > biggestRent.amount) {
          biggestRent = { amount, payerId: String(p.payerId ?? ""), payeeId: String(p.payeeId ?? "") };
        }
        break;
      }
      case "TRADE_ACCEPTED":
        totalTradesCompleted += 1;
        break;
      case "SENT_TO_JAIL": {
        const playerId = String(p.playerId ?? "");
        jailedSince.set(playerId, 0);
        break;
      }
      case "JAIL_ESCAPED": {
        const playerId = String(p.playerId ?? "");
        const rolls = jailedSince.get(playerId);
        if (rolls !== undefined) {
          if (!longestJailStay || rolls > longestJailStay.rollsSpentJailed) {
            longestJailStay = { playerId, rollsSpentJailed: rolls };
          }
          jailedSince.delete(playerId);
        }
        break;
      }
      case "PASSED_GO":
      case "TAX_PAID":
      case "FREE_PARKING_PAID":
        totalMoneyThroughBank += numberOf(p.amount);
        break;
      case "PROPERTY_PURCHASED":
        totalMoneyThroughBank += numberOf(p.price);
        break;
      case "AUCTION_WON":
        totalMoneyThroughBank += numberOf(p.amount);
        break;
    }
  }

  let mostLandedSpaceIndex: number | null = null;
  let mostLandedCount = 0;
  for (const [index, count] of landedCounts) {
    if (count > mostLandedCount) {
      mostLandedCount = count;
      mostLandedSpaceIndex = index;
    }
  }

  return {
    totalTurns,
    totalRolls,
    biggestRent,
    mostLandedSpaceIndex,
    totalTradesCompleted,
    longestJailStay,
    totalMoneyThroughBank,
  };
}
