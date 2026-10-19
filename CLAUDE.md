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