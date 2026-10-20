// Builds the Gulf theater map from open data (sources and attribution in SOURCES):
//   - Natural Earth 1:10m vectors (borders, coastline, lakes, rivers, cities)
//   - Elevation from the AWS Terrain Tiles (terrarium encoding; SRTM and others)
// Outputs to packages/content/maps/gulf/:
//   terrain.json  10 km terrain-class grid the sim moves on (+ map frame)
//   geo.json      simplified vector features in map km, for drawing
//   relief.png    2 km shaded-relief image, for drawing
// Raw downloads are cached in tools/geo/.cache (gitignored).
//
// Usage: npm run build:map

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { latLonToXY, xyToLatLon, type MapFrame } from '@tow/content/projection';

const ROOT = join(import.meta.dirname, '..', '..');
const CACHE = join(import.meta.dirname, '.cache');
const OUT = join(ROOT, 'packages', 'content', 'maps', 'gulf');

const BBOX = { west: 38, east: 51, south: 24, north: 37.5 };
const LAT_REF = (BBOX.south + BBOX.north) / 2;
const frame: MapFrame = {
  ...BBOX,
  kmPerDegLon: Math.round(111.32 * Math.cos((LAT_REF * Math.PI) / 180) * 1000) / 1000,
  kmPerDegLat: 110.574,
};
const WIDTH_KM = Math.round((BBOX.east - BBOX.west) * frame.kmPerDegLon * 10) / 10;
const HEIGHT_KM = Math.round((BBOX.north - BBOX.south) * frame.kmPerDegLat * 10) / 10;
const RELIEF_KM = 2;
const CELL_KM = 10;
const SUB = CELL_KM / RELIEF_KM;
const TILE_ZOOM = 7;
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

const SOURCES = [
  'Natural Earth 1:10m cultural and physical vectors (public domain), naturalearthdata.com',
  'Elevation: AWS Terrain Tiles (terrarium), derived from SRTM, GMTED2010, ETOPO1 and others; see github.com/tilezen/joerd/blob/master/docs/attribution.md',
];

// Terrain classes. Speed and defense are abstract game factors in permille.
const CLASSES = [
  { code: '.', name: 'open', speed: 1000, defense: 1000 },
  { code: '^', name: 'rough', speed: 600, defense: 1300 },
  { code: 'M', name: 'mountain', speed: 250, defense: 1700 },
  { code: 'u', name: 'urban', speed: 700, defense: 1500 },
  { code: '~', name: 'water', speed: 0, defense: 1000 },
];

// Countries tracked cell by cell: [Natural Earth ADM0_A3, cell code, region id].
const REGIONS: [string, string, string][] = [
  ['IRQ', 'i', 'iraq'],
  ['KWT', 'k', 'kuwait'],
  ['SAU', 's', 'saudi-arabia'],
];

// ---------------------------------------------------------------- downloads

async function cached(name: string, url: string): Promise<Buffer> {
  const path = join(CACHE, name);
  if (existsSync(path)) return readFileSync(path);
  process.stdout.write(`  fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  return buf;
}

type Ring = number[][];
interface Feature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

async function naturalEarth(layer: string): Promise<Feature[]> {
  const buf = await cached(`${layer}.geojson`, `${NE}/${layer}.geojson`);
  return (JSON.parse(buf.toString('utf8')) as { features: Feature[] }).features;
}

function lines(f: Feature): Ring[] {
  const g = f.geometry;
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates as Ring];
  if (g.type === 'MultiLineString') return g.coordinates as Ring[];
  return [];
}

function polygons(f: Feature): Ring[][] {
  const g = f.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates as Ring[]];
  if (g.type === 'MultiPolygon') return g.coordinates as Ring[][];
  return [];
}

// ---------------------------------------------------------------- elevation

const WORLD_PX = 256 * 2 ** TILE_ZOOM;
const mercX = (lon: number) => ((lon + 180) / 360) * WORLD_PX;
const mercY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD_PX;
};

async function loadElevation(): Promise<(lat: number, lon: number) => number> {
  const tx0 = Math.floor(mercX(BBOX.west) / 256);
  const tx1 = Math.floor(mercX(BBOX.east) / 256);
  const ty0 = Math.floor(mercY(BBOX.north) / 256);
  const ty1 = Math.floor(mercY(BBOX.south) / 256);
  const tiles = new Map<string, Float32Array>();
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const png = PNG.sync.read(await cached(`terrarium/${TILE_ZOOM}/${tx}/${ty}.png`, `${TILES}/${TILE_ZOOM}/${tx}/${ty}.png`));
      const elev = new Float32Array(256 * 256);
      for (let i = 0; i < 256 * 256; i++) {
        elev[i] = png.data[i * 4]! * 256 + png.data[i * 4 + 1]! + png.data[i * 4 + 2]! / 256 - 32768;
      }
      tiles.set(`${tx}/${ty}`, elev);
    }
  }
  const px = (gx: number, gy: number) => {
    const tile = tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
    return tile ? tile[(gy % 256) * 256 + (gx % 256)]! : 0;
  };
  // Bilinear sample in global mercator pixels.
  return (lat, lon) => {
    const x = mercX(lon) - 0.5;
    const y = mercY(lat) - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    return (
      px(x0, y0) * (1 - fx) * (1 - fy) + px(x0 + 1, y0) * fx * (1 - fy) + px(x0, y0 + 1) * (1 - fx) * fy + px(x0 + 1, y0 + 1) * fx * fy
    );
  };
}

// ---------------------------------------------------------------- rasterizing

/** Even-odd scanline fill of polygons (rings in grid coordinates) into `mask`. */
function fillPolygons(mask: Uint8Array, cols: number, rows: number, polys: Ring[][], value: number): void {
  for (const rings of polys) {
    const edges: [number, number, number, number][] = [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i] as [number, number];
        const [x1, y1] = ring[i + 1] as [number, number];
        edges.push([x0, y0, x1, y1]);
        minY = Math.min(minY, y0, y1);
        maxY = Math.max(maxY, y0, y1);
      }
    }
    const r0 = Math.max(0, Math.floor(minY));
    const r1 = Math.min(rows - 1, Math.ceil(maxY));
    for (let r = r0; r <= r1; r++) {
      const yc = r + 0.5;
      const xs: number[] = [];
      for (const [x0, y0, x1, y1] of edges) {
        if (y0 <= yc !== y1 <= yc) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k]! - 0.5));
        const c1 = Math.min(cols - 1, Math.floor(xs[k + 1]! - 0.5));
        for (let c = c0; c <= c1; c++) mask[r * cols + c] = value;
      }
    }
  }
}

const inBox = (lon: number, lat: number, m = 1) =>
  lon >= BBOX.west - m && lon <= BBOX.east + m && lat >= BBOX.south - m && lat <= BBOX.north + m;
const touchesBox = (rings: Ring[]) => rings.some((r) => r.some(([lon, lat]) => inBox(lon!, lat!)));

// ---------------------------------------------------------------- vectors

const MARGIN_KM = 40;
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Project, clip to the map (plus margin), and thin a line to points at least `minKm` apart. */
function projectLine(ring: Ring, minKm = 0.75): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let lastX = NaN;
  let lastY = NaN;
  const flush = () => {
    if (cur.length >= 4) out.push(cur);
    cur = [];
  };
  ring.forEach(([lon, lat], i) => {
    const { x, y } = latLonToXY(frame, lat!, lon!);
    const inside = x >= -MARGIN_KM && x <= WIDTH_KM + MARGIN_KM && y >= -MARGIN_KM && y <= HEIGHT_KM + MARGIN_KM;
    if (!inside) {
      flush();
      return;
    }
    const last = i === ring.length - 1;
    if (cur.length === 0 || last || Math.abs(x - lastX) + Math.abs(y - lastY) >= minKm) {
      cur.push(round1(x), round1(y));
      lastX = x;
      lastY = y;
    }
  });
  flush();
  return out;
}

// ---------------------------------------------------------------- main

async function main() {
  console.log(`Gulf map: ${WIDTH_KM} x ${HEIGHT_KM} km`);
  const [countries, borders, coast, lakes, rivers, places] = await Promise.all([
    naturalEarth('ne_10m_admin_0_countries'),
    naturalEarth('ne_10m_admin_0_boundary_lines_land'),
    naturalEarth('ne_10m_coastline'),
    naturalEarth('ne_10m_lakes'),
    naturalEarth('ne_10m_rivers_lake_centerlines'),
    naturalEarth('ne_10m_populated_places_simple'),
  ]);
  const elevationAt = await loadElevation();

  // Relief grid at 2 km.
  const rc = Math.ceil(WIDTH_KM / RELIEF_KM);
  const rr = Math.ceil(HEIGHT_KM / RELIEF_KM);
  const elev = new Float32Array(rc * rr);
  for (let r = 0; r < rr; r++) {
    for (let c = 0; c < rc; c++) {
      const { lat, lon } = xyToLatLon(frame, (c + 0.5) * RELIEF_KM, (r + 0.5) * RELIEF_KM);
      elev[r * rc + c] = elevationAt(lat, lon);
    }
  }

  // Land/water mask from country polygons, with lakes cut out.
  const toGrid = (rings: Ring[]): Ring[] =>
    rings.map((ring) =>
      ring.map(([lon, lat]) => {
        const { x, y } = latLonToXY(frame, lat!, lon!);
        return [x / RELIEF_KM, y / RELIEF_KM];
      }),
    );
  const land = new Uint8Array(rc * rr);
  const landPolys = countries.flatMap(polygons).filter(touchesBox).map(toGrid);
  fillPolygons(land, rc, rr, landPolys, 1);
  const lakePolys = lakes.flatMap(polygons).filter(touchesBox);
  fillPolygons(land, rc, rr, lakePolys.map(toGrid), 0);

  // Cities.
  const cities = places
    .map((p) => p.properties)
    .filter((p) => inBox(p['longitude'] as number, p['latitude'] as number, 0))
    .filter((p) => (p['pop_max'] as number) >= 150_000 || p['adm0cap'] === 1)
    .map((p) => {
      const { x, y } = latLonToXY(frame, p['latitude'] as number, p['longitude'] as number);
      return { name: p['name'] as string, x: round1(x), y: round1(y), pop: p['pop_max'] as number, capital: p['adm0cap'] === 1 };
    })
    .sort((a, b) => b.pop - a.pop);

  // Terrain classes at 10 km.
  const cols = Math.ceil(WIDTH_KM / CELL_KM);
  const rows = Math.ceil(HEIGHT_KM / CELL_KM);
  const cells: string[] = [];
  const counts: Record<string, number> = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let wet = 0;
      let n = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let dr = 0; dr < SUB; dr++) {
        for (let dc = 0; dc < SUB; dc++) {
          const rr2 = r * SUB + dr;
          const cc2 = c * SUB + dc;
          if (rr2 >= rr || cc2 >= rc) continue;
          const i = rr2 * rc + cc2;
          n++;
          if (!land[i]) wet++;
          else {
            lo = Math.min(lo, elev[i]!);
            hi = Math.max(hi, elev[i]!);
          }
        }
      }
      const relief = hi - lo;
      const code = n === 0 || wet * 2 > n ? '~' : relief > 700 ? 'M' : relief > 250 ? '^' : '.';
      cells.push(code);
    }
  }
  for (const city of cities.filter((c) => c.pop >= 750_000)) {
    const i = Math.floor(city.y / CELL_KM) * cols + Math.floor(city.x / CELL_KM);
    if (cells[i] !== undefined && cells[i] !== '~') cells[i] = 'u';
  }
  for (const code of cells) counts[code] = (counts[code] ?? 0) + 1;
  console.log(`  terrain ${cols}x${rows}:`, counts);

  // Country of each terrain cell, for rules such as mandates and who will cross which border.
  const toCells = (rings: Ring[]): Ring[] =>
    rings.map((ring) =>
      ring.map(([lon, lat]) => {
        const { x, y } = latLonToXY(frame, lat!, lon!);
        return [x / CELL_KM, y / CELL_KM];
      }),
    );
  const regionMask = new Uint8Array(cols * rows);
  REGIONS.forEach(([a3], i) => {
    const polys = countries.filter((f) => f.properties['ADM0_A3'] === a3).flatMap(polygons).map(toCells);
    fillPolygons(regionMask, cols, rows, polys, i + 1);
  });
  const regionCells = [...regionMask].map((v, i) => (cells[i] === '~' || v === 0 ? '.' : REGIONS[v - 1]![1])).join('');

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'terrain.json'),
    JSON.stringify({
      id: 'gulf',
      name: 'Kuwait, Iraq and Saudi Arabia',
      sources: SOURCES,
      frame,
      widthKm: WIDTH_KM,
      heightKm: HEIGHT_KM,
      terrain: { cellKm: CELL_KM, cols, rows, classes: CLASSES, cells: cells.join('') },
      regions: { names: Object.fromEntries(REGIONS.map(([, code, name]) => [code, name])), cells: regionCells },
    }) + '\n',
  );

  const geo = {
    sources: SOURCES,
    widthKm: WIDTH_KM,
    heightKm: HEIGHT_KM,
    borders: borders.flatMap(lines).flatMap((l) => projectLine(l)),
    coast: coast.flatMap(lines).flatMap((l) => projectLine(l)),
    lakes: lakePolys.flatMap((p) => p.slice(0, 1)).flatMap((l) => projectLine(l, 0.5)),
    rivers: rivers
      .filter((f) => (f.properties['scalerank'] as number) <= 7 && f.properties['featurecla'] !== 'Lake Centerline')
      .flatMap((f) => lines(f).flatMap((l) => projectLine(l).map((line) => ({ name: (f.properties['name'] as string) ?? '', line }))))
      .filter((r) => r.line.length >= 6),
    cities,
  };
  writeFileSync(join(OUT, 'geo.json'), JSON.stringify(geo) + '\n');
  console.log(
    `  geo: ${geo.borders.length} border lines, ${geo.coast.length} coast lines, ${geo.lakes.length} lakes, ${geo.rivers.length} rivers, ${geo.cities.length} cities`,
  );

  writeFileSync(join(OUT, 'relief.png'), renderRelief(elev, land, rc, rr));
  console.log(`  relief ${rc}x${rr} px`);
}

// ---------------------------------------------------------------- relief image

const RAMP: [number, [number, number, number]][] = [
  [-100, [196, 182, 150]],
  [0, [205, 190, 152]],
  [300, [196, 174, 130]],
  [700, [176, 150, 112]],
  [1200, [150, 128, 100]],
  [2000, [128, 116, 102]],
  [3000, [190, 186, 180]],
];

function ramp(h: number): [number, number, number] {
  for (let i = 1; i < RAMP.length; i++) {
    const [h1, c1] = RAMP[i]!;
    const [h0, c0] = RAMP[i - 1]!;
    if (h <= h1) {
      const t = Math.max(0, (h - h0) / (h1 - h0));
      return [0, 1, 2].map((k) => c0[k]! + (c1[k]! - c0[k]!) * t) as [number, number, number];
    }
  }
  return RAMP[RAMP.length - 1]![1];
}

function renderRelief(elev: Float32Array, land: Uint8Array, cols: number, rows: number): Buffer {
  const png = new PNG({ width: cols, height: rows });
  const at = (c: number, r: number) => elev[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))]!;
  const cell = RELIEF_KM * 1000;
  const z = 4; // vertical exaggeration so desert relief reads at theater scale
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const o = i * 4;
      if (!land[i]) {
        png.data[o] = 38;
        png.data[o + 1] = 62;
        png.data[o + 2] = 84;
        png.data[o + 3] = 255;
        continue;
      }
      const dzdx = ((at(c + 1, r) - at(c - 1, r)) * z) / (2 * cell);
      const dzdy = ((at(c, r + 1) - at(c, r - 1)) * z) / (2 * cell);
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade = Math.max(0, Math.cos(Math.PI / 2 - alt) * Math.cos(slope) + Math.sin(Math.PI / 2 - alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect));
      const [cr, cg, cb] = ramp(elev[i]!);
      const k = 0.45 + 0.75 * shade;
      png.data[o] = Math.min(255, cr * k);
      png.data[o + 1] = Math.min(255, cg * k);
      png.data[o + 2] = Math.min(255, cb * k);
      png.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

await main();
