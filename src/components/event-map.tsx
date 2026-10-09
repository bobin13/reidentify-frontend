import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";
import type { AppColors } from "../constants/app-colors";

export type Coordinates = {
  latitude: number;
  longitude: number;
};

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
  selectedId: string | null;
  theme: "light" | "dark";
  colors: AppColors;
  showUserLocation: boolean;
  onSelect: (id: string) => void;
  onMove: (center: Coordinates) => void;
};

function regionFor(center: Coordinates, radiusKm: number) {
  const latitudeDelta = (radiusKm * 2.6) / 111;

  return {
    ...center,
    latitudeDelta,
    longitudeDelta:
      latitudeDelta /
      Math.max(0.2, Math.cos((center.latitude * Math.PI) / 180)),
  };
}

const DARK_MAP_STYLE = [
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

export default function EventMap({
  center,
  radiusKm,
  events,
  selectedId,
  theme,
  colors,
  showUserLocation,
  onSelect,
  onMove,
}: EventMapProps) {
  const map = useRef<MapView>(null);
  const initialRegion = useRef(regionFor(center, radiusKm)).current;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) {
      map.current?.animateToRegion(regionFor(center, radiusKm), 400);
    }
  }, [ready, center, radiusKm]);

  return (
    <MapView
      key="basic-map-test"
      style={{ width: "100%", height: "100%" }}
      initialRegion={initialRegion}
      onLayout={({ nativeEvent }) => {
        console.log(
          "MAP_SIZE",
          nativeEvent.layout.width,
          nativeEvent.layout.height
        );
      }}
      onMapReady={() => {
        console.log("MAP_READY");
      }}
    />
  );
}