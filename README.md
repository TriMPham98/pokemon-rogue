# Pokémon Rogue (prototype)

A 3D roguelike in the browser: pick a starter, survive endless rounds of wild Pokémon,
weaken them and throw Poké Balls to build a party of up to six that fights for you.

```sh
npm install
npm run dev
```

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move the trainer |
| Mouse | Aim |
| Click / Space | Throw a Poké Ball |
| F | Toggle party between attacking and holding fire (to set up catches) |

## How it plays

- Your party auto-battles wild Pokémon near you. Type matchups apply (fire > grass, water > fire, …).
- Wild Pokémon under ~35% HP get a pulsing yellow ring. Catch chance rises as HP drops.
- Clearing a round gives +2 Poké Balls, a 25% heal, and a choice of 1 of 3 rewards.
- Every 5th round an Alpha shows up (big, tough, hard to catch).
- The run ends if the trainer's HP hits 0 or your whole party faints.

## Code map

- `src/data.ts` – species, types, type chart, procedural "look" specs
- `src/models.ts` – primitive-built 3D models (Pokémon, trainer, Poké Ball, arena)
- `src/entities.ts` – `Mon`, `Trainer`, HP bars, name labels
- `src/game.ts` – game loop, AI, combat, catching, rounds, rewards
- `src/ui.ts` / `src/style.css` – HUD, party panel, modals
