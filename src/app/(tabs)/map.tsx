import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

import EventMap, {
  type Coordinates,
  type MapPoint,
} from "../../components/event-map";
import type { AppColors } from "../../constants/app-colors";
import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import { apiRequest } from "../../lib/api";

type CommunityEvent = MapPoint & {
  startsAt: string;
  endsAt: string;
  interests: string[];
  description: string;
};

const AREAS = [
  {
    id: "etobicoke",
    name: "Etobicoke",
    coordinate: {
      latitude: 43.6537,
      longitude: -79.5315,
    },
  },
  {
    id: "toronto",
    name: "Toronto",
    coordinate: {
      latitude: 43.6532,
      longitude: -79.3832,
    },
  },
  {
    id: "north york",
    name: "North York",
    coordinate: {
      latitude: 43.768,
      longitude: -79.4126,
    },
  },
  {
    id: "scarborough",
    name: "Scarborough",
    coordinate: {
      latitude: 43.7731,
      longitude: -79.2578,
    },
  },
];

const RADII = [2, 5, 10, 25];

function initialArea(area: string) {
  const value = area.toLowerCase();

  return (
    AREAS.find(
      (item) =>
        item.id !== "toronto" && value.includes(item.id),
    ) ??
    (value.includes("toronto") ? AREAS[1] : AREAS[0])
  );
}

function distanceKm(a: Coordinates, b: Coordinates) {
  const radians = (value: number) =>
    (value * Math.PI) / 180;

  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);

  const h =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(longitude / 2) ** 2;

  return (
    6371 *
    2 *
    Math.asin(
      Math.sqrt(Math.min(1, Math.max(0, h))),
    )
  );
}

function distanceLabel(distance: number) {
  if (distance < 0.1) return "Under 100 m";
  if (distance < 1) {
    return Math.round(distance * 1000) + " m";
  }
  return distance.toFixed(1) + " km";
}

export default function MapScreen() {
  const { colors, theme } = useAppTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  const startingArea = initialArea(user?.area ?? "");

  const [center, setCenter] = useState<Coordinates>(
    startingArea.coordinate,
  );
  const [areaName, setAreaName] =
    useState(startingArea.name);
  const [areaId, setAreaId] =
    useState<string | null>(startingArea.id);
  const [radiusKm, setRadiusKm] = useState(10);
  const [useInterests, setUseInterests] = useState(true);
  const [selectedId, setSelectedId] =
    useState<string | null>(null);
  const [mapMoved, setMapMoved] = useState(false);

  const [locating, setLocating] = useState(false);
  const [locationPermission, setLocationPermission] =
    useState(false);
  const [locationIssue, setLocationIssue] =
    useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const uid = user?.id || "";

  const [records, setRecords] = useState<{
    owner: string;
    events: CommunityEvent[];
  }>({
    owner: "",
    events: [],
  });

  const [loadingEvents, setLoadingEvents] =
    useState(false);
  const [eventError, setEventError] = useState("");
  const [reload, setReload] = useState(0);
  const [clock, setClock] = useState(Date.now());

  const events =
    records.owner === uid ? records.events : [];

  const interests = useMemo(
    () => user?.interests ?? [],
    [user?.interests],
  );

  const interestsOnly =
    useInterests && interests.length > 0;

  const pendingCenter = useRef(center);
  const locationRequest = useRef(0);
  const mounted = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (!uid) {
        setLoadingEvents(false);
        setEventError("");
        return;
      }

      let active = true;
      let busy = false;

      setLoadingEvents(true);
      setEventError("");

      async function refresh() {
        if (
          !active ||
          busy ||
          (AppState.currentState &&
            AppState.currentState !== "active")
        ) {
          return;
        }

        busy = true;
        setClock(Date.now());

        try {
          const account = auth.currentUser;

          if (!account || account.uid !== uid) {
            throw new Error("Please sign in again.");
          }

          const data = await apiRequest<{
            events: CommunityEvent[];
          }>(
            account,
            "GET",
            undefined,
            "/api/events",
          );

          if (
            active &&
            auth.currentUser?.uid === uid
          ) {
            setRecords({
              owner: uid,
              events: data.events,
            });
            setEventError("");
          }
        } catch (error) {
          if (active) {
            setEventError(
              error instanceof Error
                ? error.message
                : "Could not load events.",
            );
          }
        } finally {
          if (active) setLoadingEvents(false);
          busy = false;
        }
      }

      void refresh();

      const timer = setInterval(
        () => void refresh(),
        60000,
      );

      const subscription = AppState.addEventListener(
        "change",
        (state) => {
          if (state === "active") void refresh();
        },
      );

      return () => {
        active = false;
        clearInterval(timer);
        subscription.remove();
      };
    }, [uid, reload]),
  );

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      locationRequest.current++;
    };
  }, []);

  const visibleEvents = useMemo(
    () =>
      events
        .map((event) => ({
          ...event,
          distance: distanceKm(
            center,
            event.coordinate,
          ),
        }))
        .filter(
          (event) =>
            Date.parse(event.endsAt) > clock &&
            event.distance <= radiusKm &&
            (!interestsOnly ||
              event.interests.some((interest) =>
                interests.includes(interest),
              )),
        )
        .sort((a, b) => a.distance - b.distance),
    [
      events,
      center,
      radiusKm,
      interestsOnly,
      interests,
      clock,
    ],
  );

  const selectedEvent = visibleEvents.find(
    (event) => event.id === selectedId,
  );

  function chooseCenter(
    coordinate: Coordinates,
    name: string,
    id: string | null,
  ) {
    locationRequest.current++;
    setLocating(false);
    setCenter({ ...coordinate });
    pendingCenter.current = coordinate;
    setAreaName(name);
    setAreaId(id);
    setMapMoved(false);
    setSelectedId(null);
    setLocationIssue(null);
    setShowSettings(false);
  }

  const handleMapMove = useCallback(
    (coordinate: Coordinates) => {
      pendingCenter.current = coordinate;
      setMapMoved(
        distanceKm(center, coordinate) > 0.15,
      );
    },
    [center],
  );

  async function useCurrentLocation() {
    const requestId = ++locationRequest.current;

    const isCurrent = () =>
      mounted.current &&
      requestId === locationRequest.current;

    let timeout:
      | ReturnType<typeof setTimeout>
      | undefined;

    setLocating(true);
    setLocationIssue(null);
    setShowSettings(false);

    try {
      const permission =
        await Location.requestForegroundPermissionsAsync();

      if (!isCurrent()) return;

      setLocationPermission(permission.granted);

      if (!permission.granted) {
        setLocationIssue(
          "Location permission wasn't granted. You can choose an area instead.",
        );
        setShowSettings(!permission.canAskAgain);
        return;
      }

      const servicesEnabled =
        await Location.hasServicesEnabledAsync();

      if (!isCurrent()) return;

      if (!servicesEnabled) {
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
            () =>
              reject(
                new Error("Location timed out"),
              ),
            15000,
          );
        }),
      ]);

      if (!isCurrent()) return;

      const { latitude, longitude } =
        position.coords;

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      ) {
        throw new Error("Invalid location");
      }

      chooseCenter(
        { latitude, longitude },
        "Your current location",
        null,
      );
    } catch {
      if (isCurrent()) {
        setLocationIssue(
          "We couldn't get your location. Try again, or choose an area below.",
        );
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (isCurrent()) setLocating(false);
    }
  }

  function changeRadius(value: number) {
    pendingCenter.current = center;
    setMapMoved(false);
    setRadiusKm(value);
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

      <Text
        accessibilityRole="header"
        style={styles.title}
      >
        Nearby events
      </Text>

      <Text style={styles.subtitle}>
        Choose an area or use your location to explore.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use my location"
        accessibilityState={{ disabled: locating }}
        disabled={locating}
        onPress={() => void useCurrentLocation()}
        style={styles.locationButton}
      >
        {locating && (
          <ActivityIndicator
            color={colors.background}
          />
        )}
        <Text style={styles.buttonText}>
          {locating
            ? "Finding your location…"
            : "Use my location"}
        </Text>
      </Pressable>

      {locationIssue && (
        <View
          accessibilityLiveRegion="polite"
          style={styles.notice}
        >
          <Text style={styles.bodyText}>
            {locationIssue}
          </Text>

          {showSettings && (
            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={async () => {
                try {
                  await Linking.openSettings();
                } catch {
                  setLocationIssue(
                    "Open your phone's settings to allow location access, or choose an area.",
                  );
                }
              }}
            >
              <Text style={styles.link}>
                Open settings
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {AREAS.map((area) => (
          <Pressable
            key={area.id}
            accessibilityRole="button"
            accessibilityLabel={
              "Search near " + area.name
            }
            accessibilityState={{
              selected: areaId === area.id,
            }}
            onPress={() =>
              chooseCenter(
                area.coordinate,
                area.name,
                area.id,
              )
            }
            style={[
              styles.chip,
              areaId === area.id &&
                styles.activeChip,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                areaId === area.id &&
                  styles.activeChipText,
              ]}
            >
              {area.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.areaLabel}>
        Searching near {areaName}
      </Text>

      {loadingEvents && (
        <ActivityIndicator
          accessibilityLabel="Loading community events"
          color={colors.accent}
        />
      )}

      {!!eventError && (
        <View style={styles.notice}>
          <Text
            accessibilityRole="alert"
            style={styles.bodyText}
          >
            {eventError}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reload community events"
            style={styles.textButton}
            onPress={() =>
              setReload((value) => value + 1)
            }
          >
            <Text style={styles.link}>
              Try loading events again
            </Text>
          </Pressable>
        </View>
      )}

      <View style={styles.mapFrame}>
        <EventMap
          center={center}
          radiusKm={radiusKm}
          events={visibleEvents}
          selectedId={selectedEvent?.id ?? null}
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
            onPress={() =>
              chooseCenter(
                pendingCenter.current,
                "the selected map area",
                null,
              )
            }
            style={styles.searchAreaButton}
          >
            <Text style={styles.link}>
              Search this area
            </Text>
          </Pressable>
        )}
      </View>

      {Platform.OS !== "web" && (
        <Text style={styles.helpText}>
          Move the map, then tap Search this area
          to update nearby events.
        </Text>
      )}

      <Text style={styles.filterLabel}>
        Distance from search location
      </Text>

      <View style={styles.radiusRow}>
        {RADII.map((radius) => (
          <Pressable
            key={radius}
            accessibilityRole="button"
            accessibilityLabel={
              "Within " + radius + " kilometres"
            }
            accessibilityState={{
              selected: radiusKm === radius,
            }}
            onPress={() => changeRadius(radius)}
            style={[
              styles.radiusChip,
              radiusKm === radius &&
                styles.activeChip,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                radiusKm === radius &&
                  styles.activeChipText,
              ]}
            >
              {radius} km
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.interestRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="All interests"
          accessibilityState={{
            selected: !interestsOnly,
          }}
          onPress={() => setUseInterests(false)}
          style={[
            styles.interestChip,
            !interestsOnly && styles.activeChip,
          ]}
        >
          <Text
            style={[
              styles.chipText,
              !interestsOnly &&
                styles.activeChipText,
            ]}
          >
            All interests
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="My interests"
          accessibilityState={{
            selected: interestsOnly,
            disabled: !interests.length,
          }}
          disabled={!interests.length}
          onPress={() => setUseInterests(true)}
          style={[
            styles.interestChip,
            interestsOnly && styles.activeChip,
            !interests.length && styles.disabled,
          ]}
        >
          <Text
            style={[
              styles.chipText,
              interestsOnly &&
                styles.activeChipText,
            ]}
          >
            My interests
          </Text>
        </Pressable>
      </View>

      {!interests.length && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add interests in Profile"
          onPress={() => router.push("/profile")}
          style={styles.textButton}
        >
          <Text style={styles.link}>
            Add interests in Profile to personalise events.
          </Text>
        </Pressable>
      )}

      <View style={styles.eventList}>
        <Text
          accessibilityRole="header"
          style={styles.sectionTitle}
        >
          {visibleEvents.length}{" "}
          {visibleEvents.length === 1
            ? "event"
            : "events"}{" "}
          within {radiusKm} km
        </Text>

        <Text style={styles.helpText}>
          Published ReIdentify events · Transit,
          walking and driving directions open in Google Maps.
        </Text>

        <Text style={styles.helpText}>
          Distances are straight-line estimates
          from the search location.
        </Text>

        {!user && (
          <View style={styles.notice}>
            <Text style={styles.bodyText}>
              Sign in to view published community events.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={() => router.push("/profile")}
            >
              <Text style={styles.link}>
                Go to profile
              </Text>
            </Pressable>
          </View>
        )}

        {!!user &&
          !loadingEvents &&
          !eventError &&
          !visibleEvents.length && (
            <View style={styles.notice}>
              <Text style={styles.eventTitle}>
                No matching events nearby
              </Text>
              <Text style={styles.bodyText}>
                Try a larger distance, All interests,
                or another area. Published events added
                to ReIdentify will appear here.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset event filters"
                style={styles.textButton}
                onPress={() => {
                  setRadiusKm(25);
                  setUseInterests(false);
                }}
              >
                <Text style={styles.link}>
                  Show all interests within 25 km
                </Text>
              </Pressable>
            </View>
          )}

        {visibleEvents.map((event) => (
          <Pressable
            key={event.id}
            accessibilityRole="button"
            accessibilityLabel={
              "Show event details for " + event.title
            }
            accessibilityState={{
              expanded:
                selectedEvent?.id === event.id,
            }}
            onPress={() =>
              setSelectedId(
                selectedEvent?.id === event.id
                  ? null
                  : event.id,
              )
            }
            style={({ pressed }) => [
              styles.eventCard,
              selectedEvent?.id === event.id &&
                styles.selectedCard,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.eventTitle}>
              {event.title}
            </Text>

            <Text style={styles.bodyText}>
              {new Date(event.startsAt).toLocaleString(
                "en-CA",
                {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                },
              )}
            </Text>

            <Text style={styles.bodyText}>
              {event.location}
            </Text>

            <Text style={styles.distanceText}>
              {distanceLabel(event.distance)} from search location
            </Text>

            <View style={styles.tags}>
              {event.interests.map((interest) => (
                <Text
                  key={interest}
                  style={styles.tag}
                >
                  {interest}
                </Text>
              ))}
            </View>

            {selectedEvent?.id === event.id && (
              <Text style={styles.bodyText}>
                {event.description}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: { paddingHorizontal: 20, gap: 14 },
    header: {
      minHeight: 72,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      marginBottom: 4,
    },
    logo: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: "#1D7566",
      justifyContent: "center",
      alignItems: "center",
    },
    logoText: {
      color: "#FFFFFF",
      fontSize: 28,
      fontWeight: "700",
      fontFamily: "serif",
    },
    brand: {
      color: colors.text,
      fontSize: 19,
      fontWeight: "700",
    },
    title: {
      color: colors.text,
      fontSize: 26,
      fontWeight: "700",
    },
    subtitle: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 24,
    },
    locationButton: {
      alignSelf: "flex-start",
      minHeight: 48,
      paddingVertical: 12,
      paddingHorizontal: 18,
      backgroundColor: colors.accent,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    buttonText: {
      color: colors.background,
      fontSize: 16,
      fontWeight: "700",
    },
    notice: {
      padding: 16,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      gap: 10,
    },
    bodyText: {
      color: colors.muted,
      fontSize: 15,
      lineHeight: 23,
    },
    link: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: "700",
      lineHeight: 22,
    },
    textButton: {
      minHeight: 44,
      justifyContent: "center",
      alignSelf: "flex-start",
    },
    chipRow: { gap: 8, paddingVertical: 3 },
    chip: {
      paddingHorizontal: 16,
      minHeight: 44,
      justifyContent: "center",
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "600",
    },
    activeChip: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    activeChipText: {
      color: colors.background,
    },
    areaLabel: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "600",
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
      alignSelf: "flex-start",
      minHeight: 44,
      paddingHorizontal: 18,
      justifyContent: "center",
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      elevation: 4,
    },
    helpText: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 20,
    },
    filterLabel: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    radiusRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    radiusChip: {
      minHeight: 44,
      paddingHorizontal: 15,
      justifyContent: "center",
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    interestRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    interestChip: {
      minHeight: 44,
      paddingHorizontal: 16,
      justifyContent: "center",
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    disabled: { opacity: 0.5 },
    eventList: { gap: 12, marginTop: 4 },
    sectionTitle: {
      color: colors.text,
      fontSize: 21,
      fontWeight: "700",
    },
    eventCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 16,
      backgroundColor: colors.surface,
      gap: 10,
    },
    selectedCard: {
      borderColor: colors.accent,
      borderWidth: 2,
    },
    pressed: { opacity: 0.75 },
    eventTitle: {
      color: colors.text,
      fontSize: 18,
      lineHeight: 26,
      fontWeight: "700",
    },
    distanceText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: "600",
    },
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    tag: {
      color: colors.muted,
      fontSize: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
    },
  });
}