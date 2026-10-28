import {
  distanceKm,
  type Coordinates,
  type MapVenueResponse,
  type VenueSummary,
} from "./map-events";
export type ViewRegion = Coordinates & {
  latitudeDelta: number;
  longitudeDelta: number;
};
export type ViewBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};
export type ViewVenue = VenueSummary & { activityKeys: string[] };
export type ViewPage = Omit<MapVenueResponse, "venues"> & {
  venues: ViewVenue[];
  nextCursor: string | null;
};
// Native maps may report the same camera repeatedly, with tiny rounding changes.
// Ignore sub-pixel changes, including after marker/layout updates.
export function sameMapRegion(a: ViewRegion, b: ViewRegion) {
  const near = (x: number, y: number, span: number) =>
    Math.abs(x - y) <= Math.max(0.0000001, Math.abs(span) * 0.001);
  const longitudeDistance = Math.abs(longitude(a.longitude - b.longitude));
  return (
    near(a.latitude, b.latitude, b.latitudeDelta) &&
    longitudeDistance <= Math.max(0.0000001, b.longitudeDelta * 0.001) &&
    near(a.latitudeDelta, b.latitudeDelta, b.latitudeDelta) &&
    near(a.longitudeDelta, b.longitudeDelta, b.longitudeDelta)
  );
}
// Reuse the fetched edge buffer for small pans. Larger pans or zoom changes
// still search automatically; no venue count or fixed-radius limit is applied.
export function canReuseMapArea(fetched: ViewRegion, next: ViewRegion) {
  const scale = next.latitudeDelta / fetched.latitudeDelta;
  const horizontalScale = next.longitudeDelta / fetched.longitudeDelta;
  if (
    scale < 0.8 ||
    scale > 1.05 ||
    horizontalScale < 0.8 ||
    horizontalScale > 1.05
  )
    return false;
  const outer = boundsForRegion(fetched, 0.08);
  const inner = boundsForRegion(next);
  if (inner.north > outer.north || inner.south < outer.south) return false;
  if (outer.west === -180 && outer.east === 180) return true;
  if (inner.west === -180 && inner.east === 180) return false;
  const width = (east: number, west: number) => (east - west + 360) % 360;
  const offset = width(inner.west, outer.west);
  return (
    offset + width(inner.east, inner.west) <= width(outer.east, outer.west)
  );
}
export function initialMapRegion(
  center: Coordinates,
  radiusKm = 10,
): ViewRegion {
  const latitudeDelta = Math.max(0.002, Math.min(120, (radiusKm * 2.6) / 111));
  return {
    ...center,
    latitudeDelta,
    longitudeDelta: Math.min(
      300,
      latitudeDelta /
        Math.max(0.2, Math.cos((center.latitude * Math.PI) / 180)),
    ),
  };
}
const longitude = (value: number) =>
  ((((value + 540) % 360) + 360) % 360) - 180;
export function boundsForRegion(region: ViewRegion, padding = 0): ViewBounds {
  const dy = region.latitudeDelta * (0.5 + padding),
    dx = region.longitudeDelta * (0.5 + padding);
  const round = (x: number) => Math.round(x * 100000) / 100000;
  return {
    north: round(Math.min(90, region.latitude + dy)),
    south: round(Math.max(-90, region.latitude - dy)),
    west: dx >= 180 ? -180 : round(longitude(region.longitude - dx)),
    east: dx >= 180 ? 180 : round(longitude(region.longitude + dx)),
  };
}
export function insideView(bounds: ViewBounds, point: Coordinates) {
  return (
    point.latitude >= bounds.south &&
    point.latitude <= bounds.north &&
    (bounds.west < bounds.east
      ? point.longitude >= bounds.west && point.longitude <= bounds.east
      : point.longitude >= bounds.west || point.longitude <= bounds.east)
  );
}
export function queryForView(region: ViewRegion, interestKey: string) {
  const bounds = boundsForRegion(region, 0.08);
  return new URLSearchParams({
    north: String(bounds.north),
    south: String(bounds.south),
    east: String(bounds.east),
    west: String(bounds.west),
    days: "31",
    interests: interestKey,
  }).toString();
}
// Pages can contain different schedule chunks or providers at the same venue.
// Merge their activity IDs while retaining every dated session count.
export function mergeViewPage(
  previous: Map<string, ViewVenue>,
  incoming: ViewVenue[],
) {
  for (const venue of incoming) {
    const old = previous.get(venue.id);
    if (!old) {
      previous.set(venue.id, {
        ...venue,
        activityKeys: [...venue.activityKeys],
      });
      continue;
    }
    const keys = [...new Set([...old.activityKeys, ...venue.activityKeys])];
    previous.set(venue.id, {
      ...old,
      activityKeys: keys,
      activityCount: keys.length,
      sessionCount: old.sessionCount + venue.sessionCount,
      nextSession:
        old.nextSession.startsAt <= venue.nextSession.startsAt
          ? old.nextSession
          : venue.nextSession,
    });
  }
  return previous;
}
export function visibleVenues(
  venues: ViewVenue[],
  region: ViewRegion,
): VenueSummary[] {
  const bounds = boundsForRegion(region);
  return venues
    .filter((venue) => insideView(bounds, venue.coordinate))
    .map((venue) => ({
      ...venue,
      distance: distanceKm(region, venue.coordinate),
    }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}