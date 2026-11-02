import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Location from "expo-location";
import {
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
  Linking,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import EventMap from "../../components/event-map";
import type { AppColors } from "../../constants/app-colors";
import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import { apiRequest } from "../../lib/api";
import { groupMapState } from "../../lib/groups";
import {
  ONTARIO_CITIES,
  matchesArea,
  searchText,
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
  const region =
    view.owner === profileKey
      ? view.region
      : initialMapRegion(startingCoordinate, startingRadiusKm);
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
              tintColor={interestsOnly ? colors.background : colors.accent}
            />
            <Text style={[styles.link, interestsOnly && styles.activeText]}>
              Filters
            </Text>
          </Pressable>
        </View>
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use my location"
            accessibilityState={{ disabled: locating, busy: locating }}
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
            style={styles.textButton}
            onPress={() => setReload((n) => n + 1)}
          >
            <Text style={styles.link}>{loading ? "Loading…" : "Refresh"}</Text>
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
        <SafeAreaView edges={["top", "bottom"]} style={styles.container}>
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
        </SafeAreaView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

type Styles = ReturnType<typeof createStyles>;

type SearchPlace = {
  id: string;
  name: string;
  address: string;
  coordinate: Coordinates;
  radiusKm?: number;
};
// Reuse the same offline Ontario catalogue as registration. City searches do
// not need GPS, a geocoding request, or a Firestore read.
const SEARCH_AREAS: SearchPlace[] = ONTARIO_CITIES.flatMap((city) => [
  {
    id: `city:${city.id}`,
    name: city.name,
    address: city.region || "Ontario",
    coordinate: city.coordinate,
    radiusKm: 10,
  },
  ...city.districts.map((district) => ({
    id: `district:${city.id}:${district.id}`,
    name: district.name,
    address: `${city.name}, Ontario`,
    coordinate: district.coordinate,
    radiusKm: 2,
  })),
]);

function MapPlaceSearch({
  uid,
  center,
  onChoose,
}: {
  uid: string;
  center: Coordinates;
  onChoose: (coordinate: Coordinates, radiusKm?: number) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { height } = useWindowDimensions();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<{
    query: string;
    places: SearchPlace[];
    attribution: string;
  }>({ query: "", places: [], attribution: "" });
  const [retry, setRetry] = useState(0);
  const bias = useRef(center);
  bias.current = center;
  const query = text.trim().replace(/\s+/g, " ");
  const local = useMemo(
    () =>
      query.length < 2
        ? []
        : SEARCH_AREAS.filter((place) =>
            matchesArea(query, `${place.name} ${place.address}`),
          )
            .sort(
              (a, b) =>
                Number(searchText(b.name).startsWith(searchText(query))) -
                Number(searchText(a.name).startsWith(searchText(query))),
            )
            .slice(0, 5),
    [query],
  );
  const remote = results.query === query ? results.places : [];
  const choices = local.length ? local : remote;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError("");
      setBusy(false);
      if (!open || query.length < 3 || local.length || !uid) return;
      setBusy(true);
      const timer = setTimeout(() => {
        const account = auth.currentUser;
        if (!account || account.uid !== uid) {
          setBusy(false);
          setError("Sign in to search venues and addresses.");
          return;
        }
        const parameters = new URLSearchParams({
          q: query,
          latitude: String(bias.current.latitude),
          longitude: String(bias.current.longitude),
        });
        void apiRequest<{ suggestions: SearchPlace[]; attribution: string }>(
          account,
          "GET",
          undefined,
          "/api/places/suggestions?" + parameters.toString(),
        )
          .then((response) => {
            if (!active || auth.currentUser?.uid !== uid) return;
            if (!Array.isArray(response.suggestions))
              throw new Error("Could not load places. Try again.");
            const places = response.suggestions.filter(
              (place) =>
                place &&
                typeof place.name === "string" &&
                Number.isFinite(place.coordinate?.latitude) &&
                Number.isFinite(place.coordinate?.longitude),
            );
            setResults({
              query,
              places: places.slice(0, 5),
              attribution:
                response.attribution ||
                "© OpenStreetMap contributors · Photon",
            });
          })
          .catch((issue) => {
            if (active)
              setError(
                issue instanceof Error
                  ? issue.message
                  : "Could not load places. Try again.",
              );
          })
          .finally(() => {
            if (active) setBusy(false);
          });
      }, 650);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [uid, query, open, local, retry]),
  );

  function choose(place: SearchPlace) {
    setOpen(false);
    setText(place.name);
    Keyboard.dismiss();
    onChoose(place.coordinate, place.radiusKm ?? 0.5);
  }
  return (
    <View style={styles.searchBox}>
      <View style={styles.searchInputRow}>
        <SymbolView
          name={{ ios: "magnifyingglass", android: "search", web: "search" }}
          size={21}
          tintColor={colors.muted}
        />
        <TextInput
          accessibilityLabel="Search a city, venue or address"
          placeholder="City, venue or address"
          placeholderTextColor={colors.muted}
          value={text}
          onChangeText={(value) => {
            setText(value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          style={styles.searchInput}
          maxLength={120}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
          selectionColor={colors.accent}
        />
        {!!text && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear place search"
            style={styles.clearSearch}
            onPress={() => {
              setText("");
              setOpen(false);
            }}
          >
            <Text style={styles.link}>×</Text>
          </Pressable>
        )}
      </View>
      {open && (
        <View
          style={[
            styles.suggestions,
            { maxHeight: Math.max(160, Math.min(320, height * 0.45)) },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            {query.length < 2 && (
              <View style={styles.suggestionFooter}>
                <Text style={styles.body}>
                  Enter a city, district, venue or address.
                </Text>
              </View>
            )}
            {choices.map((place) => (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                accessibilityLabel={`Go to ${place.name}, ${place.address}`}
                style={styles.suggestion}
                onPress={() => choose(place)}
              >
                <Text style={styles.eventTitle}>{place.name}</Text>
                <Text style={styles.help}>{place.address}</Text>
              </Pressable>
            ))}
            {busy && (
              <View style={styles.suggestionFooter}>
                <ActivityIndicator
                  accessibilityLabel="Searching places"
                  color={colors.accent}
                />
              </View>
            )}
            {!!error && (
              <View style={styles.suggestionFooter}>
                <Text accessibilityRole="alert" style={styles.body}>
                  {error}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.textButton}
                  onPress={() => setRetry((n) => n + 1)}
                >
                  <Text style={styles.link}>Try again</Text>
                </Pressable>
              </View>
            )}
            {!busy && !error && query.length >= 2 && !choices.length && (
              <View style={styles.suggestionFooter}>
                <Text style={styles.body}>
                  {!uid
                    ? "Sign in to search venues and addresses. City search is available here."
                    : query.length < 3
                      ? "Enter at least three letters for venue or address search."
                      : "No matching places. Try adding the city name."}
                </Text>
              </View>
            )}
            {!!remote.length && !local.length && (
              <View style={styles.suggestionFooter}>
                <Text style={styles.help}>
                  Search data: {results.attribution}
                </Text>
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              style={styles.suggestion}
              onPress={() => {
                setOpen(false);
                Keyboard.dismiss();
              }}
            >
              <Text style={styles.link}>Close search</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

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
const scheduleCache = new Map<string, ScheduleCache>();
function LazyVenueSchedule({
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
  const [loading, setLoading] = useState(!saved || saved.expires <= Date.now());
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
          resizeMode="cover"
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

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, minHeight: 0, backgroundColor: colors.background },
    mapHeader: {
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 8,
      gap: 8,
      zIndex: 20,
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      zIndex: 20,
    },
    filterButton: {
      minHeight: 52,
      paddingHorizontal: 10,
      gap: 4,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    mapAndPanel: { flex: 1, minHeight: 0 },
    panel: {
      minHeight: 0,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
      overflow: "hidden",
    },
    peekPanel: { flexGrow: 0, flexShrink: 0 },
    panelHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 56,
    },
    panelTitleGroup: { flex: 1, minWidth: 0, gap: 3 },
    panelTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
    panelButton: {
      minHeight: 48,
      minWidth: 48,
      paddingHorizontal: 6,
      justifyContent: "center",
      alignItems: "center",
    },
    panelScroll: { flex: 1, minHeight: 0 },
    panelContent: { padding: 14, paddingTop: 4, gap: 12 },
    schedule: { gap: 8 },
    eventPhoto: {
      width: "100%",
      height: 140,
      borderRadius: 12,
      marginBottom: 10,
    },
    timeSlot: { gap: 4, paddingVertical: 6 },
    venueActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    filterHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 18,
      gap: 12,
    },
    searchBox: { flex: 1, minWidth: 0, position: "relative", zIndex: 30 },
    searchInputRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
      minHeight: 52,
      paddingLeft: 12,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      color: colors.text,
      fontSize: 17,
      paddingVertical: 12,
      paddingHorizontal: 8,
    },
    clearSearch: {
      minWidth: 44,
      minHeight: 48,
      justifyContent: "center",
      alignItems: "center",
    },
    suggestions: {
      position: "absolute",
      top: "100%",
      left: 0,
      right: -76,
      marginTop: 6,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      elevation: 8,
      shadowColor: "#000000",
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      overflow: "hidden",
    },
    suggestion: {
      minHeight: 56,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 3,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    suggestionFooter: { padding: 12, gap: 6 },
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
    locationText: { color: colors.background, fontSize: 14, fontWeight: "700" },
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
    distanceText: { color: colors.text, fontSize: 14, fontWeight: "700" },
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
      minHeight: 0,
      overflow: "hidden",
      backgroundColor: colors.surface,
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