import { StyleSheet } from "react-native";

import type { AppColors } from "../../constants/app-colors";
import {
  card,
  gutter,
  radius,
  shadow,
  type,
} from "../../constants/theme";

export function createStyles(colors: AppColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: gutter,
      paddingBottom: 30,
    },
    pressed: {
      opacity: 0.8,
    },

    // Brand bar
    header: {
      minHeight: 60,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 18,
    },
    brand: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    logo: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    logoText: {
      color: colors.background,
      fontSize: 21,
      lineHeight: 26,
      fontWeight: "800",
    },
    brandText: {
      ...type.heading,
      color: colors.text,
      fontWeight: "700",
    },
    notificationButton: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },

    // Greeting
    date: {
      ...type.eyebrow,
      color: colors.accent,
      marginBottom: 6,
    },
    greeting: {
      ...type.display,
      color: colors.text,
      marginBottom: 22,
    },

    // News feed
    newsSection: {
      gap: 14,
      marginBottom: 28,
    },
    newsHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    newsHeadingTitle: {
      ...type.heading,
      flex: 1,
      minWidth: 0,
      color: colors.text,
    },
    newsDescription: {
      ...type.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
    },
    filters: {
      gap: 8,
      paddingRight: gutter,
    },
    filterChip: {
      minHeight: 40,
      justifyContent: "center",
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    selectedChip: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    filterText: {
      ...type.label,
      fontSize: 14,
      color: colors.text,
    },
    selectedFilterText: {
      ...type.label,
      fontSize: 14,
      color: colors.background,
      fontWeight: "700",
    },
    newsState: {
      ...card(colors),
      padding: 18,
      gap: 12,
    },
    newsStateTitle: {
      ...type.heading,
      color: colors.text,
    },
    retryButton: {
      alignSelf: "flex-start",
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    newsCard: {
      ...card(colors),
      borderRadius: radius.xl - 4,
      overflow: "hidden",
    },
    newsBody: {
      padding: 16,
      gap: 8,
    },
    newsMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    newsSource: {
      ...type.eyebrow,
      color: colors.accent,
    },
    newsArea: {
      ...type.caption,
      fontSize: 12,
      color: colors.muted,
    },
    newsTitle: {
      color: colors.text,
      fontSize: 19,
      lineHeight: 25,
      fontWeight: "700",
      letterSpacing: -0.3,
    },
    newsSummary: {
      ...type.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
    },
    newsFooter: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginTop: 6,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    newsDate: {
      ...type.caption,
      color: colors.muted,
    },
    sectionTitle: {
      ...type.title,
      color: colors.text,
    },
    sectionLink: {
      ...type.label,
      fontSize: 14,
      color: colors.accent,
      fontWeight: "700",
    },
    moreNewsButton: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },

    // Notifications sheet
    notificationOverlay: {
      flex: 1,
      padding: gutter,
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    notificationPanel: {
      width: "100%",
      maxWidth: 480,
      alignSelf: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.xl,
      padding: 22,
      gap: 14,
      ...shadow(colors, "floating"),
    },
    notificationClose: {
      minHeight: 48,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },

    // Closing encouragement card
    messageCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.accentSoft,
      borderRadius: radius.lg,
      padding: 18,
      gap: 14,
      marginBottom: 20,
    },
    messageContent: {
      flex: 1,
      gap: 2,
    },
    messageTitle: {
      ...type.label,
      color: colors.text,
    },
    messageText: {
      ...type.caption,
      color: colors.muted,
    },
  });
}
