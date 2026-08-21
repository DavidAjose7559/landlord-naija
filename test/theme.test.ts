// Structural checks for the theme layer (src/app/globals.css) that a
// real browser engine would otherwise be needed to verify: that every
// token one theme defines is also defined by the other (no orphans one
// scope silently falls back on), that the heritage palette matches the
// spec exactly, and that no board/panel component references a raw hex
// instead of a token. jsdom doesn't resolve CSS custom properties well
// enough to assert this by rendering + getComputedStyle, so this reads
// globals.css as text instead — a deliberate, meaningful substitute, not
// a weaker stand-in.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAPS, MAP_LIST } from "@/game/maps";

const ROOT = path.resolve(import.meta.dirname, "..");
const CSS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

function extractBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*{([^}]*)}`).exec(CSS);
  if (!match) throw new Error(`block not found in globals.css: ${selector}`);
  return match[1];
}

function tokenNames(block: string): Set<string> {
  return new Set([...block.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

function tokenValue(block: string, name: string): string {
  const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`token --${name} not found in block`);
  return match[1].trim();
}

const modernBlock = extractBlock('[data-theme="modern"]');
const heritageBlock = extractBlock('[data-theme="heritage"]');

// Every rendering token (not the --h-* raw-palette names, which only
// heritage has by design) that one theme defines, the other must too —
// otherwise a component consuming it in the "missing" theme would
// silently fall through to whatever :root happens to hold.
const RENDERING_TOKENS = [
  "color-canvas",
  "color-canvas-edge",
  "color-surface",
  "color-surface-2",
  "color-gold",
  "color-magenta",
  "color-danger",
  "color-board",
  "color-board-line",
  "color-board-ink",
  "color-group-brown",
  "color-group-lightblue",
  "color-group-pink",
  "color-group-orange",
  "color-group-red",
  "color-group-yellow",
  "color-group-green",
  "color-group-darkblue",
  "board-grid-gap",
  "board-shadow",
  "board-grain-opacity",
  "board-corner-padding",
  "font-board-display",
];

describe("theme tokens (src/app/globals.css)", () => {
  it.each(RENDERING_TOKENS)("--%s is defined by both [data-theme=modern] and [data-theme=heritage]", (name) => {
    expect(tokenNames(modernBlock).has(name)).toBe(true);
    expect(tokenNames(heritageBlock).has(name)).toBe(true);
  });

  it("heritage's --h-* palette matches the spec exactly", () => {
    const expected: Record<string, string> = {
      "h-table": "#7d2b24",
      "h-table-edge": "#5a1e19",
      "h-board": "#dce9d5",
      "h-board-line": "#1a1a1a",
      "h-board-ink": "#101010",
      "h-panel": "#2a1512",
      "h-panel-raised": "#3a1e1a",
      "h-gold": "#e8c547",
      "h-magenta": "#d4437a",
      "h-danger": "#b3382e",
    };
    for (const [name, hex] of Object.entries(expected)) {
      expect(tokenValue(heritageBlock, name).toLowerCase()).toBe(hex);
    }
  });

  it("heritage's colour-group palette matches the spec exactly", () => {
    const expected: Record<string, string> = {
      "color-group-brown": "#8b5a3c",
      "color-group-lightblue": "#a7d3e8",
      "color-group-pink": "#d4508f",
      "color-group-orange": "#e8892b",
      "color-group-red": "#c4372c",
      "color-group-yellow": "#f2d33c",
      "color-group-green": "#2e8b4f",
      "color-group-darkblue": "#2b4c9b",
    };
    for (const [name, hex] of Object.entries(expected)) {
      expect(tokenValue(heritageBlock, name).toLowerCase()).toBe(hex);
    }
  });

  it("heritage sits flat (no shadow) where modern casts a raised-slab shadow", () => {
    expect(tokenValue(heritageBlock, "board-shadow")).toBe("none");
    expect(tokenValue(modernBlock, "board-shadow")).not.toBe("none");
  });

  it("heritage's grid rules are heavier and its grain stronger than modern's", () => {
    expect(parseFloat(tokenValue(heritageBlock, "board-grid-gap"))).toBeGreaterThan(
      parseFloat(tokenValue(modernBlock, "board-grid-gap")),
    );
    expect(parseFloat(tokenValue(heritageBlock, "board-grain-opacity"))).toBeGreaterThan(
      parseFloat(tokenValue(modernBlock, "board-grain-opacity")),
    );
  });

  it("heritage's display font resolves to Oswald, modern's to the app sans", () => {
    expect(tokenValue(heritageBlock, "font-board-display")).toBe("var(--font-oswald)");
    expect(tokenValue(modernBlock, "font-board-display")).toBe("var(--font-geist-sans)");
  });
});

// Board.tsx and the components it hands colour props to must never
// hardcode a hex value — every colour has to come from a token so the
// active [data-theme] scope, not the component, decides what renders.
const THEME_AWARE_FILES = [
  "src/lib/board-colors.ts",
  "src/components/Board.tsx",
  "src/components/PlayerPanel.tsx",
  "src/components/PropertyInspector.tsx",
  "src/components/MapThumbnail.tsx",
];

describe("no raw hex colours in board/panel components", () => {
  it.each(THEME_AWARE_FILES)("%s contains no hex colour literals", (relPath) => {
    const source = readFileSync(path.join(ROOT, relPath), "utf8");
    const matches = source.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(matches).toBeNull();
  });
});

describe("GameMap.theme", () => {
  it("every map but 'original' uses the modern theme", () => {
    for (const map of MAP_LIST) {
      if (map.id === "original") continue;
      expect(map.theme).toBe("modern");
    }
  });

  it("'original' uses the heritage theme", () => {
    expect(MAPS.original.theme).toBe("heritage");
  });
});
