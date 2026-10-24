import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EventMap from "../../components/event-map";
import { AreaField } from "../../components/area-field";
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
  type EventResponse,
  type EventVenue,
} from "../../lib/map-events";

const DEFAULT_AREA: AreaSelection = { cityId: "on-20002", districtId: null };
const RADII = [2, 5, 10, 25];

function areaFor(selection: AreaSelection | null) {
  return resolveArea(selection) || resolveArea(DEFAULT_AREA)!;
}

export default function MapScreen() {
  const { colors, theme } = useAppTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const profileSelection = user ? selectionForProfile(user) : null;
  const profileKey = [
    user?.id || "",
    profileSelection?.cityId || "",
    profileSelection?.districtId || "",
  ].join("|");
  const initial = areaFor(profileSelection);
  const [selection, setSelection] = useState<AreaSelection | null>(
    profileSelection || DEFAULT_AREA,
  );
  const [center, setCenter] = useState<Coordinates>(initial.coordinate);
  const [areaName, setAreaName] = useState(
    [initial.district, initial.city].filter(Boolean).join(", "),
  );
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
  const queryKey = [uid, center.latitude, center.longitude, radiusKm].join("|");
  const [records, setRecords] = useState<{ key: string; data: EventResponse }>({
    key: "",
    data: { events: [] },
  });
  const data = records.key === queryKey ? records.data : { events: [] };
  const interests = useMemo(() => user?.interests || [], [user?.interests]);
  const interestsOnly = useInterests && interests.length > 0;
  const pendingCenter = useRef(center);
  const locationRequest = useRef(0);
  const mounted = useRef(true);
  const venues = useMemo(
    () =>
      venuesFor(data.events, center, radiusKm, interests, interestsOnly, clock),
    [data.events, center, radiusKm, interests, interestsOnly, clock],
  );
  const selected = venues.find((venue) => venue.id === selectedId);
  const sources = data.sources || [];
  const preparing = sources.some(
    (source) => !source.ready && source.refreshing,
  );
  const savedSources = sources.filter((source) => source.ready && source.stale);
  const unavailable = sources.filter(
    (source) => !source.ready && !source.refreshing,
  );

  function chooseCenter(
    coordinate: Coordinates,
    name: string,
    nextSelection: AreaSelection | null,
  ) {
    locationRequest.current++;
    setLocating(false);
    setCenter({ ...coordinate });
    pendingCenter.current = coordinate;
    setAreaName(name);
    setSelection(nextSelection);
    setMapMoved(false);
    setSelectedId(null);
    setLocationIssue("");
    setShowSettings(false);
    setPlacesShown(8);
    setError("");
  }

  useEffect(() => {
    const nextSelection = user ? selectionForProfile(user) : null;
    const area = areaFor(nextSelection);
    chooseCenter(
      area.coordinate,
      [area.district, area.city].filter(Boolean).join(", "),
      nextSelection || DEFAULT_AREA,
    );
    setUseInterests(false);
    setLocationPermission(false);
    // Profile changes reset the search; manual panning does not change the profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey]);

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
          const query = new URLSearchParams({
            latitude: String(center.latitude),
            longitude: String(center.longitude),
            radiusKm: String(radiusKm),
            days: "31",
          });
          const response = await apiRequest<EventResponse>(
            account,
            "GET",
            undefined,
            "/api/events?" + query.toString(),
          );
          if (!Array.isArray(response.events))
            throw new Error(
              "Events are temporarily unavailable. Please try again.",
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
      const timer = setInterval(() => void refresh(), 30000);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => {
        active = false;
        clearInterval(timer);
        subscription.remove();
      };
    }, [uid, queryKey, center.latitude, center.longitude, radiusKm, reload]),
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
          "Location permission wasn't granted. You can choose an area instead.",
        );
        setShowSettings(!permission.canAskAgain);
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        if (isCurrent())
          setLocationIssue(
            "Turn on location services, or choose an area instead.",
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
      chooseCenter(coordinate, "your current location", null);
    } catch {
      if (isCurrent())
        setLocationIssue(
          "We couldn't get your location. Try again, or choose an area below.",
        );
    } finally {
      if (timeout) clearTimeout(timeout);
      if (isCurrent()) setLocating(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 28 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>R</Text>
        </View>
        <Text style={styles.brand}>ReIdentify</Text>
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        Nearby activities
      </Text>
      <Text style={styles.subtitle}>
        Find something to enjoy, somewhere near you.
      </Text>
      <AreaField
        value={selection}
        onChange={(value) => {
          const area = resolveArea(value);
          if (area)
            chooseCenter(
              area.coordinate,
              [area.district, area.city].filter(Boolean).join(", "),
              value,
            );
        }}
      />
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use my location"
          accessibilityState={{ disabled: locating }}
          disabled={locating}
          onPress={() => void useCurrentLocation()}
          style={styles.primaryButton}
        >
          {locating && <ActivityIndicator color={colors.background} />}
          <Text style={styles.primaryText}>
            {locating ? "Finding location…" : "Use my location"}
          </Text>
        </Pressable>
        {!!profileSelection && (
          <Pressable
            accessibilityRole="button"
            style={styles.outlineButton}
            onPress={() => {
              const area = areaFor(profileSelection);
              chooseCenter(
                area.coordinate,
                [area.district, area.city].filter(Boolean).join(", "),
                profileSelection,
              );
            }}
          >
            <Text style={styles.link}>My saved area</Text>
          </Pressable>
        )}
      </View>
      {!!locationIssue && (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.body}>
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
              <Text style={styles.link}>Open settings</Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.headingRow}>
        <Text style={[styles.label, styles.flex]}>
          Searching near {areaName}
        </Text>
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
      {!!error && (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.body}>
            {error}
          </Text>
          {!!data.events.length && (
            <Text style={styles.help}>
              Previously loaded activities are shown below.
            </Text>
          )}
        </View>
      )}
      {preparing && (
        <Text accessibilityLiveRegion="polite" style={styles.help}>
          Community calendars are being prepared. This page will update
          automatically.
        </Text>
      )}
      {!!savedSources.length && (
        <Text style={styles.help}>
          Saved listings from{" "}
          {savedSources.map((source) => source.name).join(", ")} are shown while
          updates are unavailable.
        </Text>
      )}
      {!!unavailable.length && (
        <Text style={styles.help}>
          {unavailable.map((source) => source.name).join(", ")} listings are
          temporarily unavailable.
        </Text>
      )}
      <View style={styles.mapFrame}>
        <EventMap
          center={center}
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
            onPress={() =>
              chooseCenter(pendingCenter.current, "the selected map area", null)
            }
          >
            <Text style={styles.link}>Search this area</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.help}>
        One pin per venue. Tap a pin to see activities and upcoming dates.
        {Platform.OS !== "web"
          ? " Move the map, then tap Search this area to explore."
          : ""}
      </Text>
      {selected && (
        <VenueSchedule key={selected.id} venue={selected} styles={styles} />
      )}
      <Text style={styles.label}>Distance</Text>
      <View style={styles.row}>
        {RADII.map((radius) => (
          <Pressable
            key={radius}
            accessibilityRole="button"
            accessibilityLabel={"Within " + radius + " kilometres"}
            accessibilityState={{ selected: radiusKm === radius }}
            style={[styles.chip, radiusKm === radius && styles.activeChip]}
            onPress={() => {
              setRadiusKm(radius);
              setPlacesShown(8);
              setMapMoved(false);
            }}
          >
            <Text
              style={[
                styles.chipText,
                radiusKm === radius && styles.activeText,
              ]}
            >
              {radius} km
            </Text>
          </Pressable>
        ))}
      </View>
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
        {radiusKm} km
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
              setRadiusKm(25);
              setUseInterests(false);
            }}
          >
            <Text style={styles.link}>Show all activities within 25 km</Text>
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
            {venue.activities.length}{" "}
            {venue.activities.length === 1 ? "activity" : "activities"} ·{" "}
            {distanceLabel(venue.distance)}
          </Text>
          <Text style={styles.body}>Next: {venue.activities[0].title}</Text>
          <Text style={styles.help}>
            {sessionTime(venue.activities[0].sessions[0])}
          </Text>
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
              ? "Details and " + activity.sessions.length + " upcoming dates"
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
    content: { paddingHorizontal: 20, gap: 14 },
    flex: { flex: 1 },
    header: {
      minHeight: 72,
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
    title: { color: colors.text, fontSize: 26, fontWeight: "700" },
    subtitle: { color: colors.muted, fontSize: 16, lineHeight: 24 },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "center",
    },
    headingRow: { flexDirection: "row", gap: 12, alignItems: "center" },
    primaryButton: {
      minHeight: 48,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.accent,
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },
    primaryText: { color: colors.background, fontSize: 16, fontWeight: "700" },
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
      height: 460,
      borderRadius: 18,
      overflow: "hidden",
      borderWidth: 1,
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