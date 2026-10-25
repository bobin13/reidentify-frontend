import { useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, {
  Circle,
  Marker,
  type MapType,
  type Region,
} from "react-native-maps";
import type { AppColors } from "../constants/app-colors";

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
  events: MapPoint[];
  recenterKey?: number;
  selectedId: string | null;
  theme: "light" | "dark";
  colors: AppColors;
  showUserLocation: boolean;
  onSelect: (id: string) => void;
  onMove: (center: Coordinates) => void;
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

export default function EventMap({
  center,
  recenterKey = 0,
  radiusKm,
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
  const initial = useRef(regionFor(center, radiusKm)).current;
  const visibleRegion = useRef(initial);
  const [ready, setReady] = useState(false);
  const [mapType, setMapType] = useState<MapType>("standard");
  const [traffic, setTraffic] = useState(false);
  const [routeError, setRouteError] = useState("");
  const selected = events.find((event) => event.id === selectedId);

  useEffect(() => {
    if (!ready) return;
    const next = regionFor(
      { latitude: center.latitude, longitude: center.longitude },
      radiusKm,
    );
    visibleRegion.current = next;
    map.current?.animateToRegion(next, 350);
  }, [ready, center.latitude, center.longitude, radiusKm, recenterKey]);

  useEffect(() => setRouteError(""), [selectedId]);

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
    visibleRegion.current = next;
    map.current?.animateToRegion(next, 250);
  }

  function fitEvents() {
    if (!ready || !events.length) return;
    if (events.length === 1) {
      const next = regionFor(events[0].coordinate, 1);
      visibleRegion.current = next;
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
    visibleRegion.current = next;
    map.current?.animateToRegion(next, 350);
  }

  async function directions(mode: "transit" | "walking" | "driving") {
    if (!selected) return;
    setRouteError("");
    const destination = encodeURIComponent(
      `${selected.coordinate.latitude},${selected.coordinate.longitude}`,
    );
    try {
      await Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=${mode}`,
      );
    } catch {
      setRouteError("Could not open Google Maps. Please try again.");
    }
  }

  return (
    <View style={styles.container}>
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
      <View style={styles.canvas}>
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          initialRegion={initial}
          mapType={mapType}
          userInterfaceStyle={theme}
          customMapStyle={
            theme === "dark" && mapType === "standard" ? DARK_STYLE : []
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
          onMapReady={() => setReady(true)}
          onRegionChangeComplete={(region) => {
            visibleRegion.current = region;
            onMove({ latitude: region.latitude, longitude: region.longitude });
          }}
        >
          <Circle
            center={center}
            radius={radiusKm * 1000}
            strokeColor={colors.accent}
            fillColor="rgba(22,121,108,0.06)"
            strokeWidth={1}
          />
          {events.map((event) => (
            <Marker
              key={event.id}
              identifier={event.id}
              coordinate={event.coordinate}
              title={event.title}
              description={event.location}
              pinColor={selectedId === event.id ? "#E87561" : "#16796C"}
              zIndex={selectedId === event.id ? 2 : 1}
              onPress={() => onSelect(event.id)}
            />
          ))}
        </MapView>
        <View style={styles.zoomTools}>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to search location"
            disabled={!ready}
            style={styles.square}
            onPress={recenter}
          >
            <Text style={styles.centerText}>Centre</Text>
          </Pressable>
        </View>
      </View>
      {selected ? (
        <View style={styles.selection}>
          <Text numberOfLines={1} style={styles.eventTitle}>
            {selected.title}
          </Text>
          <Text numberOfLines={1} style={styles.place}>
            {selected.location}
          </Text>
          <View style={styles.routes}>
            {(
              [
                { mode: "transit", label: "Transit" },
                { mode: "walking", label: "Walk" },
                { mode: "driving", label: "Drive" },
              ] as const
            ).map((item) => (
              <Pressable
                key={item.mode}
                accessibilityRole="button"
                accessibilityLabel={`${item.label} directions to ${selected.title}`}
                style={styles.routeButton}
                onPress={() => void directions(item.mode)}
              >
                <Text style={styles.toolText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          {!!routeError && (
            <Text accessibilityRole="alert" style={styles.place}>
              {routeError}
            </Text>
          )}
        </View>
      ) : (
        <Text style={styles.hint}>
          Tap an event pin for details and directions.
        </Text>
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    toolbar: { flexGrow: 0, flexShrink: 0 },
    tools: { padding: 6, gap: 6, alignItems: "center" },
    tool: {
      minHeight: 44,
      paddingHorizontal: 12,
      justifyContent: "center",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toolText: { color: colors.text, fontSize: 14, fontWeight: "600" },
    active: { backgroundColor: colors.accent, borderColor: colors.accent },
    activeText: { color: colors.background },
    disabled: { opacity: 0.5 },
    canvas: { flex: 1, minHeight: 160 },
    zoomTools: { position: "absolute", right: 10, top: 10, gap: 6 },
    square: {
      width: 48,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      elevation: 3,
    },
    zoomText: { color: colors.text, fontSize: 27, lineHeight: 32 },
    centerText: { color: colors.text, fontSize: 11, fontWeight: "700" },
    selection: {
      padding: 10,
      gap: 4,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    eventTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
    place: { color: colors.muted, fontSize: 13 },
    routes: { flexDirection: "row", gap: 8, marginTop: 4 },
    routeButton: {
      flex: 1,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    hint: { color: colors.muted, fontSize: 13, padding: 10 },
  });
}