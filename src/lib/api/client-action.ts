// Shared between the /action route (server) and useGame (client): the
// shape of an action as the CLIENT is allowed to send it. No "server-only"
// import — this needs to run in the browser too.
//
// Mirrors GameAction, stripped of everything the server must own:
// playerId (always the authenticated caller), dice (the server rolls
// them), the drawn card id (the server draws it), and cash/position
// anywhere. START_GAME isn't here at all — that only happens through
// POST .../start, with its own host/min-players checks.

import { z } from "zod";

const spaceIndexSchema = z.number().int().min(0).max(39);

const tradeOfferSchema = z
  .object({
    cashCents: z.number().int().nonnegative(),
    spaceIndexes: z.array(spaceIndexSchema),
    jailFreeCards: z.number().int().nonnegative(),
  })
  .strict();

export const clientActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ROLL") }).strict(),
  z.object({ type: z.literal("BUY") }).strict(),
  z.object({ type: z.literal("DECLINE_BUY") }).strict(),
  z.object({ type: z.literal("PAY_RENT") }).strict(),
  z.object({ type: z.literal("DRAW_CARD") }).strict(),
  z.object({ type: z.literal("BUILD_HOUSE"), spaceIndex: spaceIndexSchema }).strict(),
  z.object({ type: z.literal("SELL_HOUSE"), spaceIndex: spaceIndexSchema }).strict(),
  z.object({ type: z.literal("MORTGAGE"), spaceIndex: spaceIndexSchema }).strict(),
  z.object({ type: z.literal("UNMORTGAGE"), spaceIndex: spaceIndexSchema }).strict(),
  z.object({ type: z.literal("PAY_JAIL_FINE") }).strict(),
  z.object({ type: z.literal("USE_JAIL_FREE") }).strict(),
  z.object({ type: z.literal("END_TURN") }).strict(),
  z.object({ type: z.literal("DECLARE_BANKRUPT") }).strict(),
  z
    .object({
      type: z.literal("PROPOSE_TRADE"),
      toPlayerId: z.string().uuid(),
      give: tradeOfferSchema,
      receive: tradeOfferSchema,
    })
    .strict(),
  z.object({ type: z.literal("ACCEPT_TRADE"), tradeId: z.number().int() }).strict(),
  z.object({ type: z.literal("DECLINE_TRADE"), tradeId: z.number().int() }).strict(),
]);

export type ClientAction = z.infer<typeof clientActionSchema>;

export const actionRequestSchema = z
  .object({
    clientToken: z.string().min(1),
    action: clientActionSchema,
  })
  .strict();
