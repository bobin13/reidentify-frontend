import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, type MapType, type Region } from "react-native-maps";
import type { AppColors } from "../constants/app-colors";
import { radius, shadow, type } from "../constants/theme";
import { sameMapRegion } from "../lib/map-viewport";
import {
  clusterMapPoints,
  regionForCluster,
  type MapSymbol,
} from "../lib/map-clusters";

export type Coordinates = { latitude: number; longitude: number };
export type MapPoint = {
  id: string;
  title: string;
  location: string;
  coordinate: Coordinates;
};
export type EventMapProps = {
  center: Coordinates;
  radiusKm: number;
  zoomRequest?: { radiusKm: number; id: number };
  focusRequest?: { id: number; coordinate: Coordinates } | null;
  compact?: boolean;
  events: MapPoint[];
  recenterKey?: number;
  selectedId: string | null;
  theme: "light" | "dark";
  colors: AppColors;
  showUserLocation: boolean;
  onSelect: (id: string) => void;
  onMove: (region: Region) => void;
};

const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#191D21" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#A2ADA9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#191D21" }] },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#30373D" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17303A" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#18322C" }],
  },
];
const EMPTY_STYLE: typeof DARK_STYLE = [];

function regionFor(center: Coordinates, radius: number): Region {
  const delta = Math.max(0.002, Math.min(120, (radius * 2.6) / 111));
  return {
    ...center,
    latitudeDelta: delta,
    longitudeDelta: Math.min(
      300,
      delta / Math.max(0.2, Math.cos((center.latitude * Math.PI) / 180)),
    ),
  };
}

function EventMap({
  center,
  recenterKey = 0,
  radiusKm,
  zoomRequest,
  focusRequest,
  compact = false,
  events,
  selectedId,
  theme,
  colors,
  showUserLocation,
  onSelect,
  onMove,
}: EventMapProps) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const map = useRef<MapView>(null);
  const initial = useMemo(
    () => regionFor(center, radiusKm),
    [center.latitude, center.longitude, radiusKm],
  );
  // Keep this native instance on ordinary tab/app returns. Only a deliberate
  // location change replaces it; marker updates and focus do not change its key.
  const nativeKey = [
    center.latitude,
    center.longitude,
    radiusKm,
    recenterKey,
  ].join("|");
  const activeNativeKey = useRef(nativeKey);
  activeNativeKey.current = nativeKey;
  const visibleRegion = useRef(initial);
  const [renderRegion, setRenderRegion] = useState(initial);
  const [mapSize, setMapSize] = useState({ width: 390, height: 500 });
  const [readyKey, setReadyKey] = useState("");
  const ready = readyKey === nativeKey;
  const [mapType, setMapType] = useState<MapType>("standard");
  const [traffic, setTraffic] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [routeError, setRouteError] = useState("");
  const lastZoomRequest = useRef(0);
  const selected = events.find((event) => event.id === selectedId);
  const symbols = useMemo(
    () =>
      clusterMapPoints(
        events,
        renderRegion,
        mapSize.width,
        mapSize.height,
        selectedId,
        100,
      ),
    [events, renderRegion, mapSize, selectedId],
  );

  useEffect(() => {
    visibleRegion.current = initial;
    setRenderRegion(initial);
  }, [nativeKey, initial]);

  useEffect(() => setRouteError(""), [selectedId]);

  const commitRegion = useCallback(
    (next: Region) => {
      if (sameMapRegion(visibleRegion.current, next)) return;
      visibleRegion.current = next;
      setRenderRegion(next);
      onMove(next);
    },
    [onMove],
  );

  useEffect(() => {
    if (!ready || !focusRequest) return;
    // Let the details panel finish changing the canvas size, then centre the
    // selected venue in the visible map. No MapView key or marker tracking changes.
    const timer = setTimeout(() => {
      const next = { ...visibleRegion.current, ...focusRequest.coordinate };
      commitRegion(next);
      map.current?.animateToRegion(next, 300);
    }, 100);
    return () => clearTimeout(timer);
  }, [ready, focusRequest, mapSize.width, mapSize.height, commitRegion]);

  useEffect(() => {
    if (!ready || !zoomRequest || zoomRequest.id === lastZoomRequest.current)
      return;
    lastZoomRequest.current = zoomRequest.id;
    const next = regionFor(visibleRegion.current, zoomRequest.radiusKm);
    commitRegion(next);
    map.current?.animateToRegion(next, 300);
  }, [ready, zoomRequest, commitRegion]);

  function zoom(factor: number) {
    if (!ready) return;
    const previous = visibleRegion.current;
    const next = {
      ...previous,
      latitudeDelta: Math.max(
        0.0005,
        Math.min(120, previous.latitudeDelta * factor),
      ),
      longitudeDelta: Math.max(
        0.0005,
        Math.min(300, previous.longitudeDelta * factor),
      ),
    };
    commitRegion(next);
    map.current?.animateToRegion(next, 250);
  }

  function fitEvents() {
    if (!ready || !events.length) return;
    if (events.length === 1) {
      const next = regionFor(events[0].coordinate, 1);
      commitRegion(next);
      map.current?.animateToRegion(next, 350);
    } else {
      map.current?.fitToCoordinates(
        events.map((event) => event.coordinate),
        {
          edgePadding: { top: 42, right: 82, bottom: 42, left: 42 },
          animated: true,
        },
      );
    }
  }

  function recenter() {
    if (!ready) return;
    const next = regionFor(center, radiusKm);
    commitRegion(next);
    map.current?.animateToRegion(next, 350);
  }

  async function openGoogleMaps() {
    if (!selected) return;
    setRouteError("");
    const destination = encodeURIComponent(
      `${selected.coordinate.latitude},${selected.coordinate.longitude}`,
    );
    try {
      await Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${destination}`,
      );
    } catch {
      setRouteError("Could not open Google Maps. Please try again.");
    }
  }

  return (
    <View style={styles.container}>
      {!compact && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.toolbar}
          contentContainerStyle={styles.tools}
        >
          {(
            [
              { value: "standard", label: "Street" },
              { value: "hybrid", label: "Satellite" },
              ...(Platform.OS === "android"
                ? [{ value: "terrain", label: "Terrain" }]
                : []),
            ] as { value: MapType; label: string }[]
          ).map((item) => (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityLabel={`${item.label} map`}
              accessibilityState={{ selected: mapType === item.value }}
              style={[styles.tool, mapType === item.value && styles.active]}
              onPress={() => setMapType(item.value)}
            >
              <Text
                style={[
                  styles.toolText,
                  mapType === item.value && styles.activeText,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Traffic layer"
            accessibilityState={{ selected: traffic }}
            style={[styles.tool, traffic && styles.active]}
            onPress={() => setTraffic(!traffic)}
          >
            <Text style={[styles.toolText, traffic && styles.activeText]}>
              Traffic
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fit event pins"
            accessibilityState={{ disabled: !ready || !events.length }}
            disabled={!ready || !events.length}
            style={[styles.tool, (!ready || !events.length) && styles.disabled]}
            onPress={fitEvents}
          >
            <Text style={styles.toolText}>Fit events</Text>
          </Pressable>
        </ScrollView>
      )}
      <View style={styles.canvas}>
        <MapView
          key={nativeKey}
          ref={map}
          style={StyleSheet.absoluteFill}
          initialRegion={initial}
          mapType={mapType}
          userInterfaceStyle={theme}
          customMapStyle={
            theme === "dark" && mapType === "standard"
              ? DARK_STYLE
              : EMPTY_STYLE
          }
          showsUserLocation={showUserLocation}
          showsMyLocationButton={false}
          showsCompass
          showsScale
          showsTraffic={traffic}
          zoomEnabled
          rotateEnabled
          zoomControlEnabled={false}
          toolbarEnabled={false}
          moveOnMarkerPress={false}
          onLayout={({ nativeEvent }) => {
            const { width, height } = nativeEvent.layout;
            if (width > 0 && height > 0)
              setMapSize((old) =>
                old.width === width && old.height === height
                  ? old
                  : { width, height },
              );
          }}
          onMapReady={() => {
            if (activeNativeKey.current === nativeKey) {
              setReadyKey(nativeKey);
              onMove(initial);
            }
          }}
          onRegionChangeComplete={(region) => {
            if (activeNativeKey.current !== nativeKey) return;
            commitRegion(region);
          }}
        >
          {symbols.map((symbol) =>
            symbol.kind === "cluster" ? (
              <ClusterMarker
                key={symbol.id}
                symbol={symbol}
                colors={colors}
                onPress={() => {
                  const next = regionForCluster(symbol, visibleRegion.current);
                  commitRegion(next);
                  map.current?.animateToRegion(next, 300);
                }}
              />
            ) : (
              <Marker
                key={symbol.id}
                identifier={symbol.id}
                coordinate={symbol.point.coordinate}
                title={symbol.point.title}
                description={symbol.point.location}
                pinColor={selectedId === symbol.id ? "#E87561" : "#16796C"}
                zIndex={selectedId === symbol.id ? 2 : 1}
                tracksViewChanges={false}
                onPress={() => onSelect(symbol.id)}
              />
            ),
          )}
        </MapView>
        {compact && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Map view options"
            accessibilityState={{ expanded: showTools }}
            style={styles.mapViewButton}
            onPress={() => setShowTools((value) => !value)}
          >
            <Text style={styles.toolText}>Map view</Text>
          </Pressable>
        )}
        {compact && showTools && (
          <View
            style={[
              styles.mapMenu,
              { maxHeight: Math.max(80, mapSize.height - 20) },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.menuContent}
            >
              <Pressable
                accessibilityRole="button"
                style={styles.tool}
                onPress={() => setShowTools(false)}
              >
                <Text style={styles.toolText}>Done</Text>
              </Pressable>
              {(
                [
                  { value: "standard", label: "Street" },
                  { value: "hybrid", label: "Satellite" },
                  ...(Platform.OS === "android"
                    ? [{ value: "terrain", label: "Terrain" }]
                    : []),
                ] as { value: MapType; label: string }[]
              ).map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label} map`}
                  accessibilityState={{ selected: mapType === item.value }}
                  style={[styles.tool, mapType === item.value && styles.active]}
                  onPress={() => {
                    setMapType(item.value);
                    setShowTools(false);
                  }}
                >
                  <Text
                    style={[
                      styles.toolText,
                      mapType === item.value && styles.activeText,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Traffic layer"
                accessibilityState={{ selected: traffic }}
                style={[styles.tool, traffic && styles.active]}
                onPress={() => setTraffic((value) => !value)}
              >
                <Text style={[styles.toolText, traffic && styles.activeText]}>
                  Traffic
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fit event pins"
                disabled={!ready || !events.length}
                style={[
                  styles.tool,
                  (!ready || !events.length) && styles.disabled,
                ]}
                onPress={() => {
                  fitEvents();
                  setShowTools(false);
                }}
              >
                <Text style={styles.toolText}>Fit events</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Return to search location"
                disabled={!ready}
                style={styles.tool}
                onPress={() => {
                  recenter();
                  setShowTools(false);
                }}
              >
                <Text style={styles.toolText}>Centre</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}
        <View
          style={[styles.zoomTools, compact ? { bottom: 40 } : { top: 10 }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
            disabled={!ready}
            style={styles.square}
            onPress={() => zoom(0.5)}
          >
            <Text style={styles.zoomText}>+</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom out"
            disabled={!ready}
            style={styles.square}
            onPress={() => zoom(2)}
          >
            <Text style={styles.zoomText}>−</Text>
          </Pressable>
          {!compact && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Return to search location"
              disabled={!ready}
              style={styles.square}
              onPress={recenter}
            >
              <Text style={styles.centerText}>Centre</Text>
            </Pressable>
          )}
        </View>
      </View>
      {!compact &&
        (selected ? (
          <View style={styles.selection}>
            <View style={styles.selectionRow}>
              <View style={styles.selectionDetails}>
                <Text numberOfLines={1} style={styles.eventTitle}>
                  {selected.title}
                </Text>
                <Text numberOfLines={1} style={styles.place}>
                  {selected.location}
                </Text>
              </View>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open ${selected.title} in Google Maps`}
                style={styles.mapsLink}
                onPress={() => void openGoogleMaps()}
              >
                <Text style={styles.mapsLinkText}>Open in Google Maps ↗</Text>
              </Pressable>
            </View>
            {!!routeError && (
              <Text accessibilityRole="alert" style={styles.place}>
                {routeError}
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.hint}>
            Tap a pin for details. Tap a number to see its places.
          </Text>
        ))}
    </View>
  );
}
export default memo(EventMap);

const ClusterMarker = memo(function ClusterMarker({
  symbol,
  onPress,
}: {
  symbol: Extract<MapSymbol<MapPoint>, { kind: "cluster" }>;
  colors: AppColors;
  onPress: () => void;
}) {
  return (
    <Marker
      identifier={symbol.id}
      coordinate={symbol.coordinate}
      title={`${symbol.count} places`}
      description="Group of places. Tap to zoom in."
      accessibilityLabel={`${symbol.count} places. Tap to zoom in.`}
      pinColor="#4285F4"
      tracksViewChanges={false}
      onPress={onPress}
      zIndex={3}
    />
  );
});

function createStyles(colors: AppColors) {
  const floating = {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    ...shadow(colors, "raised"),
  } as const;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    toolbar: { flexGrow: 0, flexShrink: 0 },
    tools: { padding: 6, gap: 6, alignItems: "center" },
    tool: {
      minHeight: 40,
      paddingHorizontal: 14,
      justifyContent: "center",
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toolText: { ...type.label, fontSize: 14, color: colors.text },
    active: { backgroundColor: colors.accent, borderColor: colors.accent },
    activeText: { color: colors.background, fontWeight: "700" },
    disabled: { opacity: 0.5 },
    canvas: { flex: 1, minHeight: 0 },
    zoomTools: { position: "absolute", right: 12, gap: 8 },
    mapViewButton: {
      ...floating,
      position: "absolute",
      top: 12,
      right: 12,
      minHeight: 40,
      paddingHorizontal: 14,
      justifyContent: "center",
      borderRadius: radius.pill,
    },
    mapMenu: {
      ...floating,
      position: "absolute",
      top: 12,
      left: 12,
      right: 110,
      borderRadius: radius.md,
    },
    menuContent: { padding: 8, gap: 6 },
    square: {
      ...floating,
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
    },
    zoomText: { color: colors.text, fontSize: 24, lineHeight: 28 },
    centerText: { color: colors.text, fontSize: 11, fontWeight: "700" },
    selection: {
      padding: 12,
      gap: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    eventTitle: { ...type.heading, fontSize: 16, color: colors.text },
    place: { ...type.caption, color: colors.muted },
    selectionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    selectionDetails: { flex: 1, minWidth: 0, gap: 3 },
    mapsLink: {
      maxWidth: "47%",
      minHeight: 44,
      justifyContent: "center",
      paddingVertical: 4,
    },
    mapsLinkText: {
      ...type.label,
      fontSize: 14,
      color: colors.accent,
      fontWeight: "700",
      textAlign: "right",
    },
    hint: { ...type.caption, color: colors.muted, padding: 10 },
  });
}
