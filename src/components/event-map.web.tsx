import { Text, View } from "react-native";
import type { EventMapProps } from "./event-map";

export default function EventMap({ colors }: EventMapProps) {
  return (
    <View
      style={{
        flex: 1,
        padding: 24,
        justifyContent: "center",
        backgroundColor: colors.surface,
        gap: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>
        Open the mobile app to explore the map
      </Text>

      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
        You can still choose an area and filter the event list here.
      </Text>
    </View>
  );
}