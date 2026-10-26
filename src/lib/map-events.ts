export type Coordinates = { latitude: number; longitude: number };
export type CommunityEvent = {
  id: string;
  title: string;
  location: string;
  coordinate: Coordinates;
  startsAt: string;
  endsAt: string;
  description: string;
  interests: string[];
  venueId?: string;
  venueName?: string;
  seriesId?: string;
  sourceId?: string;
  sourceName?: string;
  sourceUrl?: string;
  origin?: "external" | "group";
  groupId?: string | null;
  timeZone?: string;
  room?: string;
  cost?: string;
  availability?: string;
  stale?: boolean;
};
export type EventSourceStatus = {
  id: string;
  name: string;
  area: string;
  ready: boolean;
  refreshing: boolean;
  stale: boolean;
  lastSuccessAt: string | null;
};
export type EventResponse = {
  events: CommunityEvent[];
  sources?: EventSourceStatus[];
};
export type ActivitySeries = {
  id: string;
  title: string;
  sessions: CommunityEvent[];
};
export type EventVenue = {
  id: string;
  title: string;
  location: string;
  coordinate: Coordinates;
  distance: number;
  activities: ActivitySeries[];
  sessionCount: number;
};

export function distanceKm(a: Coordinates, b: Coordinates) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function distanceLabel(distance: number) {
  if (distance < 0.1) return "Under 100 m";
  if (distance < 1) return Math.round(distance * 1000) + " m";
  return distance.toFixed(1) + " km";
}

// Repeated dates stay in their activity's schedule. Markers represent venues.
export function venuesFor(
  events: CommunityEvent[],
  center: Coordinates,
  radiusKm: number,
  interests: readonly string[],
  interestsOnly: boolean,
  now: number,
): EventVenue[] {
  const venues: EventVenue[] = [];
  const byVenueId = new Map<string, EventVenue>();
  const byPosition = new Map<string, EventVenue>();
  const seen = new Set<string>();
  for (const event of [...events].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  )) {
    const p = event.coordinate;
    if (
      seen.has(event.id) ||
      !event.title ||
      !event.location ||
      !Number.isFinite(p?.latitude) ||
      !Number.isFinite(p?.longitude) ||
      Math.abs(p.latitude) > 90 ||
      Math.abs(p.longitude) > 180 ||
      !(Date.parse(event.endsAt) > Math.max(now, Date.parse(event.startsAt))) ||
      (interestsOnly &&
        !event.interests?.some((value) => interests.includes(value)))
    )
      continue;
    seen.add(event.id);
    const distance = distanceKm(center, p);
    if (distance > radiusKm) continue;
    const position = p.latitude.toFixed(5) + "," + p.longitude.toFixed(5);
    let venue =
      (event.venueId && byVenueId.get(event.venueId)) ||
      byPosition.get(position);
    if (!venue) {
      venue = {
        id: event.venueId || "venue-" + position,
        title: event.venueName || event.location,
        location: event.location,
        coordinate: p,
        distance,
        activities: [],
        sessionCount: 0,
      };
      venues.push(venue);
    }
    if (event.venueId) byVenueId.set(event.venueId, venue);
    byPosition.set(position, venue);
    const seriesId = event.seriesId || event.id;
    let activity = venue.activities.find((item) => item.id === seriesId);
    if (!activity) {
      activity = { id: seriesId, title: event.title, sessions: [] };
      venue.activities.push(activity);
    }
    activity.sessions.push(event);
    venue.sessionCount++;
  }
  return venues.sort(
    (a, b) => a.distance - b.distance || a.title.localeCompare(b.title),
  );
}

export function sessionTime(
  event: Pick<CommunityEvent, "startsAt" | "endsAt" | "timeZone">,
) {
  const start = new Date(event.startsAt),
    end = new Date(event.endsAt);
  const timeZone = event.timeZone || "America/Toronto";
  try {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const time = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    });
    const endDate =
      date.format(end) === date.format(start) ? "" : date.format(end) + ", ";
    return (
      date.format(start) +
      " · " +
      time.format(start) +
      "–" +
      endDate +
      time.format(end)
    );
  } catch {
    return start.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
}

export function organizerURL(value: string | undefined) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export type VenueSummary = {
  id: string;
  title: string;
  location: string;
  coordinate: Coordinates;
  distance: number;
  activityCount: number;
  sessionCount: number;
  nextSession: Pick<
    CommunityEvent,
    "id" | "title" | "startsAt" | "endsAt" | "timeZone"
  >;
};
export type MapVenueResponse = {
  venues: VenueSummary[];
  sources?: EventSourceStatus[];
  indexing?: boolean;
  windowDays: number;
};
export type VenueScheduleResponse = {
  events: CommunityEvent[];
  total: number;
  nextCursor: string | null;
};