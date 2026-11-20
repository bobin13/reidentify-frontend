import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import { AuthProvider } from "../context/auth-context";
import { ErrorScreen } from "../components/error-screen";
import {
  ThemeProvider,
  useAppTheme,
} from "../context/theme-context";

// A screen that throws while rendering shows a retry screen instead of a
// blank or red screen.
export const ErrorBoundary = ErrorScreen;

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ThemedRootLayout />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedRootLayout() {
  const { colors, theme } = useAppTheme();

  return (
    <SafeAreaView
      edges={["top"]}
      style={{
        flex: 1,
        backgroundColor: colors.background,
      }}
    >
      {/* Explicit, because app.json pins the native style to dark. */}
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      />
    </SafeAreaView>
  );
}