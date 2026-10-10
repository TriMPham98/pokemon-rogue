# Pokémon Rogue (prototype)

A 3D roguelike in the browser: pick a starter, survive endless rounds of wild Pokémon,
weaken them and throw Poké Balls to build a party of up to six that fights for you.

```sh
npm install
npm run dev      # fetches game assets into public/assets on first run
```

## Assets

`npm run assets` (run automatically before `dev`/`build`) downloads into `public/assets/`:

- Static Pokémon sprites and item icons from [PokeAPI/sprites](https://github.com/PokeAPI/sprites)
- Red's overworld sprite sheet and FireRed/LeafGreen's music (MIDI sequences, voicegroups and instrument samples)
  from [pret/pokefirered](https://github.com/pret/pokefirered)
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
| Right-click / E | Focus the whole team on a wild Pokémon (again to clear) |
| Shift | Dash (brief invulnerability, 1.4s cooldown) |
| F | Toggle party between attacking and holding fire (to set up catches) |
| Esc / P | Pause |
| M | Mute |

## How it plays

- All 151 Kanto Pokémon with the main-series battle maths (`src/battle.ts`):
  - real stats from base stats, IVs (0-31, kept when you catch) and level; levels go to 100 on each species' growth curve
  - the real damage formula with physical/special moves at their real power, STAB, the full type chart, critical hits
    (higher for Slash, Karate Chop, Razor Leaf, Crabhammer…), and dual types
  - move effects: poison, burn (halves physical damage) and paralysis (slower, sometimes can't move) with type
    immunities; Fire Spin / Clamp bind, drain moves heal, Take Down / Submission recoil, Dragon Rage and Night Shade
    do fixed damage, String Shot slows (even the trainer)
  - Gen 5 scaled experience shared like an Exp. All, real capture rates and the Gen 3/4 capture formula
    (lower HP, status, Great/Ultra Balls all help)
  - each Pokémon is sized by its Pokédex height (square-root compressed so Diglett and Onix are both playable)
- Wild levels follow the journey: Lv2-4 on Route 1 up to the 70s in Cerulean Cave, where Mewtwo is Lv70 like in
  FireRed. Balance knobs for the horde format (wild attacks ease in over the first three areas, wild Pokémon act less
  often than your team, encounters come one at a time early on) live at the top of `src/battle.ts`.
- Your party auto-battles nearby wild Pokémon with each species' signature move. Each move has its own wind-up
  animation (lunges, leaps and ground-pounds, charging glows, psychic levitation) before the effect lands.
  Ditto copies its target's move; Mew's Metronome picks a random one each time.
- Wild Pokémon under 35% HP get a pulsing yellow ring. Hovering a wild Pokémon shows its level, types, status, HP,
  your live catch chance and whether your team hits it super effectively. The pause screen shows your team's stats.
- Pokémon evolve with the classic white-silhouette sequence (they're invulnerable while it plays):
  - by level — Charmander → Charmeleon at 16, … (trade evolutions like Kadabra → Alakazam are level-based here)
  - by stone — Fire, Water, Thunder, Leaf and Moon Stones, as in the originals. Stones show up as round rewards only when someone can use one,
    and an area's last round always offers one. Eevee lets you choose Vaporeon, Jolteon or Flareon.
  - party cards show a purple level badge or stone icon for how each Pokémon evolves next
- Clearing a round plays the victory fanfare and gives +2 Poké Balls, a 35% heal, status cured, and 1 of 3 item
  rewards (Great/Ultra Ball upgrades, Full Heal, Rare Candy, …).
- An area's 5th round ends with a strong wild Pokémon (★, orange arrow, the FRLG wild-battle theme): an evolved form
  of one of the area's basic Pokémon a few levels up — Pidgeotto on Route 1, Butterfree in Viridian Forest.
- Every 5 rounds you move to the next area of Kanto, in story order: Route 1 → Viridian Forest → Mt. Moon →
  Cerulean Cape → Route 11 → Rock Tunnel → Pokémon Tower → Cycling Road → Safari Zone → Seafoam Islands →
  Power Plant → Cinnabar Volcano → Victory Road → Cerulean Cave (then it loops). Each has its own look, ambient
  particles and lighting, the music its FireRed map plays, and an encounter table based on where Pokémon live in
  Red/Blue/FireRed. Evolved forms show up in an area's later rounds. The legendary birds and Mewtwo are rare
  encounters on the last round of their FireRed haunts (with the legendary battle themes); Mew hides in Cerulean Cave.
- 1 in 64 wild Pokémon are shiny (sparkles, chime, blue off-screen arrow). Shininess survives catching and evolving.
- Progress persists between runs in localStorage: best round, Pokédex, shinies. Catching Pikachu or Eevee,
  or reaching round 15, unlocks extra starters.
- The run ends if the trainer's HP hits 0 or your whole party faints.

## Code map

- `src/data.ts` – species, moves (power, category, effects, and how each is drawn), evolutions, type chart, growth curves
- `src/battle.ts` – stat, damage, capture and experience formulas, and the balance knobs
- `src/assets.ts` – asset paths, sprite loading/cropping, animated GIF → sprite-sheet decoding
- `src/audio.ts` – cries, music buses and jingles, synthesized SFX
- `src/music.ts` – FireRed MIDI player (m4a-style voices, envelopes, loop markers)
- `src/fx.ts` – billboard move/impact effects
- `src/entities.ts` – `Mon` (animated sprite billboard, attack wind-ups), `Trainer` (overworld sprite), HP bars
- `src/models.ts` – shared geometry
- `src/biomes.ts` – areas, their encounter tables, and their arenas (ground, decor, wind, particles, waves)
- `src/progress.ts` – saved meta-progression and starter unlocks
- `src/game.ts` – game loop, AI, combat, catching, rounds, rewards, hints
- `src/ui.ts` / `src/style.css` – HUD, party panel, target card, team sheet, modals, off-screen arrows
- `scripts/fetch-assets.ts` – asset downloader
