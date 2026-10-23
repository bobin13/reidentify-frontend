export type Coordinate = { latitude: number; longitude: number };
export type AreaSelection = { cityId: string; districtId: string | null };
export type DistrictOption = {
  id: string;
  name: string;
  coordinate: Coordinate;
};
export type CityOption = DistrictOption & {
  kind: string;
  region: string;
  districts: DistrictOption[];
};
export type ProfileLocation = AreaSelection & {
  province: "Ontario";
  city: string;
  district: string | null;
  coordinate: Coordinate;
};

// Shared with the Node backend. No geocoding request or GPS permission needed.
const catalogue: {
  cities: CityOption[];
} = require("../../shared/ontario-areas.json");
export const ONTARIO_CITIES: readonly CityOption[] = catalogue.cities;

export function searchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchesArea(query: string, text: string) {
  const haystack = searchText(text);
  return searchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function cityFor(id: string | undefined | null) {
  return ONTARIO_CITIES.find((city) => city.id === id) ?? null;
}

export function resolveArea(
  selection: AreaSelection | null | undefined,
): ProfileLocation | null {
  if (!selection) return null;
  const city = cityFor(selection.cityId);
  if (!city) return null;
  const district =
    selection.districtId != null
      ? city.districts.find((item) => item.id === selection.districtId)
      : null;
  if (selection.districtId != null && !district) return null;
  return {
    province: "Ontario",
    cityId: city.id,
    city: city.name,
    districtId: district?.id ?? null,
    district: district?.name ?? null,
    coordinate: { ...(district?.coordinate ?? city.coordinate) },
  };
}

export function areaLabel(location: ProfileLocation | null | undefined) {
  return location
    ? [location.city, location.district].filter(Boolean).join(" · ")
    : "";
}

export function selectionForProfile(profile: {
  location?: AreaSelection | null;
  area?: string;
}) {
  const saved = resolveArea(profile.location);
  if (saved) return { cityId: saved.cityId, districtId: saved.districtId };
  // Recognize existing free-text locations only when unambiguous.
  const parts = (profile.area ?? "")
    .split(/[,·]/)
    .map(searchText)
    .filter(Boolean);
  const cities = ONTARIO_CITIES.filter((city) =>
    parts.includes(searchText(city.name)),
  );
  if (cities.length === 1) {
    const city = cities[0];
    const district = city.districts.find((item) =>
      parts.includes(searchText(item.name)),
    );
    return { cityId: city.id, districtId: district?.id ?? null };
  }
  if (cities.length > 1) return null;
  const matches = ONTARIO_CITIES.flatMap((city) =>
    city.districts
      .filter((district) => parts.includes(searchText(district.name)))
      .map((district) => ({ cityId: city.id, districtId: district.id })),
  );
  return matches.length === 1 ? matches[0] : null;
}