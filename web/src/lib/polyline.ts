// Google encoded-polyline decoder (the format Strava's map.summary_polyline
// uses). Pure and dependency-free so it stays unit-testable and works in both
// the client bundle and server routes. Precision 5 (Strava default).

export type LatLng = [number, number];

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    for (const axis of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        if (index >= encoded.length) return points; // truncated input — bail
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

/**
 * Project decoded lat/lng points into an SVG path string that fits a
 * width×height box (with padding), preserving aspect ratio. Uses a simple
 * equirectangular projection with cos(latitude) x-scaling — plenty for a
 * run-sized route thumbnail.
 */
export function polylineToPath(
  points: LatLng[],
  width: number,
  height: number,
  padding = 12
): { path: string; start: [number, number]; end: [number, number] } | null {
  if (points.length < 2) return null;

  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const midLat = (minLat + maxLat) / 2;
  const xScaleFactor = Math.cos((midLat * Math.PI) / 180);

  const spanX = (maxLng - minLng) * xScaleFactor || 1e-9;
  const spanY = maxLat - minLat || 1e-9;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const scale = Math.min(innerW / spanX, innerH / spanY);

  // Center the route in the box.
  const offsetX = (innerW - spanX * scale) / 2 + padding;
  const offsetY = (innerH - spanY * scale) / 2 + padding;

  const toXY = ([plat, plng]: LatLng): [number, number] => [
    offsetX + (plng - minLng) * xScaleFactor * scale,
    offsetY + (maxLat - plat) * scale, // flip: north is up
  ];

  const coords = points.map(toXY);
  const path = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  return { path, start: coords[0], end: coords[coords.length - 1] };
}
