// Downloads sprites, cries, battle fx and music into public/assets (gitignored).
// These are Nintendo / Game Freak assets mirrored by PokeAPI and Pokémon Showdown:
// fine for a personal prototype, not for redistribution.
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FX_EXTRA, ITEMS, MOVES, MUSIC, SPECIES } from '../src/data.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const POKEAPI = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
const SHOWDOWN = 'https://play.pokemonshowdown.com';

const jobs: [url: string, path: string][] = [];
for (const s of SPECIES) {
  jobs.push([`${POKEAPI}/pokemon/${s.dex}.png`, `sprites/front/${s.dex}.png`]);
  jobs.push([`${POKEAPI}/pokemon/back/${s.dex}.png`, `sprites/back/${s.dex}.png`]);
  jobs.push([`${POKEAPI}/pokemon/shiny/${s.dex}.png`, `sprites/front/shiny/${s.dex}.png`]);
  jobs.push([`${POKEAPI}/pokemon/back/shiny/${s.dex}.png`, `sprites/back/shiny/${s.dex}.png`]);
  jobs.push([`${SHOWDOWN}/audio/cries/${s.id}.mp3`, `cries/${s.id}.mp3`]);
}
for (const fx of new Set([...Object.values(MOVES).map((m) => m.fx), ...FX_EXTRA])) jobs.push([`${SHOWDOWN}/fx/${fx}.png`, `fx/${fx}.png`]);
for (const item of ITEMS) jobs.push([`${POKEAPI}/items/${item}.png`, `items/${item}.png`]);
for (const track of [MUSIC.boss, ...MUSIC.areas]) jobs.push([`${SHOWDOWN}/audio/${track}.mp3`, `music/${track}.mp3`]);

let fetched = 0, skipped = 0;
const failed: string[] = [];

async function run([url, rel]: [string, string]) {
  const dest = join(OUT, rel);
  try {
    await access(dest);
    skipped++;
    return;
  } catch {}
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    fetched++;
  } catch (e) {
    failed.push(`${rel} (${url}): ${(e as Error).message}`);
  }
}

const queue = [...jobs];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) await run(queue.shift()!);
}));

console.log(`assets: ${fetched} downloaded, ${skipped} cached, ${failed.length} failed`);
for (const f of failed) console.warn(`  ✗ ${f}`);
