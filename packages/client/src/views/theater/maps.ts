// Drawing assets for each content map. Scenarios without a map get a blank field.
import gulfGeo from '@tow/content/maps/gulf/geo.json';
import gulfRelief from '@tow/content/maps/gulf/relief.png?url';
import type { GeoData, MapAssets } from './TheaterView.ts';

const MAPS: Record<string, MapAssets> = {
  gulf: { geo: gulfGeo as GeoData, reliefUrl: gulfRelief, reliefKmPerPx: 2 },
};

export function mapAssets(mapId: string | null): MapAssets {
  return (mapId && MAPS[mapId]) || { geo: null, reliefUrl: null, reliefKmPerPx: 1 };
}
