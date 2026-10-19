# Theater of War

A browser-based war simulation where you can command at any level, from head of state down to a battle commander, and switch levels mid-game. The first target is a 1991 Gulf War vertical slice.

The full design is in [docs/design.md](docs/design.md). Standing rules for contributors (human or Claude Code) are in [CLAUDE.md](CLAUDE.md).

## Status

**Milestone M1 (headless core) is complete.** It has a deterministic tick loop, a seeded RNG, a formation tree that can collapse and expand, and a supply graph, all with no graphics. The next milestone is M2: a 2D theater map.

## Getting started

Requires Node.js 20 or later.

```sh
npm install
npm test               # run all tests
npm run typecheck      # type-check every package
npm run sim -- tiny    # run the tiny test scenario headless
npm run dev            # start the client (a placeholder page until M2)
```

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
    src/command/   formation tree, aggregate/expand, derived stats
    src/supply/    supply flow and consumption
    src/combat/    (later milestones)
    src/ai/        (later milestones)
  content/   JSON game data (units, nations, scenarios) and Zod schemas
  client/    Vite browser app (views arrive in M2)
tools/       Headless scenario runner
docs/        Design document
```

`sim` never imports from `client`, and it imports only types from `content`. Purity tests enforce this, along with the seeded-RNG-only rule.

## Key ideas

- **Determinism.** The same seed and the same orders always produce the same state hash. World state is plain JSON, so snapshots and saves are just copies.
- **Level of detail.** A formation is either *aggregated*, simulated as one block, or *expanded*, with its children simulated individually. Expanding pushes any changes back down to the children, so state is preserved.
- **Supply.** Supply flows from sources through depots along links that have limited capacity. Cutting a node or link starves everything downstream: readiness falls first, then morale, mobility and combat power.
- **Content is data.** New units, nations and scenarios are JSON files validated by Zod, not code.
