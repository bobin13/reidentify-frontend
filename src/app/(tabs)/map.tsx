import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Location from "expo-location";
import {
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
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
import { groupMapState } from "../../lib/groups";
import {
  resolveArea,
  selectionForProfile,
  type AreaSelection,
} from "../../lib/locations";
import {
  distanceLabel,
  organizerURL,
  sessionTime,
  venuesFor,
  type ActivitySeries,
  type Coordinates,
  type VenueSummary,
  type VenueScheduleResponse,
  type CommunityEvent,
  type EventVenue,
} from "../../lib/map-events";

import {
  initialMapRegion,
  queryForView,
  visibleVenues,
  mergeViewPage,
  sameMapRegion,
  canReuseMapArea,
  type ViewRegion,
  type ViewVenue,
  type ViewPage,
} from "../../lib/map-viewport";

const DEFAULT_AREA: AreaSelection = { cityId: "on-20002", districtId: null };

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
  const savedCityId = profileSelection?.cityId || "";
  const savedDistrictId = profileSelection?.districtId || "";
  const profileKey = [user?.id || "", savedCityId, savedDistrictId].join("|");
  const lastCenteredProfile = useRef(profileKey);
  const initial = areaFor(profileSelection);
  const profileLatitude = initial.coordinate.latitude;
  const profileLongitude = initial.coordinate.longitude;
  const pendingFocus = groupMapState.pendingFocus;
  const startingCoordinate =
    pendingFocus && pendingFocus.uid === user?.id
      ? pendingFocus.coordinate
      : initial.coordinate;
  const [center, setCenter] = useState<Coordinates>(startingCoordinate);
  const [recenterKey, setRecenterKey] = useState(0);
  const radiusKm = 10; // Initial camera zoom only; event searches follow the viewport.
  const [zoomRequest, setZoomRequest] = useState({ radiusKm: 10, id: 0 });
  const [view, setView] = useState(() => ({
    owner: profileKey,
    region: initialMapRegion(startingCoordinate),
  }));
  const region =
    view.owner === profileKey
      ? view.region
      : initialMapRegion(startingCoordinate);
  const [useInterests, setUseInterests] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const scope = profileKey + "|" + interestKey;
  const rawQuery = queryForView(region, interestKey);
  const [settledView, setSettledView] = useState({
    query: rawQuery,
    scope,
    region,
  });
  useEffect(() => {
    // Wait for the map gesture to finish before requesting another visible area.
    const timer = setTimeout(
      () =>
        setSettledView((previous) =>
          previous.scope === scope && canReuseMapArea(previous.region, region)
            ? previous
            : { query: rawQuery, scope, region },
        ),
      400,
    );
    return () => clearTimeout(timer);
  }, [rawQuery, scope, region]);
  const queryString = settledView.query;
  const queryReady = settledView.scope === scope;
  const searchPending =
    loading || !queryReady || !canReuseMapArea(settledView.region, region);
  const queryKey = scope + "|" + queryString;
  const completedView = useRef({ key: "", at: 0, reload: -1 });
  const viewportFlight = useRef<Promise<ViewPage> | null>(null);
  const [records, setRecords] = useState<{
    scope: string;
    query: string;
    data: ViewPage;
  }>({
    scope: "",
    query: "",
    data: { venues: [], windowDays: 31, nextCursor: null },
  });
  const data: ViewPage =
    records.scope === scope
      ? records.data
      : { venues: [], windowDays: 31, nextCursor: null };
  const locationRequest = useRef(0);
  const mounted = useRef(true);
  const venues = useMemo(
    () => visibleVenues(data.venues, region),
    [data.venues, region],
  );
  const selected = venues.find((venue) => venue.id === selectedId);
  const sources = data.sources || [];
  const preparing =
    data.indexing ||
    sources.some((source) => !source.ready && source.refreshing);
  const savedSources = sources.filter((source) => source.ready && source.stale);
  const unavailable = sources.filter(
    (source) => !source.ready && !source.refreshing,
  );

  const chooseCenter = useCallback(
    (coordinate: Coordinates) => {
      locationRequest.current++;
      setLocating(false);
      setCenter({ ...coordinate });
      setRecenterKey((value) => value + 1);
      setView({ owner: profileKey, region: initialMapRegion(coordinate) });
      setSelectedId(null);
      setLocationIssue("");
      setShowSettings(false);
      setPlacesShown(8);
      setError("");
    },
    [profileKey],
  );

  useEffect(() => {
    setUseInterests(false);
    setLocationPermission(false);
  }, [profileKey]);

  useFocusEffect(
    useCallback(() => {
      // Returning to this tab reuses the map and its current camera. A changed
      // account/city/district must still start at its own saved location.
      const changedProfile = lastCenteredProfile.current !== profileKey;
      if (__DEV__)
        console.log(
          "[map-focus] " +
            JSON.stringify({
              cityId: savedCityId,
              districtId: savedDistrictId,
              action: changedProfile ? "saved-area-changed" : "reuse-map",
              resolvedCenter: {
                latitude: profileLatitude,
                longitude: profileLongitude,
              },
            }),
        );
      const target = groupMapState.pendingFocus;
      if (target?.uid === uid) {
        groupMapState.pendingFocus = null;
        lastCenteredProfile.current = profileKey;
        chooseCenter(target.coordinate);
      } else if (changedProfile) {
        lastCenteredProfile.current = profileKey;
        chooseCenter({
          latitude: profileLatitude,
          longitude: profileLongitude,
        });
      }
      setLocating(false);
      return () => {
        // Ignore GPS results that finish after leaving this tab or account.
        locationRequest.current++;
      };
    }, [
      uid,
      profileKey,
      savedCityId,
      savedDistrictId,
      profileLatitude,
      profileLongitude,
      chooseCenter,
    ]),
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      locationRequest.current++;
      scheduleCache.clear();
    };
  }, []);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "reidentify:group-map-changed",
      (owner: string) => {
        if (owner !== uid) return;
        completedView.current = { key: "", at: 0, reload: -1 };
        scheduleCache.clear();
        setSelectedId(null);
        setRecords({
          scope: "",
          query: "",
          data: { venues: [], windowDays: 31, nextCursor: null },
        });
        setReload((value) => value + 1);
      },
    );
    const published = DeviceEventEmitter.addListener(
      "reidentify:group-event-published",
      (event: { uid: string; coordinate: Coordinates }) => {
        if (
          event.uid === uid &&
          Number.isFinite(event.coordinate?.latitude) &&
          Number.isFinite(event.coordinate?.longitude)
        ) {
          groupMapState.pendingFocus = {
            uid,
            coordinate: { ...event.coordinate },
          };
          chooseCenter(event.coordinate);
        }
      },
    );
    return () => {
      subscription.remove();
      published.remove();
    };
  }, [uid, chooseCenter]);

  useFocusEffect(
    useCallback(() => {
      if (!uid || !queryReady) {
        setLoading(false);
        setError("");
        return;
      }
      let active = true,
        busy = false,
        queued = false;
      async function refresh() {
        if (
          !active ||
          (AppState.currentState && AppState.currentState !== "active")
        )
          return;
        if (busy) {
          queued = true;
          return;
        }
        const saved = completedView.current;
        if (
          saved.key === queryKey &&
          saved.reload === reload &&
          Date.now() - saved.at < 180000
        ) {
          setLoading(false);
          return;
        }
        busy = true;
        setLoading(true);
        setError("");
        setClock(Date.now());
        const merged = new Map<string, ViewVenue>();
        const seenCursors = new Set<string>();
        let cursor: string | null = null,
          restarts = 0;
        let lastPublish = 0;
        try {
          const account = auth.currentUser;
          if (!account || account.uid !== uid)
            throw new Error("Please sign in again.");
          do {
            if (!active || auth.currentUser?.uid !== uid) return;
            if (AppState.currentState && AppState.currentState !== "active")
              return;
            let response: ViewPage;
            try {
              // A blurred tab may still have one HTTP request finishing. Wait
              // for it before starting this view, instead of overlapping reads.
              while (viewportFlight.current) {
                try {
                  await viewportFlight.current;
                } catch {}
                if (!active || auth.currentUser?.uid !== uid) return;
              }
              if (AppState.currentState && AppState.currentState !== "active")
                return;
              const pending = apiRequest<ViewPage>(
                account,
                "GET",
                undefined,
                "/api/map/viewport?" +
                  queryString +
                  (cursor ? "&cursor=" + encodeURIComponent(cursor) : "") +
                  (__DEV__ ? "&diagnostics=1" : ""),
              );
              viewportFlight.current = pending;
              try {
                response = await pending;
              } finally {
                if (viewportFlight.current === pending)
                  viewportFlight.current = null;
              }
            } catch (issue) {
              // A source can publish a new snapshot between result pages.
              if (
                (issue as { status?: number })?.status === 409 &&
                restarts++ < 2
              ) {
                cursor = null;
                merged.clear();
                seenCursors.clear();
                continue;
              }
              throw issue;
            }
            if (!active || auth.currentUser?.uid !== uid) return;
            if (AppState.currentState && AppState.currentState !== "active")
              return;
            if (
              !Array.isArray(response.venues) ||
              response.venues.some(
                (venue) => !Array.isArray(venue.activityKeys),
              ) ||
              (response.nextCursor !== null &&
                typeof response.nextCursor !== "string")
            ) {
              throw new Error(
                "Activities are temporarily unavailable. Please try again.",
              );
            }
            mergeViewPage(merged, response.venues);
            cursor = response.nextCursor;
            if (cursor && seenCursors.has(cursor))
              throw new Error(
                "Could not finish loading this map area. Tap Refresh.",
              );
            if (cursor) seenCursors.add(cursor);
            // Merge every page, but update the native pins at most five times
            // a second. Always publish the final page immediately.
            if (cursor && Date.now() - lastPublish < 200) continue;
            lastPublish = Date.now();
            const freshPoints = [...merged.values()];
            const morePages = cursor !== null;
            setRecords((previous) => {
              let points = freshPoints;
              if (
                morePages &&
                previous.scope === scope &&
                previous.query === queryString
              ) {
                // Keep the completed view visible during a background refresh.
                // Fresh cumulative fragments replace old totals; they are not added twice.
                const retained = new Map(
                  previous.data.venues.map((venue) => [venue.id, venue]),
                );
                for (const venue of points) retained.set(venue.id, venue);
                points = [...retained.values()];
              }
              return {
                scope,
                query: queryString,
                data: { ...response, venues: points },
              };
            });
            if (__DEV__ && !cursor)
              console.log(
                "[map-debug] " +
                  JSON.stringify({
                    request: queryString,
                    loadedPlaces: merged.size,
                    complete: cursor === null,
                  }),
              );
          } while (cursor && active);
          if (active && cursor === null)
            completedView.current = { key: queryKey, at: Date.now(), reload };
        } catch (issue) {
          if (active)
            setError(
              issue instanceof Error
                ? issue.message
                : "Could not finish loading places. Tap Refresh.",
            );
        } finally {
          busy = false;
          if (active) {
            setClock(Date.now());
            setLoading(false);
            if (queued) {
              queued = false;
              void refresh();
            }
          }
        }
      }
      // Reuse completed, recent results on tab return. New views, expired
      // results and the Refresh button still load all pages automatically.
      void refresh();
      const timer = setInterval(() => void refresh(), 180000);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => {
        active = false;
        clearInterval(timer);
        subscription.remove();
      };
    }, [uid, queryKey, queryString, reload, scope, queryReady]),
  );

  const handleMapMove = useCallback(
    (next: ViewRegion) => {
      setView((previous) => {
        if (
          previous.owner === profileKey &&
          sameMapRegion(previous.region, next)
        )
          return previous;
        return { owner: profileKey, region: next };
      });
    },
    [profileKey],
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
            accessibilityRole="radiogroup"
            accessibilityLabel="Map zoom shortcuts"
            style={styles.distancePicker}
          >
            {([0.5, 2, 10] as const).map((distance) => {
              const expected = initialMapRegion(region, distance).latitudeDelta;
              const active =
                Math.abs(region.latitudeDelta - expected) < expected * 0.08;
              const label = distance === 0.5 ? "500m" : `${distance}km`;
              const spokenLabel = distance === 0.5 ? "500 m" : `${distance} km`;
              return (
                <Pressable
                  key={distance}
                  accessibilityRole="radio"
                  accessibilityLabel={`Zoom to about ${spokenLabel}`}
                  accessibilityState={{ checked: active }}
                  style={[styles.distanceOption, active && styles.activeChip]}
                  onPress={() =>
                    setZoomRequest((previous) => ({
                      radiusKm: distance,
                      id: previous.id + 1,
                    }))
                  }
                >
                  <Text
                    style={[styles.distanceText, active && styles.activeText]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
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
          zoomRequest={zoomRequest}
          events={venues}
          selectedId={selected?.id || null}
          theme={theme}
          colors={colors}
          showUserLocation={locationPermission}
          onMove={handleMapMove}
          onSelect={setSelectedId}
        />
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
          key={uid + "|" + interestKey + "|" + selected.id}
          uid={uid}
          queryString={new URLSearchParams({
            latitude: String(selected.coordinate.latitude),
            longitude: String(selected.coordinate.longitude),
            radiusKm: "0.5",
            fresh: "1",
            days: "31",
            interests: interestKey,
          }).toString()}
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
        {venues.length} {venues.length === 1 ? "place" : "places"} in view
        {searchPending ? " · updating…" : ""}
      </Text>
      <Text style={styles.help}>
        Upcoming activities for the next 31 days. Move or zoom the map to
        explore. Distances are measured from the map centre.
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
      {!!user && !searchPending && !error && !preparing && !venues.length && (
        <View style={styles.notice}>
          <Text style={styles.eventTitle}>
            No matching activities in this view
          </Text>
          <Text style={styles.body}>
            Zoom out, move the map or choose All activities. More community
            calendars will be added as coverage grows.
          </Text>
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
      gap: 6,
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
      flex: 1,
      minWidth: 142,
      maxWidth: 180,
      flexDirection: "row",
      padding: 2,
      gap: 2,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    distanceOption: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      paddingHorizontal: 2,
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