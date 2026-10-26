export type ClusterPoint = {
  id: string;
  coordinate: { latitude: number; longitude: number };
};
export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};
export type MapSymbol<T extends ClusterPoint> =
  | { kind: "venue"; id: string; point: T }
  | {
      kind: "cluster";
      id: string;
      coordinate: ClusterPoint["coordinate"];
      count: number;
      members: T[];
    };
const longitudeOffset = (longitude: number, center: number) =>
  ((((longitude - center + 540) % 360) + 360) % 360) - 180;
const mercator = (latitude: number) => {
  const rad =
    (Math.max(-85.051128, Math.min(85.051128, latitude)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
};

// Only nearby, currently visible venues enter this render set. Increasing the
// screen grid size merges groups until the native marker budget is respected.
// Every candidate remains represented by either a pin or a numbered cluster.
export function clusterMapPoints<T extends ClusterPoint>(
  points: readonly T[],
  region: MapRegion,
  width: number,
  height: number,
  selectedId: string | null,
  maximum = 100,
): MapSymbol<T>[] {
  if (!(
    width > 0 &&
    height > 0 &&
    region.latitudeDelta > 0 &&
    region.longitudeDelta > 0
  ))
    return [];
  const north = mercator(region.latitude + region.latitudeDelta / 2);
  const south = mercator(region.latitude - region.latitudeDelta / 2);
  const span = Math.max(1e-9, north - south);
  const seen = new Set<string>();
  const projected: { point: T; x: number; y: number }[] = [];
  for (const point of points) {
    if (
      seen.has(point.id) ||
      !Number.isFinite(point.coordinate.latitude) ||
      !Number.isFinite(point.coordinate.longitude)
    )
      continue;
    seen.add(point.id);
    const x =
      (longitudeOffset(point.coordinate.longitude, region.longitude) /
        region.longitudeDelta +
        0.5) *
      width;
    const y = ((north - mercator(point.coordinate.latitude)) / span) * height;
    if (
      x < -width * 0.1 ||
      x > width * 1.1 ||
      y < -height * 0.1 ||
      y > height * 1.1
    )
      continue;
    projected.push({ point, x: x + width * 0.1, y: y + height * 0.1 });
  }
  const selected = projected.find((item) => item.point.id === selectedId);
  const others = projected
    .filter((item) => item !== selected)
    .sort((a, b) => a.point.id.localeCompare(b.point.id));
  const budget = Math.max(
    selected ? 2 : 1,
    Math.min(100, Math.floor(maximum) || 100),
  );
  let size = 56;
  let groups: Map<string, T[]>;
  do {
    groups = new Map();
    for (const { point, x, y } of others) {
      const key = Math.floor(x / size) + ":" + Math.floor(y / size);
      const group = groups.get(key) || [];
      group.push(point);
      groups.set(key, group);
    }
    if (groups.size + (selected ? 1 : 0) <= budget) break;
    size *= 1.5;
  } while (size < 1e9);
  const result: MapSymbol<T>[] = [];
  for (const [key, members] of groups) {
    if (members.length === 1)
      result.push({ kind: "venue", id: members[0].id, point: members[0] });
    else {
      const latitude =
        members.reduce((sum, p) => sum + p.coordinate.latitude, 0) /
        members.length;
      const relative =
        members.reduce(
          (sum, p) =>
            sum + longitudeOffset(p.coordinate.longitude, region.longitude),
          0,
        ) / members.length;
      const longitude = ((region.longitude + relative + 540) % 360) - 180;
      result.push({
        kind: "cluster",
        id: "cluster:" + size + ":" + key + ":" + members[0].id,
        coordinate: { latitude, longitude },
        count: members.length,
        members,
      });
    }
  }
  if (selected)
    result.push({
      kind: "venue",
      id: selected.point.id,
      point: selected.point,
    });
  return result;
}

export function regionForCluster<T extends ClusterPoint>(
  cluster: Extract<MapSymbol<T>, { kind: "cluster" }>,
  current: MapRegion,
): MapRegion {
  const latitudes = cluster.members.map((p) => p.coordinate.latitude);
  const longitudes = cluster.members.map((p) =>
    longitudeOffset(p.coordinate.longitude, cluster.coordinate.longitude),
  );
  return {
    ...cluster.coordinate,
    latitudeDelta: Math.max(
      0.0005,
      Math.min(
        current.latitudeDelta * 0.65,
        (Math.max(...latitudes) - Math.min(...latitudes)) * 1.5 ||
          current.latitudeDelta * 0.4,
      ),
    ),
    longitudeDelta: Math.max(
      0.0005,
      Math.min(
        current.longitudeDelta * 0.65,
        (Math.max(...longitudes) - Math.min(...longitudes)) * 1.5 ||
          current.longitudeDelta * 0.4,
      ),
    ),
  };
}