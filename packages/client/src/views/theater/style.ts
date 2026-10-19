// Visual constants for the theater map. Sizes are screen pixels.

export const COUNTER_W = 30;
export const COUNTER_H = 20;
export const NODE_SIZE = 12;

export const COLORS = {
  background: 0x14171b,
  friendly: 0x3f7fc4,
  friendlyLine: 0xdfe9f5,
  selected: 0xffffff,
  coast: 0x16232e,
  border: 0x5b4636,
  river: 0x3c6e94,
  city: 0x2a2a2a,
  link: 0x3ddc84,
  linkIdle: 0x8fa89a,
  linkCasing: 0x14231b,
  linkCut: 0xe0483e,
  node: 0xe8d9a8,
  nodeEdge: 0x1d1d1d,
  path: 0xffffff,
  tether: 0x7fd1a8,
  tetherBroken: 0xe0483e,
  good: 0x4caf50,
  warn: 0xf2b134,
  bad: 0xe0483e,
};

/** Green above 70%, amber above 35%, red below. Input is permille. */
export function statusColor(permille: number): number {
  return permille >= 700 ? COLORS.good : permille >= 350 ? COLORS.warn : COLORS.bad;
}

export const ECHELON_MARK: Record<string, string> = {
  company: 'I',
  battalion: 'II',
  brigade: 'X',
  division: 'XX',
  corps: 'XXX',
  army: 'XXXX',
  theater: 'XXXXX',
  nation: '',
};
