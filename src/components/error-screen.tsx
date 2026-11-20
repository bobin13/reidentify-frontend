import type { ErrorBoundaryProps } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { darkColors as colors } from "../constants/app-colors";
import { radius, type } from "../constants/theme";

// Shown instead of a blank or red screen when a screen throws while
// rendering. It is exported as the root layout's ErrorBoundary, so it sits
// outside the theme and safe-area providers: colours and spacing are fixed.
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.root} accessibilityRole="alert">
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>
        ReIdentify hit an unexpected problem. Try again, and if it keeps
        happening, close and reopen the app.
      </Text>
      {__DEV__ && (
        <Text style={styles.detail} selectable>
          {error.message}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 28,
    backgroundColor: colors.background,
  },
  title: { ...type.title, color: colors.text },
  body: { fontSize: 16, lineHeight: 23, color: colors.muted },
  detail: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
    fontFamily: "Menlo",
  },
  button: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  pressed: { opacity: 0.8 },
  buttonText: { fontSize: 16, fontWeight: "700", color: colors.background },
});
