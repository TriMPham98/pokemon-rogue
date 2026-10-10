/**
 * FireRed/LeafGreen environment art, cut from the game's own tilesets (pret/pokefirered data/tilesets) and object
 * sprites. `npm run assets` renders each entry to public/assets/env/<name>.png (scripts/gba-tiles.ts); the arenas in
 * biomes.ts lay them out as ground tiles, flat decals and standing billboards. Plain data so the asset script can
 * import it.
 *
 * A metatile is 16×16 px, one world unit. `grid` lists metatile ids (rows of columns). With `bg`, the art is cut
 * out of those ground metatiles so it can stand on its own as a billboard.
 */
export interface TileArt {
  prim: 'general' | 'building'; // primary tileset
  sec: string; // secondary tileset folder
  grid: number[][];
  bg?: number[];
  quad?: 0 | 1 | 2 | 3; // fill the tile with this 8×8 quarter (sand only comes with grassy corners)
}
/** An object-event sprite (first frame of the sheet). */
export interface SpriteArt {
  sprite: string; // graphics/object_events/pics/<sprite>.png
  w: number;
  h: number;
}
export type EnvArt = TileArt | SpriteArt;

const G = (grid: number[][], bg?: number[], sec = 'pallet_town', quad?: TileArt['quad']): TileArt => ({ prim: 'general', sec, grid, bg, quad });
const GRASS_BG = [1, 8, 9];

export const ENV = {
  // ── routes ──
  grass: G([[1]]),
  grassTufts: G([[8]]),
  grassTufts2: G([[9]]),
  tallGrass: G([[13]]),
  flowers: G([[4]]),
  sand: G([[259]], undefined, 'pallet_town', 3),
  dirt: G([[262]], undefined, 'pallet_town', 3),
  water: G([[299]]),
  pine: G([[14, 15], [30, 31]], GRASS_BG),
  hedge: G([[318, 319]], [...GRASS_BG, 260]),
  fencePost: G([[233]], GRASS_BG),
  routeSign: G([[3]], GRASS_BG),
  tipsSign: G([[2]], GRASS_BG),
  // Viridian Forest's big round trees and white flowers
  forestTree: G([[648, 649, 650], [664, 665, 666]], GRASS_BG, 'viridian_forest'),
  forestFlowers: G([[642]], undefined, 'viridian_forest'),
  // ── caves: the cave tilesets share a layout (641 floor, 642 boulder, 643 rubble) with their own palettes ──
  caveFloor: G([[641]], undefined, 'cave'),
  caveRock: G([[642]], [641], 'cave'),
  caveRubble: G([[643]], [641], 'cave'),
  tunnelFloor: G([[641]], undefined, 'rock_tunnel'),
  tunnelRock: G([[642]], [641], 'rock_tunnel'),
  tunnelRubble: G([[643]], [641], 'rock_tunnel'),
  iceFloor: G([[641]], undefined, 'seafoam_islands'),
  iceRock: G([[642]], [641], 'seafoam_islands'),
  iceRubble: G([[643]], [641], 'seafoam_islands'),
  deepFloor: G([[641]], undefined, 'cerulean_cave'),
  deepRock: G([[642]], [641], 'cerulean_cave'),
  deepRubble: G([[643]], [641], 'cerulean_cave'),
  // ── buildings ──
  towerFloor: { prim: 'building', sec: 'pokemon_tower', grid: [[642]] },
  grave: { prim: 'building', sec: 'pokemon_tower', grid: [[657]], bg: [642, 643, 644] },
  graveGold: { prim: 'building', sec: 'pokemon_tower', grid: [[649]], bg: [642, 643, 644] },
  plantFloor: { prim: 'building', sec: 'power_plant', grid: [[641]] },
  pokemonCenter: G([[72, 73, 74, 75], [88, 89, 90, 91], [96, 97, 98, 99]], GRASS_BG),
  // ── object sprites ──
  cutTree: { sprite: 'misc/cut_tree', w: 16, h: 16 },
  boulder: { sprite: 'misc/strength_boulder', w: 16, h: 16 },
  smashRock: { sprite: 'misc/rock_smash_rock', w: 16, h: 16 },
  itemBall: { sprite: 'misc/item_ball', w: 16, h: 16 },
  nurse: { sprite: 'people/nurse', w: 16, h: 32 },
} satisfies Record<string, EnvArt>;

export type EnvName = keyof typeof ENV;
