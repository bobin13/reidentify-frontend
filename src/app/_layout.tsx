import { Stack } from "expo-router";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../constants/app-colors";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SafeAreaView
        edges={["top"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.background },
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            headerTitleStyle: { color: colors.text },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen
            name="conversation/[id]"
            options={{ title: "Conversation" }}
          />
        </Stack>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
