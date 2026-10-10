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
- Red's overworld sprite sheet from [pret/pokefirered](https://github.com/pret/pokefirered)
- Black/White animated sprites, cries, battle music and battle-effect sprites from [Pokémon Showdown](https://play.pokemonshowdown.com)

These are Nintendo / Game Freak / Creatures assets. They're gitignored and fetched locally so the repo
doesn't redistribute them — fine for a personal prototype, not for a public release. Sound effects
(throws, hits, catch jingle, level-up) are synthesized at runtime in `src/audio.ts`.

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

- All 151 Kanto Pokémon. Stats are derived from their real base stats, dual types and the full type chart apply,
  and each is sized by its Pokédex height (square-root compressed so Diglett and Onix are both playable).
- Your party auto-battles nearby wild Pokémon with each species' signature move. Each move has its own wind-up
  animation (lunges, leaps and ground-pounds, charging glows, psychic levitation) before the effect lands.
  Ditto copies its target's move; Mew's Metronome picks a random one each time.
- Wild Pokémon under 35% HP get a pulsing yellow ring. Catch chance rises as HP drops.
- Pokémon evolve with the classic white-silhouette sequence (they're invulnerable while it plays):
  - by level — Charmander → Charmeleon at 16, … (trade evolutions like Kadabra → Alakazam are level-based here)
  - by stone — Fire, Water, Thunder, Leaf and Moon Stones, as in the originals. Stones show up as round rewards only when someone can use one,
    and Alpha rounds always offer one. Eevee lets you choose Vaporeon, Jolteon or Flareon.
  - party cards show a purple level badge or stone icon for how each Pokémon evolves next
- Clearing a round gives +2 Poké Balls, a 25% heal, and 1 of 3 item rewards.
- Every 5th round an Alpha shows up (big, tough, hard to catch, its own music). Alphas telegraph a ground
  slam with a filling red circle — dash out.
- Every 5 rounds you move to the next area of Kanto, in story order: Route 1 → Viridian Forest → Mt. Moon →
  Cerulean Cape → Route 11 → Rock Tunnel → Pokémon Tower → Cycling Road → Safari Zone → Seafoam Islands →
  Power Plant → Cinnabar Volcano → Victory Road → Cerulean Cave (then it loops). Each has its own look, music and
  encounter table based on where Pokémon live in Red/Blue/FireRed. Evolved forms show up in an area's later rounds,
  and each area has its own Alphas, including the legendary birds and Mewtwo (Mew hides in Cerulean Cave).
- 1 in 64 wild Pokémon are shiny (sparkles, chime, blue off-screen arrow). Shininess survives catching and evolving.
- Progress persists between runs in localStorage: best round, Pokédex, shinies. Catching Pikachu or Eevee,
  or reaching round 15, unlocks extra starters.
- The run ends if the trainer's HP hits 0 or your whole party faints.

## Code map

- `src/data.ts` – species, moves (and how each is drawn), evolutions, type chart
- `src/assets.ts` – asset paths, sprite loading/cropping, animated GIF → sprite-sheet decoding
- `src/audio.ts` – cries, music, synthesized SFX
- `src/fx.ts` – billboard move/impact effects
- `src/entities.ts` – `Mon` (animated sprite billboard, attack wind-ups), `Trainer` (overworld sprite), HP bars
- `src/models.ts` – shared geometry
- `src/biomes.ts` – areas, their encounter tables and Alphas, and their arenas
- `src/progress.ts` – saved meta-progression and starter unlocks
- `src/game.ts` – game loop, AI, combat, catching, rounds, rewards, hints
- `src/ui.ts` / `src/style.css` – HUD, party panel, modals, off-screen arrows
- `scripts/fetch-assets.ts` – asset downloader
