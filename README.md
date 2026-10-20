# Theater of War

A browser-based war simulation where you can command at any level, from head of state down to a battle commander, and switch levels mid-game. The first target is a 1991 Gulf War vertical slice.

The full design is in [docs/design.md](docs/design.md). Standing rules for contributors (human or Claude Code) are in [CLAUDE.md](CLAUDE.md).

## Status

- **M1 (headless core): complete.** A deterministic tick loop, a seeded RNG, a formation tree that can collapse and expand, and a supply graph.
- **M2 (theater map): complete.** A 2D map of Kuwait, Iraq and Saudi Arabia built from real terrain data. You can give divisions move orders (they pathfind around water and slow down in rough terrain), cut supply links and depots, and watch units downstream run out of supply.
- **M3 (Desert Storm and theater AI): complete.** The 1991 campaign from 17 January to 28 February with division-level orders of battle for both sides, aggregate combat, abstract air power, objectives, and a theater AI for each side. Auto-resolve plays out the full campaign with plausible results; `npm run calibrate` checks this across 20 seeds.

- **M4 (strategic layer): complete.** Governments shown by role, each with gauges for public support, coalition commitment, Israeli patience or regime stability. The Scud campaign against Israel and Saudi Arabia, answered with launcher hunting, Patriots and diplomatic pressure. The UN mandate and the legal limits of who will cross which border. Strategic bombing, oil fires, a cease-fire, and a rules engine whose escalation locks hold in realistic mode and lift in sandbox mode. `npm run experiments` shows strategic choices changing the theater war.

- **M5 (tactical layer and level switching): complete.** Any battle can be fought battalion by battalion: divisions break down into their brigades and battalions (from cited, simplified compositions), deploy facing the enemy, and fight with the same formula as aggregate combat, so a detailed battle and an auto-resolved one agree (`npm run tactical-check`). Zoom in on a battle and back out mid-game; the switch takes well under 200 ms.

The next milestone is M6: the depth dial and polish (time controls, auto-resolve to the next decision, saves and replays, AI competence settings).

## Getting started

Requires Node.js 20 or later.

```sh
npm install
npm test               # run all tests
npm run typecheck      # type-check every package
npm run sim -- desert-storm   # auto-resolve the campaign headless, both sides by AI
npm run calibrate             # run 20 seeds and check the results are plausible
npm run experiments           # compare strategic choices across 20 seeds
npm run tactical-check        # detailed battles vs auto-resolve on standard engagements
npm run calibrate -- --detailed   # the campaign with every battle fought in detail
npm run dev                   # start the client at http://localhost:5173
```

The client opens the `desert-storm` scenario with you commanding the Coalition and the AI running Iraq. Add `?scenario=gulf-sandbox` or `?scenario=tiny` to the URL for the test scenarios, or `?side=iraq` to command Iraq.

### Playing

- **Strategic and Theater:** switch command levels with the tabs in the top bar. The strategic view shows each government's gauges, the missile campaign, your strategic options (locked ones say why), the rules mode, and the event log. The clock pauses when a cease-fire is declared.
- **Desert Storm:** you command the Coalition's divisions and its air effort (the sliders in the side panel). Tick **AI commands the Coalition** to hand over and watch the campaign auto-resolve. Enemy units, engagements (orange bursts) and objectives (diamonds in the holder's colour) are all on the map. Fog of war comes later.

- **Tactical:** to zoom in on a fight, double-click it on the map, or select a unit in contact and press **Fight battle in detail** (or `B`). Its divisions break down into battalions. Your battalions follow their division's orders (from you or the AI) until you give them one of your own: click a battalion or `Shift`-drag to select several, then **Move** (`M`), **Attack** (`A`) or **Hold** (`H`); **Back to division orders** (`U`) hands them back. Thin lines show who is firing on whom; rings show the selected battalions' ranges. `Esc` steps back out to the theater, where the battle keeps being fought in detail (an orange ring) until the two sides break contact or you press **Resolve in aggregate**.
- Click a unit, depot or supply line to inspect it. Drag to pan; scroll or pinch to zoom.
- **Move:** select a unit, press **Move** (or `M`), then click a destination. `H` halts the unit.
- **Expand / Collapse:** split a division into its brigades, or merge them back.
- **Cut link / Disrupt:** select a supply line or depot and cut it. Units downstream use up the supply they carry, then lose readiness, morale and speed.
- A unit more than 150 km from its depot gets no supply. It's drawn with a red marker and a dashed red line back to its depot.
- Time: `Space` pauses. `1`, `2` and `3` run at 1 game hour, 6 game hours, or 1 game day per second.

The headless runner prints a state summary at the end of each game day:

```sh
npm run sim -- tiny --days 10 --seed 42
npm run sim -- path/to/scenario.json
```

## Layout

```
packages/
  sim/       Pure TypeScript simulation: no DOM, no rendering, deterministic
    src/core/      tick loop, seeded RNG, world state, state hashing, commands
    src/command/   formation tree, aggregate/expand, movement and pathfinding
    src/supply/    supply flow and consumption
    src/combat/    aggregate and detailed (battalion-level) combat, abstract air power, objectives
    src/strategy/  strategic layer: actors, missiles, mandate, cease-fire, actions and locks
    src/ai/        theater, tactical and strategic AI
  content/   JSON game data (units, nations, scenarios, maps) and Zod schemas
    maps/gulf/     terrain grid, map vectors and shaded relief (generated)
    tactical/      battalion types and division compositions for detailed battles
  client/    Vite + React + PixiJS browser app
    src/worker/    runs the sim in a Web Worker
    src/views/theater/   PixiJS theater map
    src/views/tactical/  PixiJS tactical map of one battle
    src/ui/        React panels
tools/       Headless scenario runner
  calibrate.ts  Desert Storm plausibility check across seeds
  experiments.ts  M4 experiments: strategic choices vs theater outcomes
  tactical-check.ts  M5 check: detailed battles vs auto-resolve
  geo/       Map builder (npm run build:map)
docs/        Design document
```

`sim` never imports from `client`, and it imports only types from `content`. Purity tests enforce this, along with the seeded-RNG-only rule.

## Key ideas

- **Determinism.** The same seed and the same orders always produce the same state hash. World state is plain JSON, so snapshots and saves are just copies.
- **Level of detail.** A formation is either *aggregated*, simulated as one block, or *expanded*, with its children simulated individually. Expanding pushes any changes back down to the children, so state is preserved.
- **Supply.** Supply flows from sources through depots along links that have limited capacity. Cutting a node or link starves everything downstream: readiness falls first, then morale, mobility and combat power.
- **Content is data.** New units, nations and scenarios are JSON files validated by Zod, not code.
- **Combat and AI.** Opposing formations in contact fight Lanchester-style: losses scale with the enemy's combat power, quality and air support, reduced by terrain and fortification. Broken units fall back, then surrender. Each side's AI works at corps level and turns intents ("take this objective") into division orders, as the design describes.
- **Two resolvers, one answer.** A battle fought in detail uses the same fire formula as aggregate combat, per battalion and only against enemies within range, with morale shared across each division. When everyone is in range the two give the same result; geometry (range, concentration, standoff) is the only difference. Generated battalions split their division's stats exactly, so collapsing them back gives the division they came from.
- **Strategy shapes the war.** The strategic layer is part of the same deterministic simulation. Missile hits wear down a neutral's patience, partners who lose faith take their divisions (and, for a host nation, its air bases) home, and home support decides how long a war can last. In realistic mode the rules engine enforces escalation locks and legal limits; sandbox mode lifts them, but their consequences still apply.
- **Views never touch the world.** The sim runs in a Web Worker. The UI sends orders as commands and draws the snapshots that come back.

## Map data

`npm run build:map` regenerates `packages/content/maps/gulf/` from open data: [Natural Earth](https://www.naturalearthdata.com/) 1:10m vectors (public domain), and elevation from the [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), which combine SRTM and other datasets and require [attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). The generated files are committed. Raw downloads are cached in `tools/geo/.cache/`, which is gitignored.
