// Enforces the CLAUDE.md rules for packages/sim: no DOM, no client imports,
// no unseeded randomness or wall-clock time.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/Math\.random/, 'Math.random (use the seeded RNG)'],
  [/Date\.now|new Date\(/, 'wall-clock time'],
  [/performance\.now/, 'wall-clock time'],
  [/Math\.(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|hypot|cbrt)\b/, 'transcendental Math functions (results can differ between JS engines)'],
  [/\bwindow\.|\bdocument\.|\bnavigator\./, 'DOM globals'],
  [/from ['"](node:|fs['"]|path['"])/, 'Node built-ins'],
  [/@tow\/client|packages\/client/, 'client imports'],
  [/^import (?!type )[^;]*from ['"]@tow\/content['"]/m, 'runtime import of @tow/content (use import type)'],
];

describe('sim purity', () => {
  const sources = files(SRC);

  it('finds the sim sources', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  for (const [pattern, what] of FORBIDDEN) {
    it(`does not use ${what}`, () => {
      const offenders = sources.filter((p) => pattern.test(readFileSync(p, 'utf8')));
      expect(offenders).toEqual([]);
    });
  }
});
