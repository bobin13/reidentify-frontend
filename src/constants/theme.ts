import type { TextStyle, ViewStyle } from "react-native";

import type { AppColors } from "./app-colors";

// Shared design tokens. Every screen builds its styles from these so shapes,
// type and depth stay consistent across the app.

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

// Horizontal page gutter used by every screen.
export const gutter = 20;

export const type = {
  // Screen titles.
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.6,
  },
  // Section and sheet titles.
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  // Card titles and row names.
  heading: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  body: { fontSize: 16, lineHeight: 23 },
  // Buttons, chips and tabs.
  label: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 18 },
  // Small uppercase eyebrow above a title.
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
} as const satisfies Record<string, TextStyle>;

// Soft depth. Dark surfaces rely mostly on their lighter fill, so the shadow
// is kept faint there and does the real work in the light theme.
export function shadow(
  colors: AppColors,
  level: "card" | "raised" | "floating" = "card",
): ViewStyle {
  const spec = {
    card: { y: 2, blur: 10, light: 0.06, dark: 0.2, elevation: 2 },
    raised: { y: 6, blur: 16, light: 0.1, dark: 0.3, elevation: 6 },
    floating: { y: 10, blur: 24, light: 0.18, dark: 0.45, elevation: 12 },
  }[level];
  return {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: spec.y },
    shadowOpacity: colors.dark ? spec.dark : spec.light,
    shadowRadius: spec.blur,
    elevation: spec.elevation,
  };
}

// A standard card: filled surface, hairline edge, soft shadow.
export function card(colors: AppColors): ViewStyle {
  return {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    ...shadow(colors, "card"),
  };
}
