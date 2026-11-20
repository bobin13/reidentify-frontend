import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker } from "react-native-maps";

type Point = { latitude: number; longitude: number };
export default function VenueMap({
  center,
  pin,
  theme,
  onMove,
  onPick,
}: {
  center: Point;
  pin: Point | null;
  theme: "light" | "dark";
  onMove?: (point: Point) => void;
  onPick: (point: Point) => void;
}) {
  const map = useRef<MapView>(null),
    [ready, setReady] = useState(false);
  // The first region only; later moves animate from the effect below.
  const [initial] = useState(() => ({
    ...center,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  }));
  useEffect(() => {
    if (ready)
      map.current?.animateToRegion(
        { ...center, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        350,
      );
  }, [ready, center.latitude, center.longitude]);
  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={initial}
        userInterfaceStyle={theme}
        showsCompass
        zoomControlEnabled
        onMapReady={() => setReady(true)}
        onRegionChangeComplete={
          onMove
            ? (region) =>
                onMove({
                  latitude: region.latitude,
                  longitude: region.longitude,
                })
            : undefined
        }
        onPress={(event) => onPick(event.nativeEvent.coordinate)}
      >
        {pin && <Marker coordinate={pin} title="Public meeting point" />}
      </MapView>
    </View>
  );
}

