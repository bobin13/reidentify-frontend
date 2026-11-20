import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocusEffect } from "expo-router";

import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";

import { auth } from "../../lib/firebase";
import { apiRequest } from "../../lib/api";

import {
  organizerURL,
  sessionTime,
  venuesFor,
  type ActivitySeries,
  type VenueSummary,
  type VenueScheduleResponse,
  type CommunityEvent,
} from "../../lib/map-events";
import type { Styles } from "./map-styles";

type DisplaySession = CommunityEvent & {
  slotKey: string;
  sourceUrls: string[];
  sourceNames: string[];
  imageUrls: string[];
};
type DisplayActivity = {
  id: string;
  title: string;
  sessions: DisplaySession[];
};
const normalized = (value: string | undefined) =>
  (value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
function cleanDescription(value: string | undefined) {
  return (value || "")
    .replace(
      /City of Toronto drop-in activity\.\s*Check the city listing or contact the centre for attendance requirements, fees and availability\.\s*(?:Schedule and venue coordinates:\s*City of Toronto Open Data\.?)?/gi,
      "",
    )
    .trim();
}
function cleanAvailability(value: string | undefined) {
  return (value || "")
    .replace(/Check the centre for space and attendance requirements\.?/gi, "")
    .trim();
}
function cleanCost(value: string | undefined) {
  return /^check (?:the )?city listing for drop-in fees\.?$/i.test(
    (value || "").trim(),
  )
    ? ""
    : (value || "").trim();
}
function suppliedImages(event: CommunityEvent): string[] {
  // Read only images explicitly supplied in the event response. Never guess an
  // article image, scrape a page, or use a generic replacement photograph.
  const data = event as CommunityEvent & {
    imageUrl?: unknown;
    photoUrl?: unknown;
    image?: unknown;
    images?: unknown[];
  };
  const values = [
    data.imageUrl,
    data.photoUrl,
    data.image,
    ...(Array.isArray(data.images) ? data.images.slice(0, 3) : []),
  ];
  const urls: string[] = [];
  for (const item of values) {
    const value =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && "url" in item
          ? (item as { url: unknown }).url
          : null;
    if (typeof value !== "string" || value.length > 2000) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password)
        urls.push(url.href);
    } catch {}
  }
  return [...new Set(urls)];
}
function mergeActivities(series: ActivitySeries[]): DisplayActivity[] {
  const groups = new Map<
    string,
    { activity: DisplayActivity; slots: Map<string, DisplaySession> }
  >();
  for (const part of series)
    for (const event of part.sessions) {
      const start = Date.parse(event.startsAt),
        end = Date.parse(event.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        continue;
      const title = (event.title || part.title).replace(/\s+/g, " ").trim();
      if (!title) continue;
      // Public sessions at this venue share one activity heading. Separate user
      // groups keep their own activities and registration context.
      const owner =
        event.origin === "group"
          ? `group:${event.groupId || event.id}`
          : "public";
      const key = JSON.stringify([owner, normalized(title)]);
      let group = groups.get(key);
      if (!group) {
        group = {
          activity: { id: key, title, sessions: [] },
          slots: new Map(),
        };
        groups.set(key, group);
      }
      const room = (event.room || "").trim(),
        cost = cleanCost(event.cost),
        availability = cleanAvailability(event.availability);
      const description = cleanDescription(event.description);
      const slotKey = JSON.stringify([
        start,
        end,
        venueTimeZone(event),
        normalized(room),
        normalized(cost),
        normalized(availability),
        normalized(description),
      ]);
      const link = organizerURL(event.sourceUrl);
      const sourceNames = event.sourceName
        ? [event.sourceName]
        : event.origin === "group"
          ? ["ReIdentify group"]
          : [];
      const next: DisplaySession = {
        ...event,
        title,
        room,
        cost,
        availability,
        description,
        slotKey,
        sourceUrls: link ? [link] : [],
        sourceNames,
        imageUrls: suppliedImages(event),
      };
      const old = group.slots.get(slotKey);
      if (old) {
        old.sourceUrls = [...new Set([...old.sourceUrls, ...next.sourceUrls])];
        old.sourceNames = [
          ...new Set([...old.sourceNames, ...next.sourceNames]),
        ];
        old.imageUrls = [...new Set([...old.imageUrls, ...next.imageUrls])];
        if (!old.description && next.description)
          old.description = next.description;
      } else group.slots.set(slotKey, next);
    }
  return [...groups.values()]
    .map(({ activity, slots }) => ({
      ...activity,
      sessions: [...slots.values()].sort(
        (a, b) =>
          Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
          Date.parse(a.endsAt) - Date.parse(b.endsAt) ||
          a.slotKey.localeCompare(b.slotKey),
      ),
    }))
    .sort(
      (a, b) =>
        Date.parse(a.sessions[0].startsAt) -
          Date.parse(b.sessions[0].startsAt) || a.title.localeCompare(b.title),
    );
}
function venueTimeZone(session: CommunityEvent) {
  try {
    new Intl.DateTimeFormat("en-CA", {
      timeZone: session.timeZone || "America/Toronto",
    });
    return session.timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
}
function localDate(value: string, timeZone: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || "";
  return {
    key: `${part("year")}-${part("month")}-${part("day")}`,
    label: new Intl.DateTimeFormat("en-CA", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date),
  };
}
function scheduleDays(sessions: DisplaySession[]) {
  const days = new Map<
    string,
    { key: string; label: string; sessions: DisplaySession[] }
  >();
  for (const session of sessions) {
    const zone = venueTimeZone(session),
      date = localDate(session.startsAt, zone),
      key = zone + "|" + date.key;
    if (!days.has(key)) days.set(key, { key, label: date.label, sessions: [] });
    days.get(key)!.sessions.push(session);
  }
  return [...days.values()];
}
function timeLabel(session: DisplaySession) {
  const timeZone = venueTimeZone(session);
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const from = localDate(session.startsAt, timeZone),
    to = localDate(session.endsAt, timeZone);
  return `${format.format(new Date(session.startsAt))}–${from.key === to.key ? "" : to.label + " "}${format.format(new Date(session.endsAt))}`;
}
function commonDetails(sessions: DisplaySession[]) {
  const shared = (field: "room" | "cost" | "availability") => {
    const value = sessions[0]?.[field] || "";
    return value &&
      sessions.every(
        (session) => normalized(session[field]) === normalized(value),
      )
      ? value
      : "";
  };
  return {
    room: shared("room"),
    cost: shared("cost"),
    availability: shared("availability"),
  };
}

type ScheduleCache = VenueScheduleResponse & { expires: number };
export const scheduleCache = new Map<string, ScheduleCache>();
export function LazyVenueSchedule({
  uid,
  queryString,
  venue,
  styles,
  clock,
  onMediaChange,
}: {
  uid: string;
  queryString: string;
  venue: VenueSummary;
  styles: Styles;
  clock: number;
  onMediaChange: (available: boolean) => void;
}) {
  const path =
    "/api/map/venues/" +
    encodeURIComponent(venue.id) +
    "/events?" +
    queryString;
  const cacheKey = uid + "|" + path;
  const saved = scheduleCache.get(cacheKey);
  const [page, setPage] = useState<VenueScheduleResponse>(() =>
    saved && saved.expires > Date.now()
      ? saved
      : { events: [], total: 0, nextCursor: null },
  );
  const [loading, setLoading] = useState(
    () => !saved || saved.expires <= Date.now(),
  );
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const request = useRef<((cursor: string | null) => Promise<void>) | null>(
    null,
  );
  useFocusEffect(
    useCallback(() => {
      let active = true,
        busy = false;
      let accumulated: CommunityEvent[] = [];
      const load = async (cursor: string | null) => {
        if (!active || busy) return;
        busy = true;
        setLoading(true);
        setError("");
        try {
          const account = auth.currentUser;
          if (!account || account.uid !== uid)
            throw new Error("Please sign in again.");
          const result = await apiRequest<VenueScheduleResponse>(
            account,
            "GET",
            undefined,
            path + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          );
          if (
            !Array.isArray(result.events) ||
            !Number.isInteger(result.total) ||
            (result.nextCursor !== null &&
              typeof result.nextCursor !== "string")
          )
            throw new Error("The schedule is unavailable. Try again.");
          if (!active || auth.currentUser?.uid !== uid) return;
          const unique = new Map(
            (cursor ? [...accumulated, ...result.events] : result.events).map(
              (event) => [event.id, event],
            ),
          );
          accumulated = [...unique.values()];
          const next = { ...result, events: accumulated };
          setPage(next);
          if (accumulated.length <= 300) {
            scheduleCache.set(cacheKey, {
              ...next,
              expires: Date.now() + 60000,
            });
            if (scheduleCache.size > 8)
              scheduleCache.delete(scheduleCache.keys().next().value!);
          } else scheduleCache.delete(cacheKey);
        } catch (issue) {
          if (active)
            setError(
              issue instanceof Error
                ? issue.message
                : "Could not load these dates.",
            );
        } finally {
          busy = false;
          if (active) setLoading(false);
        }
      };
      request.current = load;
      const recent = scheduleCache.get(cacheKey);
      if (!retry && recent && recent.expires > Date.now()) {
        accumulated = recent.events;
        setPage(recent);
        setLoading(false);
        setError("");
      } else void load(null);
      return () => {
        active = false;
        request.current = null;
      };
    }, [uid, path, cacheKey, retry]),
  );
  const full = useMemo(
    () => venuesFor(page.events, venue.coordinate, 1, [], false, clock)[0],
    [page.events, venue.coordinate.latitude, venue.coordinate.longitude, clock],
  );
  const activities = useMemo(
    () => mergeActivities(full?.activities || []),
    [full],
  );
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const pictures = useMemo(
    () =>
      [
        ...new Set(
          activities.flatMap((activity) =>
            activity.sessions.flatMap((session) => session.imageUrls),
          ),
        ),
      ]
        .slice(0, 3)
        .filter((url) => !failedImages.includes(url)),
    [activities, failedImages],
  );
  useEffect(() => {
    onMediaChange(pictures.length > 0);
  }, [pictures.length, onMediaChange]);
  return (
    <View>
      {pictures.length > 0 && (
        <Image
          source={{ uri: pictures[0] }}
          style={styles.eventPhoto}
          contentFit="cover"
          transition={150}
          accessibilityLabel={`Activity photo at ${venue.title}`}
          onError={() =>
            setFailedImages((old) =>
              old.includes(pictures[0]) ? old : [...old, pictures[0]],
            )
          }
        />
      )}
      {activities.length ? (
        <VenueSchedule activities={activities} styles={styles} />
      ) : (
        <View style={styles.schedule}>
          {!loading && !error && (
            <Text style={styles.help}>
              No upcoming dates remain. Refresh the map.
            </Text>
          )}
        </View>
      )}
      {loading && (
        <View style={styles.statusRow}>
          <ActivityIndicator color={styles.link.color} />
          <Text style={styles.help}>Loading dates…</Text>
        </View>
      )}
      {!!error && (
        <View style={styles.statusRow}>
          <Text accessibilityRole="alert" style={styles.statusText}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            style={styles.textButton}
            onPress={() => setRetry((n) => n + 1)}
          >
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </View>
      )}
      {!!page.nextCursor && !error && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
          disabled={loading}
          style={styles.outlineButton}
          onPress={() => void request.current?.(page.nextCursor)}
        >
          <Text style={styles.link}>
            {loading ? "Loading…" : "Load more activities and dates"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function VenueSchedule({
  activities,
  styles,
}: {
  activities: DisplayActivity[];
  styles: Styles;
}) {
  const [shown, setShown] = useState(4);
  return (
    <View style={styles.schedule}>
      {activities.slice(0, shown).map((activity) => (
        <ActivitySchedule
          key={activity.id}
          activity={activity}
          styles={styles}
        />
      ))}
      {activities.length > shown && (
        <Pressable
          accessibilityRole="button"
          style={styles.textButton}
          onPress={() => setShown((n) => n + 4)}
        >
          <Text style={styles.link}>Show more activities here</Text>
        </Pressable>
      )}
    </View>
  );
}

function ActivitySchedule({
  activity,
  styles,
}: {
  activity: DisplayActivity;
  styles: Styles;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(5);
  const [linkError, setLinkError] = useState("");
  const days = useMemo(
    () => scheduleDays(activity.sessions),
    [activity.sessions],
  );
  const next = activity.sessions[0];
  const common = commonDetails(activity.sessions);
  const sources = [
    ...new Set(activity.sessions.flatMap((session) => session.sourceNames)),
  ].join(" · ");
  const links = [
    ...new Set(activity.sessions.flatMap((session) => session.sourceUrls)),
  ];
  const sharedLink = links.length === 1 ? links[0] : null;
  const descriptions = [
    ...new Set(
      activity.sessions
        .map((session) => cleanDescription(session.description))
        .filter(Boolean),
    ),
  ];
  async function visit(url: string) {
    setLinkError("");
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError("Could not open the organizer’s listing. Please try again.");
    }
  }
  return (
    <View style={styles.activity}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={"Dates and details for " + activity.title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.activityTrigger}
      >
        <Text style={styles.eventTitle}>{activity.title}</Text>
        <Text style={styles.body}>
          {open
            ? `${days.length} ${days.length === 1 ? "date" : "dates"} · ${activity.sessions.length} ${activity.sessions.length === 1 ? "time slot" : "time slots"}`
            : sessionTime(next)}
        </Text>
        {!!sources && <Text style={styles.help}>{sources}</Text>}
        <Text style={styles.link}>
          {open ? "Hide times and details" : "See times and details"}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.details}>
          {descriptions.map((description) => (
            <Text key={description} style={styles.body}>
              {description}
            </Text>
          ))}
          {!!common.room && (
            <Text style={styles.body}>Room: {common.room}</Text>
          )}
          {!!common.cost && (
            <Text style={styles.body}>Cost: {common.cost}</Text>
          )}
          {!!common.availability && (
            <Text style={styles.body}>{common.availability}</Text>
          )}
          {days.slice(0, shown).map((day) => (
            <View key={day.key} style={styles.dateRow}>
              <Text style={styles.eventTitle}>{day.label}</Text>
              {day.sessions.map((session) => (
                <View key={session.slotKey} style={styles.timeSlot}>
                  <Text style={styles.body}>{timeLabel(session)}</Text>
                  {!!session.room && session.room !== common.room && (
                    <Text style={styles.help}>Room: {session.room}</Text>
                  )}
                  {!!session.cost && session.cost !== common.cost && (
                    <Text style={styles.help}>Cost: {session.cost}</Text>
                  )}
                  {!!session.availability &&
                    session.availability !== common.availability && (
                      <Text style={styles.help}>{session.availability}</Text>
                    )}
                  {!sharedLink &&
                    session.sourceUrls.map((url) => (
                      <Pressable
                        key={url}
                        accessibilityRole="link"
                        accessibilityLabel={`Organizer details for ${activity.title} on ${sessionTime(session)}`}
                        style={styles.textButton}
                        onPress={() => void visit(url)}
                      >
                        <Text style={styles.link}>
                          Organizer details / registration ↗
                        </Text>
                      </Pressable>
                    ))}
                </View>
              ))}
            </View>
          ))}
          {days.length > shown && (
            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={() => setShown((n) => n + 5)}
            >
              <Text style={styles.link}>Show more dates</Text>
            </Pressable>
          )}
          {!!sharedLink && (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Organizer details for ${activity.title}`}
              style={styles.textButton}
              onPress={() => void visit(sharedLink)}
            >
              <Text style={styles.link}>
                Organizer details / registration ↗
              </Text>
            </Pressable>
          )}
          {!!linkError && (
            <Text accessibilityRole="alert" style={styles.body}>
              {linkError}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
