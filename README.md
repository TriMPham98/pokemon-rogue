# Pokémon Rogue (prototype)

A semi-3D roguelike in the browser: pick a starter, survive endless rounds of wild Pokémon,
weaken them and throw Poké Balls to build a party of up to six that all battle at once.

```sh
npm install
npm run dev      # fetches game assets into public/assets on first run
```

## Assets

`npm run assets` (run automatically before `dev`/`build`) downloads into `public/assets/`:

- Static Pokémon sprites and item icons from [PokeAPI/sprites](https://github.com/PokeAPI/sprites)
- From [pret/pokefirered](https://github.com/pret/pokefirered): Red's overworld sprite, FireRed/LeafGreen's music
  (MIDI sequences, voicegroups and instrument samples), and the environment art — ground tiles, tall grass, trees,
  fences, signs, rocks, graves and the Pokémon Center are rendered from the game's own tilesets and object sprites
  (`scripts/gba-tiles.ts`, picked in `src/env.ts`) into `public/assets/env/`; the move effects (flames, bubbles,
  bolts, slashes, explosions…) are FireRed's battle-animation sprite sheets, decoded with their palettes into
  `public/assets/battle/` (listed in `ANIMS` in `src/data.ts`)
- Black/White animated sprites, cries and battle-effect sprites from [Pokémon Showdown](https://play.pokemonshowdown.com)
- Capture rates, base experience and growth rates come from [PokeAPI's data](https://github.com/PokeAPI/pokeapi) (baked into `src/data.ts`)

These are Nintendo / Game Freak / Creatures assets. They're gitignored and fetched locally so the repo
doesn't redistribute them — fine for a personal prototype, not for a public release. The music is played by a
small m4a-style synth (`src/music.ts`): pulse/wave/noise channels plus the game's own samples, with the songs' ADSR
envelopes and loop points. Sound effects (throws, hits, level-up) are synthesized at runtime in `src/audio.ts`.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move the trainer |
| Mouse | Aim (hovering a wild Pokémon locks on) |
| Click / Space | Throw a Poké Ball |
| 1-6 (hold, aim, release) | Unleash that Pokémon's special at the cursor once it's charged |
| Click a party card | Recall a Pokémon to its ball, or send it back out |
| Right-click / F | Toggle between attacking and holding fire (to set up catches) |
| E | Focus your Pokémon on the wild Pokémon under the cursor (again to clear) |
| Shift | Dash (1.4s cooldown) |
| Esc / P | Pause |
| M | Mute |

## How it plays

- All 151 Kanto Pokémon with the main-series battle maths (`src/battle.ts`):
  - real stats from base stats, IVs (0-31, kept when you catch) and level; levels go to 100 on each species' growth curve
  - the real damage formula with physical/special moves at their real power, STAB, the full type chart, critical hits
    (higher for Slash, Karate Chop, Razor Leaf, Crabhammer…), and dual types
  - move effects: poison, burn (halves physical damage) and paralysis (slower, sometimes can't move) with type
    immunities; Fire Spin / Clamp bind, drain moves heal, Take Down / Submission recoil, Dragon Rage and Night Shade
    do fixed damage, String Shot slows
  - Gen 5 scaled experience shared like an Exp. All, real capture rates and the Gen 3/4 capture formula
    (lower HP, status, Great/Ultra Balls all help)
  - each Pokémon is sized by its Pokédex height (square-root compressed so Diglett and Onix are both playable)
- Wild levels follow the journey: Lv2-4 on Route 1 up to the 70s in Cerulean Cave, where Mewtwo is Lv70 like in
  FireRed. Balance knobs for the horde format (wild attacks ease in over the first three areas, wild Pokémon act less
  often than your team, encounters come one at a time early on) live at the top of `src/battle.ts`.
- Your whole party is out at once, each auto-battling with its species' signature move and fanning out around you
  between fights. A fresh catch pops straight out of its ball and joins in. Recall one with 1-6 to keep it safe (it
  still earns Exp. Share); the last one standing can't be recalled. Whoever lands the knockout gets full experience,
  everyone else half.
- Specials (`src/specials.ts`): each Pokémon charges a big move of its first type by dealing and taking damage. Hold
  its number to see where it lands, release to fire: Fire Blast, Surf (shoves everything away), Sleep Powder (sleeping
  Pokémon can't act and are 2× easier to catch; Grass types are immune), Thunder (chains through five foes), Blizzard
  (freezes in place), Focus Punch / Fly (leap in), Poison Gas (a lingering cloud), Earthquake, Psychic (lifts and
  holds), Spider Web, Rock Slide (flinch), Night Shade, Outrage (rampage) and Hyper Beam (pierces a line, then
  recharge).
- Hordes grow with the round and with your party size, and arrive in packs that share a patch of grass. Area moves
  (Earthquake, Surf, Fire Blast, Blizzard, Thunder, Psychic, Rock Slide, Sludge Bomb, Hyper Beam…) hit everything
  near the target for 75% damage, like spread moves in doubles. The knobs are at the top of `src/battle.ts`.
- Wild Voltorb, Electrode, Geodude, Graveler, Golem, Koffing and Weezing light a fuse when badly hurt: a red ring
  flashes, and 1.6s later they explode, hitting your Pokémon and theirs. Knock them out, catch them or get clear.
- Wild Pokémon appear in the tall grass (or cave hollows) and loiter there until you or your Pokémon come close —
  then a "!" pops up and they (and their neighbours) go after the nearest of your Pokémon. Your Pokémon only goes after ones that are fighting
  you, so you can walk up to a quiet one and throw a ball.
- Each move has its own wind-up
  animation (lunges, leaps and ground-pounds, charging glows, psychic levitation) before the effect lands.
  Ditto copies its target's move; Mew's Metronome picks a random one each time.
- Wild Pokémon under 35% HP get a pulsing yellow ring. Hovering a wild Pokémon shows its level, types, status, HP,
  your live catch chance and whether your team hits it super effectively. The pause screen shows your team's stats.
- Pokémon evolve with FireRed's full-screen sequence (the white silhouette swapping with its new form, faster and
  faster, to the evolution theme and fanfare). One that's ready in battle waits for the round to end, and each
  evolution plays out in full before the reward screen or Pokémon Center:
  - by level — Charmander → Charmeleon at 16, … (trade evolutions like Kadabra → Alakazam are level-based here)
  - by stone — Fire, Water, Thunder, Leaf and Moon Stones, as in the originals. Stones show up as round rewards only when someone can use one,
    and an area's last round always offers one. Eevee lets you choose Vaporeon, Jolteon or Flareon.
  - party cards show a purple level badge or stone icon for how each Pokémon evolves next
- Clearing a round plays the victory theme and gives +2 Poké Balls, a 35% heal, status cured, and 1 of 3 item
  rewards (Great/Ultra Ball upgrades, Full Heal, Rare Candy, …).
- After an area's last round you stop at a Pokémon Center: the healing jingle plays, the whole party (fainted ones
  too) are fully restored and the whole team heads into the next area.
- An area's 5th round ends with a strong wild Pokémon (★, orange arrow, the FRLG wild-battle theme): an evolved form
  of one of the area's basic Pokémon a few levels up — Pidgeotto on Route 1, Butterfree in Viridian Forest.
- Every 5 rounds you move to the next area of Kanto, in story order: Route 1 → Viridian Forest → Mt. Moon →
  Cerulean Cape → Route 11 → Rock Tunnel → Pokémon Tower → Cycling Road → Safari Zone → Seafoam Islands →
  Power Plant → Cinnabar Volcano → Victory Road → Cerulean Cave (then it loops). Each has its own look, ambient
  particles and lighting, the music its FireRed map plays, and an encounter table based on where Pokémon live in
  Red/Blue/FireRed. Evolved forms show up in an area's later rounds. The legendary birds and Mewtwo are rare
  encounters on the last round of their FireRed haunts (with the legendary battle themes); Mew hides in Cerulean Cave.
- 1 in 64 wild Pokémon are shiny (sparkles, chime, blue off-screen arrow). Shininess survives catching and evolving.
- Progress persists between runs in localStorage: best round, Pokédex, shinies.
- Only Pokémon battle: wild ones go after your Pokémon, never the trainer. The run ends when your
  whole party faints.
- The game opens on a title screen (FireRed's title theme, the area slowly circling behind it) with your best round,
  Pokédex, shinies and run count from earlier runs.

## Code map

- `src/data.ts` – species, moves (power, category, effects, and how each is drawn), evolutions, type chart, growth curves
- `src/battle.ts` – stat, damage, capture and experience formulas, and the balance knobs
- `src/assets.ts` – asset paths, sprite loading/cropping, animated GIF → sprite-sheet decoding
- `src/audio.ts` – cries, music buses and jingles, synthesized SFX
- `src/music.ts` – FireRed MIDI player (m4a-style voices, envelopes, loop markers)
- `src/fx.ts` – billboard move/impact effects (animated FireRed sheets, Showdown sprites) and ground rings
- `src/specials.ts` – each type's charged special
- `src/entities.ts` – `Mon` (animated sprite billboard, attack wind-ups), `Trainer` (overworld sprite), HP bars
- `src/models.ts` – shared geometry
- `src/biomes.ts` – areas, their encounter tables, and their arenas (ground, decor, wind, particles, waves)
- `src/progress.ts` – saved meta-progression
- `src/game.ts` – game loop, AI, combat, catching, rounds, rewards, hints
- `src/ui.ts` / `src/style.css` – HUD, party panel, target card, team sheet, modals, off-screen arrows
- `scripts/fetch-assets.ts` – asset downloader
