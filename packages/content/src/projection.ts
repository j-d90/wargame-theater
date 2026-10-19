// Maps use a simple equirectangular projection in kilometres: x grows east from
// the map's west edge, y grows south from its north edge (screen orientation).
// The km-per-degree factors are stored in the map file, so nothing at runtime
// needs trigonometry and every machine projects identically.

export interface MapFrame {
  west: number;
  east: number;
  south: number;
  north: number;
  kmPerDegLon: number;
  kmPerDegLat: number;
}

export function latLonToXY(frame: MapFrame, lat: number, lon: number): { x: number; y: number } {
  return {
    x: Math.round((lon - frame.west) * frame.kmPerDegLon * 1000) / 1000,
    y: Math.round((frame.north - lat) * frame.kmPerDegLat * 1000) / 1000,
  };
}

export function xyToLatLon(frame: MapFrame, x: number, y: number): { lat: number; lon: number } {
  return { lat: frame.north - y / frame.kmPerDegLat, lon: frame.west + x / frame.kmPerDegLon };
}
