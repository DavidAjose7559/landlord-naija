// (Tasks 6/7) The property popover and the auction header both need a
// small region-identity chip — full-saturation region colour, uppercase
// label — as the top of their hierarchy, the same device the tile itself
// uses for its own plate. One shared component so the two can't drift
// into two different "region badge" looks. Takes a raw colour + ink class
// rather than a ColorGroup so it also covers transport/utility (which use
// the fixed plate colours in board-colors.ts, not a region colour).
export function RegionBadge({ color, ink, label }: { color: string; ink: string; label: string }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-[4px] px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase ${ink}`}
      style={{
        backgroundColor: color,
        fontFamily: "var(--font-archivo)",
        fontStretch: "80%",
        fontVariationSettings: "'wdth' 80, 'wght' 700",
      }}
    >
      {label}
    </span>
  );
}
