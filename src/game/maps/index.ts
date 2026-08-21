import { canadaMap } from "./canada";
import { classicMap } from "./classic";
import { naijaMap } from "./naija";
import { originalMap } from "./original";
import type { GameMap, MapId } from "./types";
import { worldTourMap } from "./worldTour";

export const MAPS: Record<MapId, GameMap> = {
  naija: naijaMap,
  worldTour: worldTourMap,
  canada: canadaMap,
  classic: classicMap,
  original: originalMap,
};

export const MAP_LIST: readonly GameMap[] = [naijaMap, worldTourMap, canadaMap, classicMap, originalMap];

export type { GameMap, GameMapRegion, MapId, MapTheme } from "./types";
