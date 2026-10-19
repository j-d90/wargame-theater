/**
 * Split an integer `total` across slots in proportion to `weights`, using the
 * largest-remainder method so the parts are integers that sum to `total`.
 * Ties go to the lower index, so the result is fully deterministic.
 *
 * With `caps`, no slot receives more than its cap; overflow is re-split across
 * slots that still have room. If every slot fills up, the sum falls short of
 * `total` and the caller decides what to do with the rest.
 */
export function distribute(total: number, weights: readonly number[], caps?: readonly number[]): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error(`distribute: bad total ${total}`);
  const result = weights.map(() => 0);
  let open = weights.map((_, i) => i).filter((i) => caps === undefined || (caps[i] ?? 0) > 0);
  let remaining = total;

  while (remaining > 0 && open.length > 0) {
    let W = 0;
    for (const i of open) W += weights[i] ?? 0;
    const w = (i: number) => (W > 0 ? (weights[i] ?? 0) : 1);
    if (W === 0) W = open.length;

    const shares = new Map<number, number>();
    const fracs: { i: number; r: number }[] = [];
    let given = 0;
    for (const i of open) {
      const num = remaining * w(i);
      const q = Math.floor(num / W);
      shares.set(i, q);
      fracs.push({ i, r: num - q * W });
      given += q;
    }
    fracs.sort((a, b) => b.r - a.r || a.i - b.i);
    for (let k = 0; k < remaining - given; k++) {
      const slot = fracs[k % fracs.length]!.i;
      shares.set(slot, shares.get(slot)! + 1);
    }

    let overflow = 0;
    const stillOpen: number[] = [];
    for (const i of open) {
      const share = shares.get(i)!;
      const room = caps === undefined ? Infinity : caps[i]! - result[i]!;
      const give = Math.min(share, room);
      result[i]! += give;
      overflow += share - give;
      if (caps === undefined || result[i]! < caps[i]!) stillOpen.push(i);
    }
    remaining = overflow;
    open = stillOpen;
  }
  return result;
}
