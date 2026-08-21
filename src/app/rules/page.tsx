import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Playing rules — LANDLORD Naija Edition",
  description: "How the board, cards, jail, trading, and fairness system work.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function RulesPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-10 bg-canvas px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm font-medium text-accent hover:brightness-110">
          ← Home
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-ink">Playing rules</h1>
        <p className="text-muted">Buy Lagos. Own Naija. Bankrupt your friends.</p>
      </div>

      <Section title="The goal">
        <p>
          Move around the board buying property, collect rent from anyone who lands on what you own, and outlast
          everyone else. The last player who hasn&apos;t gone bankrupt wins.
        </p>
      </Section>

      <Section title="The board">
        <p>
          40 spaces in a loop: 22 properties in 8 colour groups (brown, light blue, pink, orange, red, yellow,
          green, dark blue), 4 transport hubs, 2 utilities, 2 tax spaces, 6 card spaces, and 4 corners — GO,
          Kirikiri (jail), Detty December (free parking), and Go To Kirikiri.
        </p>
        <p>Landing exactly on or passing GO pays you $200. Detty December does nothing — no jackpot pot to land on.</p>
      </Section>

      <Section title="Buying and rent">
        <p>
          Land on an unowned property, transport, or utility and you can buy it at the listed price, or pass and
          leave it with the bank. Land on one someone else owns and you pay rent automatically — unless it&apos;s
          mortgaged, which pays nothing.
        </p>
        <p>
          Own every property in a colour group (all unmortgaged) and the base rent on those properties doubles,
          even before you build a single house.
        </p>
        <p>
          Transport rent scales with how many of the 4 hubs one player owns: $30 / $60 / $120 / $240. Utility rent
          is based on the dice roll that landed you there — 4× the roll with one utility owned, 10× with both.
        </p>
      </Section>

      <Section title="Building houses">
        <p>
          You can only build once you own an entire colour group, mortgage-free. Building follows the{" "}
          <span className="text-ink">even-build rule</span>: you can&apos;t put a 2nd house on one property until
          every property in that group has at least 1. Selling houses follows the same rule in reverse.
        </p>
        <p>
          Four houses become one hotel. The bank only has 32 houses and 12 hotels in total supply across the whole
          game — if it runs out, you&apos;ll have to wait for someone to sell before you can build.
        </p>
      </Section>

      <Section title="Kirikiri (jail)">
        <p>
          You can get sent to Kirikiri by landing on Go To Kirikiri, drawing a card that sends you there, or
          rolling doubles three times in one turn — which also forfeits that turn&apos;s move entirely.
        </p>
        <p>
          Once inside, you get up to 3 turns to get out: roll doubles (you&apos;re free, but you don&apos;t get to
          move that roll), pay a $50 fine, or use a jail-free card if you&apos;re holding one. Still stuck after
          your 3rd turn? The fine is taken automatically and you move on that roll.
        </p>
      </Section>

      <Section title="Cards">
        <p>
          Two decks of 16, drawn when you land on a card space and shuffled at the start of the game — you never
          know what&apos;s coming.
        </p>
        <p>
          <span className="font-medium text-ink">Owambe</span> cards are mostly good news: cash windfalls, refunds,
          the odd hospital bill. <span className="font-medium text-ink">Village People</span> cards are chaos —
          being sent backward, straight to Kirikiri, or fast-tracked to the nearest transport hub or utility to pay
          up on the spot. Both decks hold one jail-free card each.
        </p>
      </Section>

      <Section title="Trading">
        <p>
          Propose a trade with any other player at any time — cash, properties (as long as they&apos;re free of
          houses), and jail-free cards, in either direction. They get to accept or decline.
        </p>
      </Section>

      <Section title="Bankruptcy">
        <p>
          Can&apos;t cover a debt? Mortgage properties or sell houses to raise cash first. Still short? You&apos;re
          bankrupt. Everything you have — cash, properties, jail-free cards — transfers to whoever you owed, or
          back to the bank if the debt was tax or a card. Houses are always sold back to the bank at half price
          before anything changes hands.
        </p>
        <p>The game ends the moment only one player is left standing.</p>
      </Section>

      <Section title="Fairness">
        <p>
          Every dice roll is generated from a secret seed the server commits to — publishing its SHA-256 hash — the
          moment the game starts, before anyone rolls. Each roll is{" "}
          <span className="text-ink">HMAC-SHA256(seed, gameId:rollIndex)</span>, so the outcome is fixed the
          instant the seed exists; nothing about how the game unfolds can change what any given roll will be.
        </p>
        <p>
          Every roll is also chained into the last one — each row&apos;s hash covers the previous row&apos;s hash
          plus its own dice — so the ledger can&apos;t be quietly edited or reordered after the fact without
          breaking the chain.
        </p>
        <p>
          When the game ends, the seed itself is revealed. Open any game&apos;s{" "}
          <span className="text-ink">Fairness</span> page and hit Verify: it recomputes every single roll from the
          revealed seed, right there in your browser, and checks it against what was actually recorded.
        </p>
      </Section>
    </div>
  );
}
