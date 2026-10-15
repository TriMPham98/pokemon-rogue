// Downloads sprites, cries, battle fx and music into public/assets (gitignored).
// These are Nintendo / Game Freak assets mirrored by PokeAPI, Pokémon Showdown and the pret/pokefirered decomp:
// fine for a personal prototype, not for redistribution.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMS, FX_ALL, ITEMS, MUSIC, SE, SPECIES, TRAINER_SHEET } from '../src/data.ts';
import { ENV, type TileArt } from '../src/env.ts';
import { addTrunk, decodeIndexedPng, encodePng, makeTileset, parsePal, renderCutout, renderGrid, spriteFrame } from './gba-tiles.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const POKEAPI = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
const SHOWDOWN = 'https://play.pokemonshowdown.com';
const PRET = 'https://raw.githubusercontent.com/pret/pokefirered/master';
const FIRERED = `${PRET}/graphics`;

const jobs: [url: string, path: string][] = [];
for (const s of SPECIES) {
  jobs.push([`${POKEAPI}/pokemon/${s.dex}.png`, `sprites/front/${s.dex}.png`]);
  jobs.push([`${POKEAPI}/pokemon/back/${s.dex}.png`, `sprites/back/${s.dex}.png`]);
  jobs.push([`${POKEAPI}/pokemon/shiny/${s.dex}.png`, `sprites/front/shiny/${s.dex}.png`]);
  jobs.push([`${POKEAPI}/pokemon/back/shiny/${s.dex}.png`, `sprites/back/shiny/${s.dex}.png`]);
  // Black/White animated sprites, decoded into sprite sheets at runtime. From Showdown rather than PokeAPI, whose
  // copies mix in regional forms (its Rattata back sprite is Alolan Rattata).
  for (const [dir, path] of [['', 'front/'], ['-shiny', 'front/shiny/'], ['-back', 'back/'], ['-back-shiny', 'back/shiny/']]) {
    jobs.push([`${SHOWDOWN}/sprites/gen5ani${dir}/${s.id}.gif`, `sprites/anim/${path}${s.dex}.gif`]);
  }
  jobs.push([`${SHOWDOWN}/audio/cries/${s.id}.mp3`, `cries/${s.id}.mp3`]);
}
for (const fx of FX_ALL) jobs.push([`${SHOWDOWN}/fx/${fx}.png`, `fx/${fx}.png`]);
jobs.push([`${FIRERED}/object_events/pics/people/${TRAINER_SHEET}.png`, `trainer/${TRAINER_SHEET}.png`]);
for (const item of ITEMS) jobs.push([`${POKEAPI}/items/${item}.png`, `items/${item}.png`]);

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


// ───────────── FireRed music ─────────────
// Each song is the game's MIDI plus a JSON of the instruments its voicegroup uses (squares, wave channel, noise and
// sampled instruments), so src/music.ts can play it close to how the GBA's m4a engine does.

const SONGS = [...new Set([...Object.values(MUSIC).flat(), ...Object.values(SE)])];
const SRC_FILES = ['sound/voice_groups.inc', 'sound/keysplit_tables.inc', 'sound/direct_sound_data.inc', 'sound/programmable_wave_data.inc', 'sound/songs/midi/midi.cfg'];

/** Downloads the music sources, writes music/<song>.json, and returns the sample downloads still needed. */
async function buildMusic(): Promise<[string, string][]> {
  await runAll([
    ...SRC_FILES.map((f): [string, string] => [`${PRET}/${f}`, `music/src/${f.split('/').pop()}`]),
    ...SONGS.map((s): [string, string] => [`${PRET}/sound/songs/midi/${s}.mid`, `music/${s}.mid`]),
  ]);
  let src: Record<string, string>;
  try {
    src = Object.fromEntries(await Promise.all(SRC_FILES.map(async (f) => {
      const name = f.split('/').pop()!;
      return [name, await readFile(join(OUT, 'music/src', name), 'utf8')] as const;
    })));
  } catch {
    return []; // sources failed to download; already reported
  }

  // Every voice in voice_groups.inc, in order: keysplit_all groups index past their own label into the next ones.
  const voices: string[][] = [];
  const groupAt: Record<string, number> = {};
  for (const line of src['voice_groups.inc'].split('\n')) {
    const label = /^(\w+)::/.exec(line);
    if (label) groupAt[label[1]] = voices.length;
    const v = /^\s*(voice_\w+)\s+(.*)$/.exec(line);
    if (v) voices.push([v[1], ...v[2].split(',').map((x) => x.trim())]);
  }
  const keysplits: Record<string, number[]> = {};
  let cur: number[] | null = null, base = 0;
  for (const line of src['keysplit_tables.inc'].split('\n')) {
    const t = /^\.set (\w+), \. - (\d+)/.exec(line);
    if (t) (keysplits[t[1]] = cur = []), (base = Number(t[2]));
    const b = /^\s*\.byte (\d+)/.exec(line);
    if (b && cur) cur[base + cur.filter(() => true).length] = Number(b[1]);
  }
  const fileOf = (inc: string, label: string) => new RegExp(`${label}::\\s*\\.incbin "([^"]+)"`).exec(inc)?.[1];

  const samples = new Set<string>(), waves = new Set<string>();
  type Voice = Record<string, unknown>;
  const voice = (i: number): Voice | null => {
    const v = voices[i];
    if (!v) return null;
    const [type, ...a] = v;
    const n = (k: number) => Number(a[k]);
    if (type.startsWith('voice_directsound')) {
      const file = fileOf(src['direct_sound_data.inc'], a[2])?.replace(/\.bin$/, '.wav');
      if (!file) return null;
      const name = file.split('/').pop()!.replace('.wav', '');
      samples.add(file);
      return { t: 'ds', key: n(0), pan: n(1), s: name, fixed: type.endsWith('no_resample') || undefined, rev: type.endsWith('reverse') || undefined, env: [n(3), n(4), n(5), n(6)] };
    }
    if (type.startsWith('voice_square_1')) return { t: 'sq', key: n(0), pan: n(1), duty: n(3), env: [n(4), n(5), n(6), n(7)] };
    if (type.startsWith('voice_square_2')) return { t: 'sq', key: n(0), pan: n(1), duty: n(2), env: [n(3), n(4), n(5), n(6)] };
    if (type.startsWith('voice_programmable_wave')) {
      const file = fileOf(src['programmable_wave_data.inc'], a[2]);
      if (!file) return null;
      waves.add(file);
      return { t: 'wave', key: n(0), pan: n(1), w: file.split('/').pop()!.replace('.pcm', ''), env: [n(3), n(4), n(5), n(6)] };
    }
    if (type.startsWith('voice_noise')) return { t: 'noise', key: n(0), pan: n(1), period: n(2), env: [n(3), n(4), n(5), n(6)] };
    return null;
  };

  const cfg = src['midi.cfg'];
  for (const song of SONGS) {
    const m = new RegExp(`^${song}\\.mid:.*-G(\\w+).*?(?:-V(\\d+))?\\s*$`, 'm').exec(cfg);
    const vol = Number(/-V(\d+)/.exec(new RegExp(`^${song}\\.mid:.*$`, 'm').exec(cfg)?.[0] ?? '')?.[1] ?? 127);
    const g = m ? groupAt[`voicegroup${m[1].padStart(3, '0')}`] ?? groupAt[`voicegroup${m[1]}`] : undefined;
    if (g === undefined) {
      failed.push(`music/${song}.json: no voicegroup in midi.cfg`);
      continue;
    }
    // Resolve every program 0-127; keysplits become per-key voice tables.
    const programs: Record<number, unknown> = {};
    for (let p = 0; p < 128; p++) {
      const v = voices[g + p];
      if (!v) continue;
      if (v[0] === 'voice_keysplit_all') {
        const sub = groupAt[v[1]];
        const keys: Record<number, unknown> = {};
        for (let k = 0; k < 128; k++) {
          const sv = voice(sub + k);
          if (sv) keys[k] = { ...sv, drum: true };
        }
        programs[p] = { t: 'split', keys };
      } else if (v[0] === 'voice_keysplit') {
        const sub = groupAt[v[1]], table = keysplits[v[2]] ?? [];
        const keys: Record<number, unknown> = {};
        for (let k = 0; k < 128; k++) {
          const sv = table[k] !== undefined ? voice(sub + table[k]) : null;
          if (sv) keys[k] = sv;
        }
        programs[p] = { t: 'split', keys };
      } else {
        const sv = voice(g + p);
        if (sv) programs[p] = sv;
      }
    }
    await writeFile(join(OUT, `music/${song}.json`), JSON.stringify({ vol, programs }));
  }
  // Wave channel shapes are tiny: inline them as hex.
  const waveData: Record<string, string> = {};
  for (const f of waves) {
    const rel = `music/src/${f.split('/').pop()}`;
    await runAll([[`${PRET}/${f}`, rel]]);
    try {
      waveData[f.split('/').pop()!.replace('.pcm', '')] = (await readFile(join(OUT, rel))).toString('hex');
    } catch {}
  }
  await writeFile(join(OUT, 'music/waves.json'), JSON.stringify(waveData));
  return [...samples].map((f): [string, string] => [`${PRET}/${f}`, `music/samples/${f.split('/').pop()}`]);
}

// ───────────── FireRed environment art ─────────────
// Renders every ENV entry (src/env.ts) from the decomp's tilesets and object sprites into env/<name>.png.

async function buildEnv() {
  const arts = Object.entries(ENV);
  const tileArts = arts.filter((a): a is [string, TileArt] => 'grid' in a[1]);
  const sets = new Set(tileArts.flatMap(([, a]) => [`primary/${a.prim}`, `secondary/${a.sec}`]));
  const files: [string, string][] = [];
  for (const set of sets) {
    for (const f of ['tiles.png', 'metatiles.bin']) files.push([`${PRET}/data/tilesets/${set}/${f}`, `env/src/${set}/${f}`]);
    // FRLG maps take palettes 0-6 from the primary tileset and 7-12 from the secondary.
    for (let i = set.startsWith('primary') ? 0 : 7; i < (set.startsWith('primary') ? 7 : 13); i++) {
      const pal = `palettes/${String(i).padStart(2, '0')}.pal`;
      files.push([`${PRET}/data/tilesets/${set}/${pal}`, `env/src/${set}/${pal}`]);
    }
  }
  for (const [, a] of arts) if ('sprite' in a) files.push([`${PRET}/graphics/object_events/pics/${a.sprite}.png`, `env/src/${a.sprite}.png`]);
  await runAll(files);
  const read = (rel: string) => readFile(join(OUT, rel)).catch(() => null);
  const loadSet = async (set: string) => {
    const pals: string[] = [];
    for (let i = 0; i < 16; i++) pals.push((await read(`env/src/${set}/palettes/${String(i).padStart(2, '0')}.pal`))?.toString() ?? '');
    const tiles = await read(`env/src/${set}/tiles.png`), meta = await read(`env/src/${set}/metatiles.bin`);
    return tiles && meta ? { tiles, meta, pals } : null;
  };
  await mkdir(join(OUT, 'env'), { recursive: true });
  for (const [name, a] of arts) {
    try {
      let img;
      if ('sprite' in a) {
        const src = await read(`env/src/${a.sprite}.png`);
        if (!src) continue;
        img = spriteFrame(src, a.w, a.h);
      } else {
        const p = await loadSet(`primary/${a.prim}`), sec = await loadSet(`secondary/${a.sec}`);
        if (!p || !sec) continue;
        const ts = makeTileset(p, sec);
        img = a.bg ? renderCutout(ts, a.grid, a.bg) : renderGrid(ts, a.grid);
        if (a.trunk) img = addTrunk(ts, img);
        if (a.quad !== undefined) {
          const qx = (a.quad & 1) * 8, qy = (a.quad >> 1) * 8, src = img.px.slice();
          for (let y = 0; y < img.h; y++)
            for (let x = 0; x < img.w; x++) img.px.set(src.subarray(((qy + (y % 8)) * img.w + qx + (x % 8)) * 4, ((qy + (y % 8)) * img.w + qx + (x % 8)) * 4 + 4), (y * img.w + x) * 4);
        }
      }
      await writeFile(join(OUT, `env/${name}.png`), encodePng(img));
    } catch (e) {
      failed.push(`env/${name}.png: ${(e as Error).message}`);
    }
  }
}

// ───────────── FireRed battle animations ─────────────
// The move effects (flames, bubbles, bolts, slashes…) from graphics/battle_anims/sprites, as RGBA sheets in battle/.

async function buildBattleAnims() {
  const SPRITES = `${FIRERED}/battle_anims/sprites`;
  const defs = Object.entries(ANIMS);
  await runAll(defs.flatMap(([, a]): [string, string][] => [
    [`${SPRITES}/${a.file}.png`, `battle/src/${a.file}.png`],
    ...(a.pal ? [[`${SPRITES}/${a.pal}.pal`, `battle/src/${a.pal}.pal`] as [string, string]] : []),
  ]));
  await mkdir(join(OUT, 'battle'), { recursive: true });
  for (const [name, a] of defs) {
    try {
      const { w, h, idx, plte } = decodeIndexedPng(await readFile(join(OUT, `battle/src/${a.file}.png`)));
      const pal = a.pal ? parsePal(await readFile(join(OUT, `battle/src/${a.pal}.pal`), 'utf8')) : plte;
      const img = { w, h, px: new Uint8Array(w * h * 4) };
      for (let i = 0; i < w * h; i++) if (idx[i] && pal[idx[i]]) img.px.set([...pal[idx[i]], 255], i * 4);
      await writeFile(join(OUT, `battle/${name}.png`), encodePng(img));
    } catch (e) {
      failed.push(`battle/${name}.png: ${(e as Error).message}`);
    }
  }
}

async function runAll(list: [string, string][]) {
  const queue = [...list];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) await run(queue.shift()!);
  }));
}
await runAll(jobs);
await runAll(await buildMusic());
await buildEnv();
await buildBattleAnims();

console.log(`assets: ${fetched} downloaded, ${skipped} cached, ${failed.length} failed`);
for (const f of failed) console.warn(`  ✗ ${f}`);
