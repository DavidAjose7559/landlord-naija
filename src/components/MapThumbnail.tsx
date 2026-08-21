import { COLOR_GROUP_VAR } from "@/lib/board-colors";
import type { MapTheme } from "@/game/maps";
import type { ColorGroup } from "@/game/board";

const SWATCH_GROUPS: ColorGroup[] = ["brown", "lightblue", "pink", "orange", "red", "yellow", "green", "darkblue"];

// A tiny, honest preview of a map's actual look — not a hand-drawn icon
// standing in for it. Wrapping just this swatch in the map's own
// data-theme means it renders with the exact same tokens the real board
// will, so "Original" visibly looks different in the picker before you've
// ever selected it, the same way every other themed element does: this
// component has no idea what heritage or modern even are, it just sets
// the scope and lets the cascade do the rest.
export function MapThumbnail({ theme }: { theme: MapTheme }) {
  return (
    <div
      data-theme={theme}
      className="board-paper-texture relative h-10 w-10 shrink-0 overflow-hidden rounded-[4px] bg-board"
      style={{
        boxShadow: "var(--board-shadow)",
        // The board face itself (sage vs cream) is a genuine but subtle
        // difference at 40px — the grid-line colour isn't: heritage's is
        // near-black, modern's a pale tan, so a visible border here is
        // what actually makes the two themes read as different at a
        // glance in the picker, the same token doing the same job it does
        // for the real board's grid rules.
        border: "2px solid var(--color-board-line)",
      }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex flex-wrap content-start" style={{ gap: "var(--board-grid-gap)" }}>
        {SWATCH_GROUPS.map((group) => (
          <span key={group} className="h-2 flex-1 basis-1/4" style={{ backgroundColor: COLOR_GROUP_VAR[group] }} />
        ))}
      </div>
      <span
        className="board-space-name absolute inset-x-0 bottom-0.5 text-center text-[6px] leading-none font-semibold tracking-wide text-board-ink uppercase"
        style={{ opacity: 0.7 }}
      >
        GO
      </span>
    </div>
  );
}
