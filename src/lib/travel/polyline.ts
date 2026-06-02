/**
 * Decode a Google "encoded polyline" string into an ordered list of points.
 *
 * Google Directions returns each route's geometry as an encoded polyline
 * (overview_polyline.points). This is the standard decode algorithm
 * (https://developers.google.com/maps/documentation/utilities/polylinealgorithm),
 * returning coordinates so callers can draw the real road/rail route.
 *
 * Returns [lng, lat] pairs (GeoJSON order) to match MapLibre's expectations.
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  if (!encoded) return [];
  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;

  while (index < len) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lng * 1e-5, lat * 1e-5]);
  }
  return points;
}
