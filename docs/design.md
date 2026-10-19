# Theater of War — Design Doc

Oct 19, 2026 · @Jeff Davis

## Vision

Theater of War (working title) is a browser-based war simulation where you can fight any war in history, or any hypothetical matchup, from any rung of the chain of command, and switch rungs mid-game.

- **Any war, any era.** Historical scenarios and hypothetical matchups across eras, built from one data-driven unit and technology model.
- **Every level of command.** Head of state or diplomat, theater general, battle commander, platoon leader, and eventually a single soldier in first person. Switch levels on demand in the same game.
- **Depth on a dial.** Play a war move by move over 100 hours, or simulate it in a 10-minute session. Anything you skip is resolved by the simulation.
- **The whole war machine.** Supply chains are visible and attackable all the way back to raw materials, factories, and transport. Alliances are networks you can strain or break.
- **AI everywhere.** Every actor you aren't playing is run by an AI with tunable competence that pursues its own side's interests, not yours.
- **Realistic frictions, toggleable.** Legal, political, and doctrinal limits apply by era and society. Escalation options such as nuclear or countervalue strikes exist in the model but stay locked under realistic rules wherever that society would not use them.
- **Modern and future warfare.** AI as a weapon system, and space assets that can be attacked.

## Scope of v0: Desert Storm vertical slice

v0 is one war, the 1991 Gulf War (Desert Shield buildup through the ground offensive), playable at three command levels that share one simulation. Its job is to prove that switching levels is fun and that the architecture holds up before we add breadth.

**In scope**

- **Three command levels.** Strategic (coalition politics, Scud/Israel crisis, economy and supply), theater (moving divisions and air wings on a map of Kuwait, Iraq, and Saudi Arabia), and tactical (one battle, with units at company/battalion level).
- **Seamless switching.** Zoom from the theater map into any engagement and back. AI takes over whatever the player isn't controlling.
- **Sides.** Iraq versus the core coalition: US, UK, France, Saudi Arabia, Egypt. Other coalition members contribute abstracted troops or money.
- **Supply network.** Ports, airfields, depots, roads, and pipelines as an attackable graph. Cutting a node visibly starves units downstream.
- **Time control.** Pause, play at several speeds, and "auto-resolve until next decision."
- **Both sides playable**, with simple AI for the other.

**Out of scope for v0** (planned later)

- Other wars and eras, and the any-army-vs-any-army generator.
- First-person mode.
- Nuclear, chemical, and space systems beyond the satellite and GPS advantages already present in 1991.
- Multiplayer, polished art, sound, save-sharing.

## Architecture

One deterministic simulation runs headless in a Web Worker. The three command levels are views onto it, so switching levels changes what you see and control, not which game is running.

```
+------------------------------------------------------------------+
| Browser client (main thread)                                     |
|  [Strategic view]  [Theater view]  [Tactical view]  [UI panels]  |
|  diplomacy,        map, PixiJS     one battle       React:       |
|  economy                           up close         orders, menus|
+------------------------------------------------------------------+
          | orders (intents)              ^ state snapshots
          v                               |
+------------------------------------------------------------------+
| Simulation (Web Worker, pure TypeScript, deterministic)          |
|  [Tick loop]          [Command tree]       [Supply graph]        |
|  fixed timestep,      aggregate or         flow, capacity,       |
|  seeded RNG           expand               disruption            |
|  [Combat]             [Actor AI]           [Rules engine]        |
|  aggregate +          strategic, theater,  diplomacy,            |
|  detailed             tactical             escalation locks      |
+------------------------------------------------------------------+
          ^ loads                         ^ drives
          |                               |
  [Content data]                  [Headless runner and tests]
  units, nations, scenarios       auto-resolve,
  (JSON + Zod)                    determinism checks
```

Views send orders down as intents and receive state snapshots back; the simulation never touches the screen. Content is data, so new wars and armies are added as files, not code.

- **Determinism.** The same seed and the same orders always produce the same war. This enables saves, replays, debugging, and tests.
- **Level of detail.** Formations are simulated as aggregates until something needs detail, then expanded. The command hierarchy doubles as the performance strategy.
- **Data-driven content.** "Any army vs any army" later means adding JSON entries, not rewriting systems.

## Tech stack and project setup

The game is a TypeScript web app: a pure simulation package plus browser views, built with Vite and run locally with `npm run dev`.

| Piece | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict mode) | Types catch errors across a large simulation; Claude Code works well with it |
| Build / dev server | Vite | Fast reload, minimal config |
| 2D rendering | PixiJS (WebGL) | Thousands of map sprites and lines at 60fps |
| UI panels | React | Menus, orders panels, diplomacy screens beside the map |
| Later 3D tactical / first-person | three.js | Added only when we reach that milestone |
| Tests | Vitest | Fast unit and determinism tests for the sim |
| Sim threading | Web Worker | Keeps simulation off the rendering thread |
| Content data | JSON validated with Zod | Units, weapons, nations, scenarios as data |

**Prerequisites:** Node.js 20 or later, Git, and Claude Code installed. A GitHub repo is optional but recommended.

**Folder structure**

```
theater-of-war/
  CLAUDE.md                 # standing instructions for Claude Code
  docs/design.md            # this doc, exported as Markdown
  packages/
    sim/                    # pure TypeScript, no DOM, no rendering
      src/core/             # world state, tick loop, seeded RNG, events
      src/command/          # hierarchy, orders, delegation to AI
      src/supply/           # supply graph and flow
      src/combat/           # aggregate and detailed resolution
      src/ai/               # actor AIs by command level
      test/
    content/                # JSON data + Zod schemas
      units/ weapons/ nations/ scenarios/desert-storm/
    client/                 # Vite app
      src/views/strategic/ src/views/theater/ src/views/tactical/
      src/ui/               # React panels
      src/worker/           # runs the sim in a Web Worker
  tools/                    # headless runner, scenario validator, replay viewer
```

The rule that matters most: `packages/sim` never imports from `client`. The simulation must run headless in a test or a Node script.

## Core simulation model

The world is a tree of formations sitting on a map and fed by a supply graph, advanced in fixed ticks by a deterministic engine.

**Formations and the command tree.** Every military force is a node in one hierarchy: nation → theater → army/corps → division → brigade → battalion → company. Each node has strength, equipment, readiness, morale, supply level, position, and current orders. A node is either *aggregated* (simulated as a single block of stats) or *expanded* (its children simulated individually). Nodes expand when the player zooms in or a battle needs detail, and collapse back afterward with their state preserved.

**Orders and delegation.** Orders flow down the tree as intents ("take Objective Collins by H+48"), not micro-commands. Whoever controls a node, the player or an AI, translates the intent into orders for its children. That is what makes level-switching work: the player takes over any node, and AI keeps running everything else.

**Supply graph.** A directed graph of sources (ports, oil fields, factories, foreign suppliers), transport links (sea lanes, roads, rail, pipelines, air bridges), depots, and consuming formations. Each link has capacity and vulnerability. Every tick, supply flows along the graph. Units below thresholds lose readiness, mobility, then combat power. Disrupting a node propagates downstream automatically.

**Combat resolution.** Two resolvers, one interface. Aggregate combat uses Lanchester-style attrition with modifiers for terrain, air superiority, technology, supply, and morale. Detailed combat resolves individual units for the tactical view. Both write the same results back to the tree, so an expanded battle and an auto-resolved one stay consistent.

**Actors and AI.** Actors are nations and commanders, each with interests, constraints, and a competence setting. Strategic AI weighs goals such as regime survival or coalition cohesion. Theater AI allocates forces and targets supply. Tactical AI runs engagements. Start with utility scoring; add planning later.

**Diplomacy and constraints.** A strategic-layer rules engine: coalition cohesion, public opinion, legality of actions by era and society, and escalation locks. Realistic mode enforces them; sandbox mode lifts them.

**Time.** The sim advances in fixed ticks of game time (start with 15 minutes). Speed settings change how many ticks run per real second. "Auto-resolve" runs ticks headless as fast as possible until the next player decision point.

## Performance targets

The simulation, not the graphics, sets the limits. These are v0 starting targets on a mid-range laptop, to be revised after the first profiling pass.

| Target | v0 goal |
| --- | --- |
| Rendering frame rate | 60fps on the theater map |
| Sim tick cost (normal play) | Under 8 ms per tick, in the worker |
| Auto-resolve speed | Full 43-day campaign in under 60 seconds headless |
| Simultaneously expanded units | About 2,000 in a tactical battle |
| Aggregated formations | About 500 across the theater |
| Level switch (zoom in or out) | Under 200 ms |
| Determinism | Same seed and orders produce identical state hashes |
| Memory | Under 1 GB in the browser |

**Techniques to plan for from the start:** a fixed timestep separate from rendering; level-of-detail aggregation; seeded random numbers only (never `Math.random`); AI and pathfinding time-sliced with a per-tick budget; data kept in flat arrays where profiling shows hot spots.

## Milestones

Build in six milestones, starting with a simulation that has no graphics at all. Each one ends with something you can run or play, and moves on only when its test passes.

1. **M1 · Headless core (start here).** Tick loop, seeded RNG, formation tree, supply graph; no graphics.
   - Done when: a test scenario runs 43 game days headless, and determinism and supply tests pass.
2. **M2 · Theater map.** PixiJS map of Kuwait, Iraq, and Saudi Arabia; units and supply lines drawn; move orders.
   - Done when: you can move divisions, cut a supply link, and watch units downstream weaken.
3. **M3 · Desert Storm scenario and theater AI.** Historical orders of battle as data; aggregate combat; AI runs the side you don't play.
   - Done when: auto-resolve plays out the full campaign with plausible results.
4. **M4 · Strategic layer.** Coalition cohesion, Scud and Israel crisis, public opinion, rules engine with escalation locks.
   - Done when: strategic choices measurably change how the theater war unfolds.
5. **M5 · Tactical layer and level switching.** Expand any battle into detailed units; zoom in and out mid-game.
   - Done when: switching takes under 200 ms and results match auto-resolve within tolerance.
6. **M6 · Depth dial and polish.** Time controls, auto-resolve to next decision, saves and replays, AI competence settings.
   - Done when: one campaign is playable in 10 minutes or across many hours.

*Later:* more wars and eras, any-army matchups, modern AI and space systems, first-person mode.

M1 looks unexciting, but it locks in determinism and the formation/supply model that everything else depends on.

## Working with Claude Code

Work one milestone at a time: plan it, build it with tests, play it, then commit before starting the next.

**Getting started**

1. Create an empty folder `theater-of-war`, run `git init`, and start Claude Code in it.
2. Export this doc as Markdown and save it as `docs/design.md`.
3. Paste the kickoff prompt below.
4. Ask Claude Code to plan before coding (plan mode), review the plan, then let it build.
5. When M1 passes its acceptance criteria, commit and move to the next milestone.

**Kickoff prompt**

```
Read docs/design.md. We are building milestone M1 only.
Set up the monorepo exactly as in the folder structure section:
TypeScript strict, Vite, Vitest, packages/sim, packages/content, packages/client.
Implement the core tick loop, seeded RNG, the formation tree with
aggregate/expand, and a minimal supply graph, with no rendering.
Add a headless runner in tools/ that loads a tiny test scenario and prints
a state summary per game day. Write Vitest tests for determinism
(same seed => same state hash) and supply propagation.
Propose a plan first; do not start M2.
```

**CLAUDE.md** (create at the repo root so Claude Code follows it every session)

```markdown
# Theater of War
Design: docs/design.md. Read the relevant section before any change.

## Rules
- packages/sim is pure TypeScript: no DOM, no rendering, no client imports.
- Deterministic sim: use the seeded RNG only, never Math.random or Date.now.
- Units, weapons, nations, scenarios are JSON data in packages/content, validated by Zod.
- Every sim feature ships with Vitest tests; run `npm test` before finishing.
- Stay inside the current milestone; list ideas for later instead of building them.
- Weapons and effects stay abstract game stats; no real-world technical detail.

## Commands
- npm run dev: start the client
- npm test: run tests
- npm run sim -- <scenario>: headless run
```

**Habits that help**

- Keep each request to one milestone or one feature. Large asks produce tangled code.
- After each feature, play it yourself and describe what felt wrong. Your reactions are the main input.
- Ask Claude Code to explain any design choice you don't follow. You're learning game dev as you go.
- Commit often, so a bad change is one `git` command away from being undone.

## Content guardrails and open questions

**Guardrails**

- Weapons, including nuclear, AI, and space systems, are abstract game stats (range, effect, cost, escalation consequence), never real technical or targeting detail.
- Historical leaders can appear in historical scenarios. Living heads of state are represented by role ("US President"), not scripted as personalities.
- All names, art, and assets are original. No material from Empire Earth or other commercial games.
- Real orders of battle and equipment come from public historical sources, cited in the content files.

**Open questions**

- [x] Which side do you play first in Desert Storm: coalition or Iraq? **Coalition first.**
- [x] Map source: real terrain and elevation data (e.g. public elevation datasets) or a hand-simplified map for v0? **Real terrain and elevation data.**
- [x] Tactical view: top-down 2D for v0, or invest early in 3D with three.js? **Top-down 2D for v0, per the tech stack; 3D with three.js is a goal for later.**
- [x] How much historical fidelity in orders of battle: division level only, or brigade level? **Division level first, brigade level later.**
- [ ] Desktop only, or should the strategic layer also work on a phone? *Undecided; desktop first for now.*
