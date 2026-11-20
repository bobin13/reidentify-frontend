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
    container: { flex: 1, backgroundColor: colors.background },
    top: {
      paddingHorizontal: gutter,
      paddingTop: 14,
      paddingBottom: 12,
      gap: 4,
    },
    title: { ...type.display, color: colors.text },
    subtitle: { ...type.body, color: colors.muted },

    // Segmented control
    tabs: {
      flexDirection: "row",
      gap: 4,
      marginTop: 14,
      padding: 4,
      borderRadius: radius.md + 2,
      backgroundColor: colors.surfaceAlt,
    },
    tab: {
      flex: 1,
      minHeight: 44,
      paddingHorizontal: 8,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md - 2,
    },
    activeTab: { backgroundColor: colors.accent, ...shadow(colors, "card") },
    tabText: { ...type.label, color: colors.muted, textAlign: "center" },
    activeTabText: { color: colors.background, fontWeight: "700" },

    scroll: { flex: 1 },
    content: {
      padding: gutter,
      paddingTop: 8,
      paddingBottom: 28,
      gap: 12,
    },
    summary: { ...card(colors), padding: 18, gap: 12 },
    sectionTitle: { ...type.title, fontSize: 20, color: colors.text },
    body: { ...type.body, color: colors.muted },

    // Category and person rows
    category: {
      ...card(colors),
      flexDirection: "row",
      alignItems: "center",
      padding: 14,
      gap: 14,
    },
    chosenCategory: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      justifyContent: "center",
      alignItems: "center",
    },
    cardCopy: { flex: 1, minWidth: 0, gap: 2 },
    cardTitle: { ...type.heading, color: colors.text },
    categoryCount: {
      ...type.caption,
      color: colors.accent,
      fontWeight: "600",
      marginTop: 2,
    },
    chevron: { color: colors.muted, fontSize: 24, lineHeight: 26 },

    // Chips
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tag: {
      minHeight: 40,
      maxWidth: "100%",
      justifyContent: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    tagText: { ...type.label, color: colors.text, fontWeight: "500" },
    textButton: { minHeight: 44, justifyContent: "center", paddingVertical: 6 },
    linkText: { ...type.label, color: colors.accent, fontWeight: "700" },

    // Room at the end of a list so the floating save control never covers
    // the last rows.
    floatSpace: { paddingBottom: 160 },
    saveFloat: {
      position: "absolute",
      right: gutter,
      left: gutter,
      alignItems: "flex-end",
      gap: 8,
    },
    saveBubble: {
      maxWidth: 280,
      gap: 4,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      ...shadow(colors, "raised"),
    },
    saveHint: { ...type.caption, color: colors.muted, textAlign: "right" },
    feedback: {
      ...type.caption,
      fontSize: 14,
      color: colors.text,
      fontWeight: "600",
      textAlign: "right",
    },
    saveButton: {
      minHeight: 52,
      borderRadius: radius.pill,
      paddingVertical: 12,
      paddingHorizontal: 22,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
      // A deep, soft shadow lifts the button off the list behind it.
      ...shadow(colors, "floating"),
    },
    saveIconButton: {
      width: 60,
      height: 60,
      borderRadius: 30,
      paddingVertical: 0,
      paddingHorizontal: 0,
    },
    // Inactive keeps the app green but paler, with a lighter shadow. The
    // button itself stays solid so list rows do not show through; the wash
    // below tints it toward the page colour.
    saveButtonDisabled: {
      shadowOpacity: 0.16,
      elevation: 4,
    },
    saveButtonWash: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderRadius: 30,
      backgroundColor: colors.background,
      opacity: 0.5,
    },
    // Pressing sinks the button toward the surface.
    saveButtonPressed: {
      transform: [{ scale: 0.94 }],
      shadowOffset: { width: 0, height: 3 },
      shadowRadius: 6,
      elevation: 4,
    },
    saveButtonText: {
      ...type.label,
      fontSize: 16,
      color: colors.background,
      fontWeight: "700",
      textAlign: "center",
    },

    primaryButton: {
      minHeight: 52,
      borderRadius: radius.pill,
      paddingHorizontal: 20,
      paddingVertical: 12,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    },
    primaryText: {
      ...type.label,
      fontSize: 16,
      color: colors.background,
      fontWeight: "700",
      textAlign: "center",
    },
    disabled: { opacity: 0.55 },
    pressed: { opacity: 0.8 },

    // Activity picker and person sheets
    pickerHeader: { paddingHorizontal: gutter, paddingTop: 4, gap: 6 },
    pickerTitle: { ...type.display, fontSize: 26, color: colors.text },
    activityRow: {
      ...card(colors),
      minHeight: 60,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    checkbox: {
      width: 26,
      height: 26,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: colors.muted,
      justifyContent: "center",
      alignItems: "center",
    },
    checkedBox: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkmark: {
      color: colors.background,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
    },
    activityText: { ...type.body, flex: 1, fontSize: 17, color: colors.text },
    searchBar: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 16,
    },
    avatarText: { color: colors.accent, fontSize: 17, fontWeight: "700" },
    peopleHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
    profilePhoto: { width: 104, height: 104, borderRadius: 52 },
    profileInitials: {
      width: 104,
      height: 104,
      borderRadius: 52,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
  });
}
