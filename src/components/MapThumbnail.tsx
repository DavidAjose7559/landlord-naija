import { COLOR_GROUP_VAR } from "@/lib/board-colors";
import type { GameMap } from "@/game/maps";

// Mirrors Board.tsx's own grid geometry (corner:edge = 1.35:1, same
// index-to-row/col mapping) at thumbnail scale — a genuine miniature of
// the real ring, not a separately-invented layout.
const CORNER_RATIO = 1.35;

function gridPosition(index: number): { row: number; col: number } {
  if (index === 0) return { row: 11, col: 11 };
  if (index <= 9) return { row: 11, col: 11 - index };
  if (index === 10) return { row: 11, col: 1 };
  if (index <= 19) return { row: 11 - (index - 10), col: 1 };
  if (index === 20) return { row: 1, col: 1 };
  if (index <= 29) return { row: 1, col: 1 + (index - 20) };
  if (index === 30) return { row: 1, col: 11 };
  return { row: 1 + (index - 30), col: 11 };
}

// A tiny, honest preview of a map's actual look — not a flag emoji
// standing in for it. Every one of the 40 cells renders in its own grid
// position with its own real colour (region colour for a property, the
// same muted transport/utility plate colours the real tile uses, felt
// for everything without a colour of its own), so the ring SHAPE and the
// actual palette are both genuinely what you'd see after picking it —
// the same reasoning as the real board, just too small for any text.
export function MapThumbnail({ map }: { map: GameMap }) {
  return (
    <div
      data-theme={map.theme}
      className="board-paper-texture relative h-12 w-12 shrink-0 overflow-hidden rounded-[4px] bg-canvas"
      style={{ boxShadow: "var(--board-shadow)", border: "1.5px solid var(--color-board-ink)" }}
      aria-hidden="true"
    >
      <div
        className="grid h-full w-full bg-canvas"
        style={{
          gap: "0.5px",
          gridTemplateColumns: `${CORNER_RATIO}fr repeat(9, 1fr) ${CORNER_RATIO}fr`,
          gridTemplateRows: `${CORNER_RATIO}fr repeat(9, 1fr) ${CORNER_RATIO}fr`,
        }}
      >
        {map.spaces.map((space) => {
          const { row, col } = gridPosition(space.index);
          const color =
            space.type === "property"
              ? COLOR_GROUP_VAR[space.color]
              : space.type === "transport"
                ? "var(--color-plate-transport)"
                : space.type === "utility"
                  ? "var(--color-plate-utility)"
                  : "var(--color-board)";
          return <span key={space.index} style={{ gridRow: row, gridColumn: col, backgroundColor: color }} />;
        })}
        <span
          className="bg-board"
          style={{ gridRow: "2 / 11", gridColumn: "2 / 11" }}
        />
      </div>
    </div>
  );
}
