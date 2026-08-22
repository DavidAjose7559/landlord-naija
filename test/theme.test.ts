// Structural checks for the theme layer (src/app/globals.css) that a
// real browser engine would otherwise be needed to verify — jsdom
// doesn't resolve CSS custom properties well enough to assert this by
// rendering + getComputedStyle, so this reads globals.css as text
// instead. The core thing under test (task 4, "scope correction"): a map
// may only ever redefine --felt/--tile/--ink, and only inside a
// [data-map-id="…"] block — never the fixed panel surface tokens, and
// never at :root, which is exactly the bug that turned the whole app
// maroon-on-maroon when Original was selected.
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

const rootBlock = extractBlock(":root");

// Every map's own [data-map-id] block, keyed by MapId.
const MAP_BLOCKS: Record<string, string> = Object.fromEntries(
  MAP_LIST.map((m) => [m.id, extractBlock(`[data-map-id="${m.id}"]`)]),
);

// The fixed panel/interface palette — must exist exactly once, at
// :root, and never be redefined inside any [data-map-id] block.
const FIXED_SURFACE_TOKENS: Record<string, string> = {
  s0: "#0b120f",
  s1: "#111c18",
  s2: "#18271f",
  s3: "#213229",
  hi: "#f0ede4",
};

// The three variables a map is allowed to change, per map, per the
// design review's exact table.
const EXPECTED_FELT_TILE_INK: Record<string, { felt: string; tile: string; ink: string }> = {
  naija: { felt: "#14201c", tile: "#f2ede0", ink: "#171512" },
  worldTour: { felt: "#101826", tile: "#edeff2", ink: "#12161c" },
  canada: { felt: "#16202a", tile: "#f5f7f8", ink: "#10161a" },
  classic: { felt: "#1a1a1a", tile: "#efeae0", ink: "#161412" },
  original: { felt: "#3a1518", tile: "#e4e8d8", ink: "#14170e" },
};

// Region colours — fixed across all five maps, defined once at :root.
const EXPECTED_REGION_COLOURS: Record<string, string> = {
  "color-group-brown": "#8c5e3c", // Clay
  "color-group-lightblue": "#4cb4d9", // Lagoon
  "color-group-pink": "#d6427e", // Hibiscus
  "color-group-orange": "#e8701a", // Rust
  "color-group-red": "#d22b2b", // Palm Red
  "color-group-yellow": "#f2b705", // Amber
  "color-group-green": "#1f8a54", // Bush
  "color-group-darkblue": "#24486e", // Indigo
};

describe("fixed panel surface palette (task 4)", () => {
  it.each(Object.entries(FIXED_SURFACE_TOKENS))("--%s is defined at :root with the exact spec value", (name, hex) => {
    expect(tokenValue(rootBlock, name).toLowerCase()).toBe(hex);
  });

  it.each(Object.keys(FIXED_SURFACE_TOKENS))("--%s is never redefined inside any [data-map-id] block", (name) => {
    for (const block of Object.values(MAP_BLOCKS)) {
      expect(tokenNames(block).has(name)).toBe(false);
    }
  });

  it("--color-canvas/-surface/-surface-2/-ink/-muted alias the fixed surfaces, not a per-map token", () => {
    expect(tokenValue(rootBlock, "color-canvas")).toBe("var(--s0)");
    expect(tokenValue(rootBlock, "color-surface")).toBe("var(--s1)");
    expect(tokenValue(rootBlock, "color-surface-2")).toBe("var(--s2)");
    expect(tokenValue(rootBlock, "color-ink")).toBe("var(--hi)");
  });
});

describe.each(MAP_LIST)("board frame for map: $id ($name)", (map) => {
  const block = MAP_BLOCKS[map.id];
  const expected = EXPECTED_FELT_TILE_INK[map.id];

  it("defines exactly felt/tile/ink (plus Original's two named extras) — nothing else", () => {
    const names = tokenNames(block);
    const allowed = new Set(["felt", "tile", "ink", "board-grain-opacity", "board-tile-rule-width"]);
    for (const name of names) expect(allowed.has(name)).toBe(true);
  });

  it("matches the design review's exact hex values", () => {
    expect(tokenValue(block, "felt").toLowerCase()).toBe(expected.felt);
    expect(tokenValue(block, "tile").toLowerCase()).toBe(expected.tile);
    expect(tokenValue(block, "ink").toLowerCase()).toBe(expected.ink);
  });
});

describe("Original's two named allowances (task 4)", () => {
  it("gets a 2px ink rule where every other map gets 1.5px", () => {
    expect(tokenValue(MAP_BLOCKS.original, "board-tile-rule-width")).toBe("2px");
    for (const id of MAP_LIST.map((m) => m.id).filter((id) => id !== "original")) {
      expect(tokenNames(MAP_BLOCKS[id]).has("board-tile-rule-width")).toBe(false);
    }
    // The un-overridden default (:root) is what every other map falls
    // through to.
    expect(tokenValue(rootBlock, "board-tile-rule-width")).toBe("1.5px");
  });

  it("gets ~3% paper grain where every other map gets none", () => {
    expect(tokenValue(MAP_BLOCKS.original, "board-grain-opacity")).toBe("0.03");
    for (const id of MAP_LIST.map((m) => m.id).filter((id) => id !== "original")) {
      expect(tokenNames(MAP_BLOCKS[id]).has("board-grain-opacity")).toBe(false);
    }
    expect(tokenValue(rootBlock, "board-grain-opacity")).toBe("0");
  });
});

describe("region colours (task 4: fixed across all five maps)", () => {
  it.each(Object.entries(EXPECTED_REGION_COLOURS))("--%s matches the spec exactly at :root", (name, hex) => {
    expect(tokenValue(rootBlock, name).toLowerCase()).toBe(hex);
  });

  it.each(Object.keys(EXPECTED_REGION_COLOURS))("--%s is never redefined inside any [data-map-id] block", (name) => {
    for (const block of Object.values(MAP_BLOCKS)) {
      expect(tokenNames(block).has(name)).toBe(false);
    }
  });
});

// Board.tsx and the components it hands colour props to must never
// hardcode a hex value — every colour has to come from a token so the
// active [data-map-id] scope, not the component, decides what renders.
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
