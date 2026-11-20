import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Location from "expo-location";
import {
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
  Linking,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { ModalSafeArea } from "../../components/modal-safe-area";
import EventMap from "../../components/event-map";

import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import { apiRequest } from "../../lib/api";
import { groupMapState } from "../../lib/groups";
import { resolveArea, selectionForProfile, type AreaSelection } from "../../lib/locations";
import {
  distanceLabel,
  sessionTime,
  type Coordinates,
  type VenueSummary,
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

import { createStyles } from "../../components/map/map-styles";
import { MapPlaceSearch } from "../../components/map/place-search";
import {
  LazyVenueSchedule,
  scheduleCache,
} from "../../components/map/venue-schedule";
const DEFAULT_AREA: AreaSelection = { cityId: "on-20002", districtId: null };

function areaFor(selection: AreaSelection | null) {
  return resolveArea(selection) || resolveArea(DEFAULT_AREA)!;
}

export default function MapScreen() {
  const { colors, theme } = useAppTheme();
  const { user } = useAuth();
  const { width, fontScale } = useWindowDimensions();
  const compactLocation = width < 380 || fontScale > 1.15;
  const [panelMode, setPanelMode] = useState<"peek" | "half" | "expanded">(
    "peek",
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [picked, setPicked] = useState<{
    scope: string;
    venue: VenueSummary;
  } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    id: number;
    coordinate: Coordinates;
  } | null>(null);
  const detailsScroll = useRef<ScrollView>(null);
  const [directionsError, setDirectionsError] = useState("");
  const [scheduleMedia, setScheduleMedia] = useState<{
    scope: string;
    available: boolean;
  } | null>(null);
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
  const hasEventFocus = pendingFocus?.uid === user?.id && !!user?.id;
  const startingCoordinate =
    hasEventFocus && pendingFocus
      ? pendingFocus.coordinate
      : initial.coordinate;
  const startingRadiusKm = hasEventFocus ? 0.5 : 10;
  const [center, setCenter] = useState<Coordinates>(startingCoordinate);
  const [recenterKey, setRecenterKey] = useState(0);
  // Camera zoom only; event searches continue to follow the visible viewport.
  const [radiusKm, setRadiusKm] = useState(startingRadiusKm);
  const [zoomRequest, setZoomRequest] = useState({
    radiusKm: startingRadiusKm,
    id: 0,
  });
  const [view, setView] = useState(() => ({
    owner: profileKey,
    region: initialMapRegion(startingCoordinate, startingRadiusKm),
  }));
  // Memoized so React Compiler can treat it as read-only.
  const region = useMemo(
    () =>
      view.owner === profileKey
        ? view.region
        : initialMapRegion(startingCoordinate, startingRadiusKm),
    [view, profileKey, startingCoordinate, startingRadiusKm],
  );
  const [useInterests, setUseInterests] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationPermission, setLocationPermission] = useState(false);
  const [locationIssue, setLocationIssue] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [reload, setReload] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
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
  const completedView = useRef({
    key: "",
    at: 0,
    reload: -1,
    groupVersion: "",
  });
  const checkedMembership = useRef<{ uid: string; key: string } | null>(null);
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
  const selected =
    venues.find((venue) => venue.id === selectedId) ||
    (picked?.scope === scope && picked.venue.id === selectedId
      ? picked.venue
      : undefined);
  const mapPoints = useMemo(
    () =>
      selected && !venues.some((item) => item.id === selected.id)
        ? [...venues, selected]
        : venues,
    [venues, selected],
  );
  const sources = data.sources || [];
  const preparing =
    data.indexing ||
    sources.some((source) => !source.ready && source.refreshing);
  const mediaScope = scope + "|" + (selected?.id || "");
  const reportMedia = useCallback(
    (available: boolean) => {
      setScheduleMedia((old) =>
        old?.scope === mediaScope && old.available === available
          ? old
          : { scope: mediaScope, available },
      );
    },
    [mediaScope],
  );
  const hasPhoto =
    scheduleMedia?.scope === mediaScope && scheduleMedia.available;
  const panelShare = panelMode === "expanded" ? 0.55 : hasPhoto ? 0.4 : 0.3;

  const chooseCenter = useCallback(
    (coordinate: Coordinates, nextRadiusKm = 10) => {
      locationRequest.current++;
      setLocating(false);
      setCenter({ ...coordinate });
      setRadiusKm(nextRadiusKm);
      setZoomRequest((previous) => ({
        radiusKm: nextRadiusKm,
        id: previous.id + 1,
      }));
      setRecenterKey((value) => value + 1);
      setView({
        owner: profileKey,
        region: initialMapRegion(coordinate, nextRadiusKm),
      });
      setPanelMode("peek");
      setPicked(null);
      setFocusRequest(null);
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
        setUseInterests(false);
        chooseCenter(target.coordinate, 0.5);
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
        completedView.current = {
          key: "",
          at: 0,
          reload: -1,
          groupVersion: "",
        };
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
          setUseInterests(false);
          chooseCenter(event.coordinate, 0.5);
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
        busy = true;
        const merged = new Map<string, ViewVenue>();
        const seenCursors = new Set<string>();
        let cursor: string | null = null,
          restarts = 0;
        let lastPublish = 0;
        try {
          const account = auth.currentUser;
          if (!account || account.uid !== uid)
            throw new Error("Please sign in again.");
          // Local device notifications cannot reach another member's phone.
          // Check small group revisions before reusing the completed map.
          const groupVersion = await apiRequest<{
            version: string;
            membership: string;
          }>(account, "GET", undefined, "/api/map/group-version");
          if (
            !active ||
            auth.currentUser?.uid !== uid ||
            (AppState.currentState && AppState.currentState !== "active")
          )
            return;
          if (
            typeof groupVersion.version !== "string" ||
            typeof groupVersion.membership !== "string"
          )
            throw new Error(
              "Could not check group event updates. Tap Refresh.",
            );
          const previousMembership = checkedMembership.current;
          checkedMembership.current = { uid, key: groupVersion.membership };
          if (
            previousMembership?.uid === uid &&
            previousMembership.key !== groupVersion.membership
          ) {
            scheduleCache.clear();
            setSelectedId(null);
            setPicked(null);
            setRecords({
              scope: "",
              query: "",
              data: {
                venues: [],
                windowDays: 31,
                nextCursor: null,
              },
            });
          }
          const saved = completedView.current;
          if (
            saved.key === queryKey &&
            saved.reload === reload &&
            saved.groupVersion === groupVersion.version &&
            Date.now() - saved.at < 180000
          ) {
            setError("");
            return;
          }
          if (saved.groupVersion !== groupVersion.version)
            scheduleCache.clear();
          setLoading(true);
          setError("");
          setClock(Date.now());
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
            completedView.current = {
              key: queryKey,
              at: Date.now(),
              reload,
              groupVersion: groupVersion.version,
            };
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
      // Check when this view opens, its area changes, or Refresh is tapped.
      // Cache expiry is checked on the next action; it schedules no requests.
      void refresh();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => {
        active = false;
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

  useEffect(() => {
    setSelectedId(null);
    setPicked(null);
    setFocusRequest(null);
    setPanelMode("peek");
    setDirectionsError("");
  }, [scope]);

  const selectVenue = useCallback(
    (id: string) => {
      const venue = venues.find((item) => item.id === id);
      if (!venue) return;
      Keyboard.dismiss();
      setSelectedId(id);
      setPicked({ scope, venue });
      setPanelMode((mode) => (mode === "peek" ? "half" : mode));
      setFocusRequest((old) => ({
        id: (old?.id ?? 0) + 1,
        coordinate: { ...venue.coordinate },
      }));
      setDirectionsError("");
      detailsScroll.current?.scrollTo({ y: 0, animated: false });
    },
    [venues, scope],
  );

  function closePanel() {
    setSelectedId(null);
    setPicked(null);
    setFocusRequest(null);
    setPanelMode("peek");
    setDirectionsError("");
  }

  async function openDirections() {
    if (!selected) return;
    const destination = encodeURIComponent(
      `${selected.coordinate.latitude},${selected.coordinate.longitude}`,
    );
    try {
      setDirectionsError("");
      await Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${destination}`,
      );
    } catch {
      setDirectionsError("Could not open Google Maps. Please try again.");
    }
  }

  async function goToCurrentLocation() {
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.mapHeader}>
        <View style={styles.searchRow}>
          <MapPlaceSearch
            key={profileKey}
            uid={uid}
            center={region}
            onChoose={chooseCenter}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Activity filters"
            accessibilityState={{ expanded: filtersOpen }}
            style={[styles.filterButton, interestsOnly && styles.activeChip]}
            onPress={() => {
              Keyboard.dismiss();
              setFiltersOpen(true);
            }}
          >
            <SymbolView
              name={{
                ios: "line.3.horizontal.decrease",
                android: "tune",
                web: "tune",
              }}
              size={21}
              tintColor={interestsOnly ? colors.background : colors.text}
            />
          </Pressable>
        </View>
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use my location"
            accessibilityState={{ disabled: locating, busy: locating }}
            disabled={locating}
            onPress={() => void goToCurrentLocation()}
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
            {([0.2, 0.5, 2] as const).map((distance) => {
              const expected = initialMapRegion(region, distance).latitudeDelta;
              const active =
                Math.abs(region.latitudeDelta - expected) < expected * 0.08;
              const label =
                distance < 1
                  ? `${Math.round(distance * 1000)}m`
                  : `${distance}km`;
              return (
                <Pressable
                  key={distance}
                  accessibilityRole="radio"
                  accessibilityLabel={`Zoom to about ${distance < 1 ? Math.round(distance * 1000) + " m" : distance + " km"}`}
                  accessibilityState={{ checked: active }}
                  style={[styles.distanceOption, active && styles.activeChip]}
                  onPress={() =>
                    setZoomRequest((old) => ({
                      radiusKm: distance,
                      id: old.id + 1,
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
            disabled={loading}
            accessibilityState={{ disabled: loading }}
            style={styles.iconButton}
            onPress={() => setReload((n) => n + 1)}
          >
            {loading ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <SymbolView
                name={{
                  ios: "arrow.clockwise",
                  android: "refresh",
                  web: "refresh",
                }}
                size={19}
                tintColor={colors.text}
              />
            )}
          </Pressable>
        </View>
      </View>
      <View style={styles.mapAndPanel} testID="map-and-panel">
        <View
          style={[
            styles.mapFrame,
            {
              flex: panelMode === "peek" ? 1 : 1 - panelShare,
            },
          ]}
          testID="map-frame"
        >
          <EventMap
            center={center}
            recenterKey={recenterKey}
            radiusKm={radiusKm}
            zoomRequest={zoomRequest}
            events={mapPoints}
            selectedId={selected?.id || null}
            focusRequest={focusRequest}
            theme={theme}
            colors={colors}
            showUserLocation={locationPermission}
            onMove={handleMapMove}
            onSelect={selectVenue}
            compact
          />
        </View>
        <View
          style={[
            styles.panel,
            panelMode === "peek"
              ? [
                  styles.peekPanel,
                  { height: Math.ceil(72 * Math.max(1, fontScale)) },
                ]
              : { flex: panelShare },
          ]}
          testID="activity-panel"
        >
          <View style={styles.panelHeader}>
            <View style={styles.panelTitleGroup}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={styles.panelTitle}
              >
                {selected?.title ||
                  `${venues.length} ${venues.length === 1 ? "place" : "places"} in view`}
              </Text>
              <Text
                accessibilityLiveRegion="polite"
                numberOfLines={1}
                style={styles.help}
              >
                {error
                  ? "Activity updates unavailable"
                  : searchPending
                    ? "Updating activities…"
                    : interestsOnly
                      ? "Matching your interests"
                      : selected
                        ? "Activities and dates"
                        : "Tap a pin or browse places"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                panelMode === "peek"
                  ? "Show activities"
                  : panelMode === "expanded"
                    ? "Reduce activity panel"
                    : "Expand activity panel"
              }
              accessibilityState={{ expanded: panelMode !== "peek" }}
              style={styles.panelButton}
              onPress={() =>
                setPanelMode((mode) =>
                  mode === "peek"
                    ? "half"
                    : mode === "half"
                      ? "expanded"
                      : "half",
                )
              }
            >
              <Text style={styles.link}>
                {panelMode === "peek"
                  ? "Show"
                  : panelMode === "expanded"
                    ? "Less"
                    : "Expand"}
              </Text>
            </Pressable>
            {panelMode !== "peek" && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close activity panel"
                style={styles.panelButton}
                onPress={closePanel}
              >
                <Text style={styles.link}>Close</Text>
              </Pressable>
            )}
          </View>
          <ScrollView
            ref={detailsScroll}
            style={[
              styles.panelScroll,
              panelMode === "peek" && { display: "none" },
            ]}
            contentContainerStyle={styles.panelContent}
            scrollEnabled={panelMode !== "peek"}
            showsVerticalScrollIndicator={panelMode !== "peek"}
            keyboardShouldPersistTaps="handled"
            accessibilityElementsHidden={panelMode === "peek"}
            importantForAccessibility={
              panelMode === "peek" ? "no-hide-descendants" : "auto"
            }
          >
            {selected ? (
              <>
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
                  onMediaChange={reportMedia}
                />
                <Text style={styles.body}>{selected.location}</Text>
                <View style={styles.venueActions}>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.textButton}
                    onPress={() => {
                      setSelectedId(null);
                      setPicked(null);
                      setFocusRequest(null);
                    }}
                  >
                    <Text style={styles.link}>‹ Places</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${selected.title} in Google Maps`}
                    style={styles.textButton}
                    onPress={() => void openDirections()}
                  >
                    <Text style={styles.link}>Open in Google Maps ↗</Text>
                  </Pressable>
                </View>
                {!!directionsError && (
                  <Text accessibilityRole="alert" style={styles.body}>
                    {directionsError}
                  </Text>
                )}
              </>
            ) : (
              <>
                {!user && (
                  <View style={styles.notice}>
                    <Text style={styles.body}>
                      Sign in to view community activities.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      style={styles.textButton}
                      onPress={() => router.push("/profile")}
                    >
                      <Text style={styles.link}>Go to profile</Text>
                    </Pressable>
                  </View>
                )}
                {!!user &&
                  !searchPending &&
                  !error &&
                  !preparing &&
                  !venues.length && (
                    <View style={styles.notice}>
                      <Text style={styles.eventTitle}>
                        No matching activities in this view
                      </Text>
                      <Text style={styles.body}>
                        Zoom out, move the map or choose All activities. More
                        community calendars will be added as coverage grows.
                      </Text>
                    </View>
                  )}

                {venues.slice(0, placesShown).map((venue) => (
                  <Pressable
                    key={venue.id}
                    accessibilityRole="button"
                    accessibilityLabel={"Show activities at " + venue.title}
                    style={styles.card}
                    onPress={() => selectVenue(venue.id)}
                  >
                    <Text style={styles.eventTitle}>{venue.title}</Text>
                    <Text style={styles.body}>{venue.location}</Text>
                    <Text style={styles.link}>
                      {distanceLabel(venue.distance)}
                    </Text>
                    <Text style={styles.body}>
                      Next: {venue.nextSession.title}
                    </Text>
                    <Text style={styles.help}>
                      {sessionTime(venue.nextSession)}
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
              </>
            )}
            {(locationIssue || error) && (
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
              </View>
            )}
          </ScrollView>
        </View>
      </View>
      <Modal
        visible={filtersOpen}
        animationType="slide"
        onRequestClose={() => setFiltersOpen(false)}
      >
        <ModalSafeArea edges={["top", "bottom"]} style={styles.container}>
          <View style={styles.filterHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Activity filters
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={() => setFiltersOpen(false)}
            >
              <Text style={styles.link}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.panelContent}>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: !interestsOnly }}
                style={[styles.chip, !interestsOnly && styles.activeChip]}
                onPress={() => setUseInterests(false)}
              >
                <Text
                  style={[styles.chipText, !interestsOnly && styles.activeText]}
                >
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
                <Text
                  style={[styles.chipText, interestsOnly && styles.activeText]}
                >
                  My interests
                </Text>
              </Pressable>
            </View>
            {!interests.length && (
              <Text style={styles.body}>
                {user
                  ? "You haven’t saved any interests yet. Choose interests in Search to use this filter."
                  : "Sign in and save interests to use My interests."}
              </Text>
            )}
            {!!interests.length && (
              <Text style={styles.body}>
                My interests shows activities matching your saved choices.
              </Text>
            )}
            {!interests.length && !!user && (
              <Pressable
                accessibilityRole="button"
                style={styles.textButton}
                onPress={() => {
                  setFiltersOpen(false);
                  router.push("/search");
                }}
              >
                <Text style={styles.link}>Choose interests in Search</Text>
              </Pressable>
            )}

            <Text style={styles.body}>
              Upcoming activities for the next 31 days.
            </Text>
          </ScrollView>
        </ModalSafeArea>
      </Modal>
    </KeyboardAvoidingView>
  );
}

