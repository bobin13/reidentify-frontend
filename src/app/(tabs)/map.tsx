import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Location from "expo-location";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EventMap from "../../components/event-map";
import type { AppColors } from "../../constants/app-colors";
import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import { apiRequest } from "../../lib/api";
import {
  resolveArea,
  selectionForProfile,
  type AreaSelection,
} from "../../lib/locations";
import {
  distanceKm,
  distanceLabel,
  organizerURL,
  sessionTime,
  venuesFor,
  type ActivitySeries,
  type Coordinates,
  type MapVenueResponse,
  type VenueSummary,
  type VenueScheduleResponse,
  type CommunityEvent,
  type EventVenue,
} from "../../lib/map-events";

const DEFAULT_AREA: AreaSelection = { cityId: "on-20002", districtId: null };
const RADII = [0.5, 2, 10];

function areaFor(selection: AreaSelection | null) {
  return resolveArea(selection) || resolveArea(DEFAULT_AREA)!;
}

export default function MapScreen() {
  const { colors, theme } = useAppTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const compactLocation = width < 380 || fontScale > 1.15;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(124);
  const mapHeight = Math.max(
    360,
    Math.round(
      (viewportHeight || height - insets.top - insets.bottom - 64) -
        headerHeight -
        10,
    ),
  );
  const styles = useMemo(() => createStyles(colors), [colors]);
  const profileSelection = user ? selectionForProfile(user) : null;
  const profileKey = [
    user?.id || "",
    profileSelection?.cityId || "",
    profileSelection?.districtId || "",
  ].join("|");
  const initial = areaFor(profileSelection);
  const profileLatitude = initial.coordinate.latitude;
  const profileLongitude = initial.coordinate.longitude;
  const [center, setCenter] = useState<Coordinates>(initial.coordinate);
  const [recenterKey, setRecenterKey] = useState(0);
  const [radiusKm, setRadiusKm] = useState(10);
  const [useInterests, setUseInterests] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapMoved, setMapMoved] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationPermission, setLocationPermission] = useState(false);
  const [locationIssue, setLocationIssue] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [reload, setReload] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [placesShown, setPlacesShown] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const uid = user?.id || "";
  const interests = useMemo(() => user?.interests || [], [user?.interests]);
  const interestsOnly = useInterests && interests.length > 0;
  const interestKey = JSON.stringify(
    interestsOnly ? [...new Set(interests)].sort() : [],
  );
  const queryString = useMemo(
    () =>
      new URLSearchParams({
        latitude: String(center.latitude),
        longitude: String(center.longitude),
        radiusKm: String(radiusKm),
        days: "31",
        interests: interestKey,
      }).toString(),
    [center.latitude, center.longitude, radiusKm, interestKey],
  );
  const queryKey = uid + "|" + queryString;
  const [records, setRecords] = useState<{
    key: string;
    data: MapVenueResponse;
  }>({
    key: "",
    data: { venues: [], windowDays: 31 },
  });
  const data: MapVenueResponse =
    records.key === queryKey ? records.data : { venues: [], windowDays: 31 };
  const pendingCenter = useRef(center);
  const locationRequest = useRef(0);
  const mounted = useRef(true);
  const venues = data.venues;
  const selected = venues.find((venue) => venue.id === selectedId);
  const sources = data.sources || [];
  const preparing =
    data.indexing ||
    sources.some((source) => !source.ready && source.refreshing);
  const savedSources = sources.filter((source) => source.ready && source.stale);
  const unavailable = sources.filter(
    (source) => !source.ready && !source.refreshing,
  );

  const chooseCenter = useCallback((coordinate: Coordinates) => {
    locationRequest.current++;
    setLocating(false);
    setCenter({ ...coordinate });
    setRecenterKey((value) => value + 1);
    pendingCenter.current = coordinate;
    setMapMoved(false);
    setSelectedId(null);
    setLocationIssue("");
    setShowSettings(false);
    setPlacesShown(8);
    setError("");
  }, []);

  useEffect(() => {
    setUseInterests(false);
    setLocationPermission(false);
  }, [profileKey]);

  useFocusEffect(
    useCallback(() => {
      // Each visit starts at the saved district, or the city when no district
      // was selected. GPS is used only when My location is pressed.
      chooseCenter({ latitude: profileLatitude, longitude: profileLongitude });
      return () => {
        // Ignore GPS results that finish after leaving this tab or account.
        locationRequest.current++;
      };
    }, [profileKey, profileLatitude, profileLongitude, chooseCenter]),
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      locationRequest.current++;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!uid) {
        setLoading(false);
        setError("");
        return;
      }
      let active = true,
        busy = false;
      setLoading(true);
      setError("");
      async function refresh() {
        if (
          !active ||
          busy ||
          (AppState.currentState && AppState.currentState !== "active")
        )
          return;
        busy = true;
        setClock(Date.now());
        try {
          const account = auth.currentUser;
          if (!account || account.uid !== uid)
            throw new Error("Please sign in again.");
          const response = await apiRequest<MapVenueResponse>(
            account,
            "GET",
            undefined,
            "/api/map/venues?" + queryString,
          );
          if (!Array.isArray(response.venues))
            throw new Error(
              "Activities are temporarily unavailable. Please try again.",
            );
          if (active && auth.currentUser?.uid === uid) {
            setRecords({ key: queryKey, data: response });
            setClock(Date.now());
            setError("");
          }
        } catch (issue) {
          if (active)
            setError(
              issue instanceof Error ? issue.message : "Could not load events.",
            );
        } finally {
          busy = false;
          if (active) setLoading(false);
        }
      }
      void refresh();
      const timer = setInterval(() => void refresh(), 60000);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => {
        active = false;
        clearInterval(timer);
        subscription.remove();
      };
    }, [uid, queryKey, queryString, reload]),
  );

  const handleMapMove = useCallback(
    (coordinate: Coordinates) => {
      pendingCenter.current = coordinate;
      setMapMoved(distanceKm(center, coordinate) > 0.15);
    },
    [center],
  );

  async function useCurrentLocation() {
    const requestId = ++locationRequest.current;
    const isCurrent = () =>
      mounted.current && requestId === locationRequest.current;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setLocating(true);
    setLocationIssue("");
    setShowSettings(false);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!isCurrent()) return;
      setLocationPermission(permission.granted);
      if (!permission.granted) {
        setLocationIssue(
          "Location permission wasn't granted. You can move the map to explore.",
        );
        setShowSettings(!permission.canAskAgain);
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        if (isCurrent())
          setLocationIssue(
            "Turn on location services to use your current location.",
          );
        return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Location timed out")),
            15000,
          );
        }),
      ]);
      if (!isCurrent()) return;
      const coordinate = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      if (
        !Number.isFinite(coordinate.latitude) ||
        !Number.isFinite(coordinate.longitude) ||
        Math.abs(coordinate.latitude) > 90 ||
        Math.abs(coordinate.longitude) > 180
      )
        throw new Error();
      chooseCenter(coordinate);
    } catch {
      if (isCurrent())
        setLocationIssue(
          "We couldn't get your location. Try again, or move the map to explore.",
        );
    } finally {
      if (timeout) clearTimeout(timeout);
      if (isCurrent()) setLocating(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      onLayout={({ nativeEvent }) =>
        setViewportHeight(nativeEvent.layout.height)
      }
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 28 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={styles.mapHeader}
        onLayout={({ nativeEvent }) =>
          setHeaderHeight(nativeEvent.layout.height)
        }
      >
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>R</Text>
          </View>
          <Text style={styles.brand}>ReIdentify</Text>
        </View>
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use my location"
            accessibilityState={{ disabled: locating }}
            disabled={locating}
            onPress={() => void useCurrentLocation()}
            style={[styles.locationButton, locating && styles.disabled]}
          >
            {locating ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <SymbolView
                name={{
                  ios: "location.fill",
                  android: "my_location",
                  web: "my_location",
                }}
                size={18}
                tintColor={colors.background}
              />
            )}
            {!compactLocation && (
              <Text style={styles.locationText}>
                {locating ? "Locating…" : "My location"}
              </Text>
            )}
          </Pressable>
          <View
            style={styles.distancePicker}
            accessibilityLabel="Distance from the map centre"
          >
            {RADII.map((radius) => (
              <Pressable
                key={radius}
                accessibilityRole="button"
                accessibilityLabel={
                  radius < 1
                    ? "Within 500 metres"
                    : "Within " + radius + " kilometres"
                }
                accessibilityState={{ selected: radiusKm === radius }}
                style={[
                  styles.distanceOption,
                  radiusKm === radius && styles.activeChip,
                ]}
                onPress={() => {
                  setRadiusKm(radius);
                  setPlacesShown(8);
                  setMapMoved(false);
                }}
              >
                <Text
                  style={[
                    styles.distanceText,
                    radiusKm === radius && styles.activeText,
                  ]}
                >
                  {radius < 1 ? "500 m" : radius + " km"}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh nearby activities"
            accessibilityState={{ disabled: loading }}
            disabled={loading}
            style={styles.textButton}
            onPress={() => setReload((n) => n + 1)}
          >
            <Text style={styles.link}>{loading ? "Loading…" : "Refresh"}</Text>
          </Pressable>
        </View>
      </View>
      <View style={[styles.mapFrame, { height: mapHeight }]}>
        <EventMap
          center={center}
          recenterKey={recenterKey}
          radiusKm={radiusKm}
          events={venues}
          selectedId={selected?.id || null}
          theme={theme}
          colors={colors}
          showUserLocation={locationPermission}
          onMove={handleMapMove}
          onSelect={setSelectedId}
        />
        {mapMoved && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search this map area"
            style={styles.searchAreaButton}
            onPress={() => chooseCenter(pendingCenter.current)}
          >
            <Text style={styles.link}>Search this area</Text>
          </Pressable>
        )}
      </View>
      {(locationIssue ||
        error ||
        preparing ||
        savedSources.length > 0 ||
        unavailable.length > 0) && (
        <View style={styles.statusArea}>
          {!!locationIssue && (
            <View style={styles.statusRow}>
              <Text accessibilityRole="alert" style={styles.statusText}>
                {locationIssue}
              </Text>
              {showSettings && (
                <Pressable
                  accessibilityRole="button"
                  style={styles.textButton}
                  onPress={() =>
                    void Linking.openSettings().catch(() =>
                      setLocationIssue(
                        "Open your phone's settings to allow location access.",
                      ),
                    )
                  }
                >
                  <Text style={styles.link}>Settings</Text>
                </Pressable>
              )}
            </View>
          )}
          {!!error && (
            <View style={styles.statusRow}>
              <Text accessibilityRole="alert" style={styles.statusText}>
                Activity updates: {error}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry activity updates"
                accessibilityState={{ disabled: loading }}
                disabled={loading}
                style={styles.textButton}
                onPress={() => setReload((n) => n + 1)}
              >
                <Text style={styles.link}>Retry</Text>
              </Pressable>
            </View>
          )}
          {!!error && venues.length > 0 && (
            <Text style={styles.help}>Showing saved activities.</Text>
          )}
          {preparing && (
            <Text accessibilityLiveRegion="polite" style={styles.help}>
              Community calendars are being prepared. Activities will appear
              automatically.
            </Text>
          )}
          {!!savedSources.length && (
            <Text style={styles.help}>
              Showing saved listings from{" "}
              {savedSources.map((source) => source.name).join(", ")}.
            </Text>
          )}
          {!!unavailable.length && (
            <Text style={styles.help}>
              {unavailable.map((source) => source.name).join(", ")} listings are
              temporarily unavailable.
            </Text>
          )}
        </View>
      )}
      {selected && (
        <LazyVenueSchedule
          key={uid + "|" + queryString + "|" + selected.id}
          uid={uid}
          queryString={queryString}
          venue={selected}
          styles={styles}
          clock={clock}
        />
      )}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: !interestsOnly }}
          style={[styles.chip, !interestsOnly && styles.activeChip]}
          onPress={() => setUseInterests(false)}
        >
          <Text style={[styles.chipText, !interestsOnly && styles.activeText]}>
            All activities
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!interests.length}
          accessibilityState={{
            selected: interestsOnly,
            disabled: !interests.length,
          }}
          style={[
            styles.chip,
            interestsOnly && styles.activeChip,
            !interests.length && styles.disabled,
          ]}
          onPress={() => setUseInterests(true)}
        >
          <Text style={[styles.chipText, interestsOnly && styles.activeText]}>
            My interests
          </Text>
        </Pressable>
      </View>
      {!interests.length && !!user && (
        <Pressable
          accessibilityRole="button"
          style={styles.textButton}
          onPress={() => router.push("/search")}
        >
          <Text style={styles.link}>Choose interests in Search</Text>
        </Pressable>
      )}
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {venues.length} {venues.length === 1 ? "place" : "places"} within{" "}
        {radiusKm < 1 ? "500 m" : radiusKm + " km"}
      </Text>
      <Text style={styles.help}>
        Upcoming activities for the next 31 days. Distances are straight-line
        estimates.
      </Text>
      {!user && (
        <View style={styles.notice}>
          <Text style={styles.body}>Sign in to view community activities.</Text>
          <Pressable
            accessibilityRole="button"
            style={styles.textButton}
            onPress={() => router.push("/profile")}
          >
            <Text style={styles.link}>Go to profile</Text>
          </Pressable>
        </View>
      )}
      {!!user && !loading && !error && !preparing && !venues.length && (
        <View style={styles.notice}>
          <Text style={styles.eventTitle}>No matching activities nearby</Text>
          <Text style={styles.body}>
            Try a larger distance or All activities. More community calendars
            will be added as coverage grows.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.textButton}
            onPress={() => {
              setRadiusKm(10);
              setUseInterests(false);
            }}
          >
            <Text style={styles.link}>Show all activities within 10 km</Text>
          </Pressable>
        </View>
      )}
      {venues.slice(0, placesShown).map((venue) => (
        <Pressable
          key={venue.id}
          accessibilityRole="button"
          accessibilityLabel={"Show activities at " + venue.title}
          accessibilityState={{ selected: selected?.id === venue.id }}
          style={[
            styles.card,
            selected?.id === venue.id && styles.selectedCard,
          ]}
          onPress={() =>
            setSelectedId(selected?.id === venue.id ? null : venue.id)
          }
        >
          <Text style={styles.eventTitle}>{venue.title}</Text>
          <Text style={styles.body}>{venue.location}</Text>
          <Text style={styles.link}>
            {venue.activityCount}{" "}
            {venue.activityCount === 1 ? "activity" : "activities"} ·{" "}
            {distanceLabel(venue.distance)}
          </Text>
          <Text style={styles.body}>Next: {venue.nextSession.title}</Text>
          <Text style={styles.help}>{sessionTime(venue.nextSession)}</Text>
          <Text style={styles.link}>
            {selected?.id === venue.id
              ? "Activities shown above"
              : "See activities and dates"}
          </Text>
        </Pressable>
      ))}
      {venues.length > placesShown && (
        <Pressable
          accessibilityRole="button"
          style={styles.outlineButton}
          onPress={() => setPlacesShown((n) => n + 8)}
        >
          <Text style={styles.link}>Show more places</Text>
        </Pressable>
      )}
      <Text style={styles.help}>
        Check the organizer's listing for cost, accessibility, availability and
        registration before travelling.
      </Text>
    </ScrollView>
  );
}

type Styles = ReturnType<typeof createStyles>;
type ScheduleCache = VenueScheduleResponse & { expires: number };
const scheduleCache = new Map<string, ScheduleCache>();
function LazyVenueSchedule({
  uid,
  queryString,
  venue,
  styles,
  clock,
}: {
  uid: string;
  queryString: string;
  venue: VenueSummary;
  styles: Styles;
  clock: number;
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
  const [loading, setLoading] = useState(false);
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
      void load(null);
      return () => {
        active = false;
        request.current = null;
      };
    }, [uid, path, cacheKey, retry]),
  );
  const full = useMemo(
    () => venuesFor(page.events, venue.coordinate, 1, [], false, clock)[0],
    [page.events, venue.coordinate, clock],
  );
  return (
    <View>
      {full ? (
        <VenueSchedule
          venue={{
            ...full,
            id: venue.id,
            title: venue.title,
            location: venue.location,
          }}
          styles={styles}
        />
      ) : (
        <View style={[styles.card, styles.selectedCard]}>
          <Text style={styles.sectionTitle}>Activities at {venue.title}</Text>
          <Text style={styles.body}>{venue.location}</Text>
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
  venue,
  styles,
}: {
  venue: EventVenue;
  styles: Styles;
}) {
  const [shown, setShown] = useState(4);
  return (
    <View style={[styles.card, styles.selectedCard]}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Activities at {venue.title}
      </Text>
      <Text style={styles.body}>{venue.location}</Text>
      <Text style={styles.help}>Times shown are local to the venue.</Text>
      {venue.activities.slice(0, shown).map((activity) => (
        <ActivitySchedule
          key={activity.id}
          activity={activity}
          styles={styles}
        />
      ))}
      {venue.activities.length > shown && (
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
  activity: ActivitySeries;
  styles: Styles;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(5);
  const [linkError, setLinkError] = useState("");
  const next = activity.sessions[0];
  async function visit(value: string | undefined) {
    const url = organizerURL(value);
    if (!url) return;
    setLinkError("");
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError("Could not open the organizer's listing. Please try again.");
    }
  }
  return (
    <View style={styles.activity}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={"Dates and details for " + activity.title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.activityTrigger}
      >
        <Text style={styles.eventTitle}>{activity.title}</Text>
        <Text style={styles.body}>{sessionTime(next)}</Text>
        <Text style={styles.help}>{next.sourceName || "ReIdentify group"}</Text>
        <Text style={styles.link}>
          {open
            ? "Hide details"
            : activity.sessions.length > 1
              ? "See details and loaded dates"
              : "See details"}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.details}>
          {!!next.description && (
            <Text style={styles.body}>{next.description}</Text>
          )}
          {!!next.room && <Text style={styles.body}>Room: {next.room}</Text>}
          {!!next.cost && <Text style={styles.body}>Cost: {next.cost}</Text>}
          {!!next.interests?.length && (
            <Text style={styles.help}>{next.interests.join(" · ")}</Text>
          )}
          {activity.sessions.slice(0, shown).map((item) => (
            <View key={item.id} style={styles.dateRow}>
              <Text style={styles.body}>{sessionTime(item)}</Text>
              {!!item.availability && (
                <Text style={styles.body}>{item.availability}</Text>
              )}
              {!!item.cost && item.cost !== next.cost && (
                <Text style={styles.body}>Cost: {item.cost}</Text>
              )}
              {!!organizerURL(item.sourceUrl) && (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={
                    "Organizer details for " +
                    activity.title +
                    " on " +
                    sessionTime(item)
                  }
                  style={styles.textButton}
                  onPress={() => void visit(item.sourceUrl)}
                >
                  <Text style={styles.link}>
                    Organizer details / registration ↗
                  </Text>
                </Pressable>
              )}
            </View>
          ))}
          {activity.sessions.length > shown && (
            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={() => setShown((n) => n + 5)}
            >
              <Text style={styles.link}>Show more dates</Text>
            </Pressable>
          )}
          {!!next.stale && (
            <Text style={styles.help}>
              Saved schedule — confirm the date with the organizer.
            </Text>
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

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 20, gap: 10 },
    mapHeader: { gap: 10 },
    header: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    logo: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: "#1D7566",
      alignItems: "center",
      justifyContent: "center",
    },
    logoText: {
      color: "#FFFFFF",
      fontSize: 28,
      fontWeight: "700",
      fontFamily: "serif",
    },
    brand: { color: colors.text, fontSize: 19, fontWeight: "700" },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "center",
    },
    toolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    locationButton: {
      minHeight: 44,
      minWidth: 44,
      justifyContent: "center",
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 22,
      backgroundColor: colors.accent,
      flexDirection: "row",
      gap: 6,
      alignItems: "center",
    },
    locationText: { color: colors.background, fontSize: 13, fontWeight: "700" },
    distancePicker: {
      flexDirection: "row",
      padding: 2,
      gap: 2,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    distanceOption: {
      minWidth: 44,
      minHeight: 44,
      paddingHorizontal: 6,
      borderRadius: 11,
      justifyContent: "center",
      alignItems: "center",
    },
    distanceText: { color: colors.text, fontSize: 13, fontWeight: "700" },
    statusArea: { gap: 4, paddingHorizontal: 2 },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    statusText: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 21 },
    outlineButton: {
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
      alignItems: "center",
    },
    textButton: {
      minHeight: 44,
      justifyContent: "center",
      alignSelf: "flex-start",
      paddingVertical: 8,
    },
    label: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 23,
      fontWeight: "600",
    },
    body: { color: colors.text, fontSize: 16, lineHeight: 24 },
    help: { color: colors.muted, fontSize: 14, lineHeight: 21 },
    link: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: "700",
      lineHeight: 23,
    },
    notice: {
      padding: 16,
      gap: 8,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    mapFrame: {
      // The rest of the screen keeps its reading margin; the map uses the
      // entire available width, including the space beside those margins.
      marginHorizontal: -20,
      overflow: "hidden",
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    searchAreaButton: {
      position: "absolute",
      top: 68,
      left: 10,
      minHeight: 44,
      paddingHorizontal: 16,
      justifyContent: "center",
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      elevation: 4,
    },
    chip: {
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 22,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipText: { color: colors.text, fontSize: 15, fontWeight: "600" },
    activeChip: { backgroundColor: colors.accent, borderColor: colors.accent },
    activeText: { color: colors.background },
    disabled: { opacity: 0.5 },
    sectionTitle: {
      color: colors.text,
      fontSize: 21,
      fontWeight: "700",
      lineHeight: 29,
    },
    eventTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
      lineHeight: 26,
    },
    card: {
      padding: 16,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    selectedCard: { borderColor: colors.accent, borderWidth: 2 },
    activity: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 12,
      gap: 8,
    },
    activityTrigger: { minHeight: 48, gap: 4, paddingVertical: 4 },
    details: { gap: 10 },
    dateRow: {
      paddingTop: 10,
      gap: 4,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
  });
}