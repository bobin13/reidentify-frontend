import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../context/theme-context";
import type { CommunityGroup } from "../lib/groups";
import { card, gutter, radius, shadow, type } from "../constants/theme";
import { ChatText } from "./chat-display";
export function useGroupStyles() {
  const { colors } = useAppTheme();
  const s = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.background },
        content: { padding: gutter, gap: 14, paddingBottom: 28 },
        title: { ...type.display, fontSize: 26, color: colors.text },
        heading: { ...type.heading, fontSize: 18, color: colors.text },
        body: { ...type.body, color: colors.text },
        muted: { ...type.body, fontSize: 15, lineHeight: 22, color: colors.muted },
        card: { ...card(colors), gap: 10, padding: 16 },
        row: {
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        },
        input: {
          minHeight: 52,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          color: colors.text,
          backgroundColor: colors.surface,
          fontSize: 16,
        },
        button: {
          minHeight: 50,
          justifyContent: "center",
          alignItems: "center",
          paddingVertical: 12,
          paddingHorizontal: 20,
          borderRadius: radius.pill,
          backgroundColor: colors.accent,
        },
        buttonText: {
          ...type.label,
          fontSize: 16,
          color: colors.background,
          fontWeight: "700",
          textAlign: "center",
        },
        secondary: {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        secondaryText: { color: colors.text },
        disabled: { opacity: 0.6 },
        disabledButton: {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.surfaceAlt,
        },
        disabledText: { color: colors.muted },
        // Segmented control: a tinted track with one filled segment.
        tabs: {
          flexDirection: "row",
          gap: 4,
          marginHorizontal: gutter,
          marginTop: 12,
          marginBottom: 4,
          padding: 4,
          borderRadius: radius.md + 2,
          backgroundColor: colors.surfaceAlt,
        },
        tab: {
          flex: 1,
          minHeight: 44,
          paddingHorizontal: 8,
          justifyContent: "center",
          alignItems: "center",
          borderRadius: radius.md - 2,
        },
        tabActive: {
          backgroundColor: colors.accent,
          ...shadow(colors, "card"),
        },
        tabText: { ...type.label, color: colors.muted, textAlign: "center" },
        tabTextActive: { color: colors.background, fontWeight: "700" },
        selected: {
          borderColor: colors.accent,
          backgroundColor: colors.accentSoft,
        },
        notice: {
          padding: 16,
          gap: 6,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.accent,
          backgroundColor: colors.accentSoft,
        },
        label: { ...type.label, fontSize: 16, color: colors.text, fontWeight: "700" },
        check: {
          minHeight: 54,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 14,
          paddingVertical: 12,
          gap: 12,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
        },
        footer: {
          padding: 16,
          gap: 10,
          backgroundColor: colors.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
      }),
    [colors],
  );
  return { s, colors };
}

export function GroupButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const { s } = useGroupStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        disabled && s.disabledButton,
        pressed && !disabled && s.disabled,
      ]}
    >
      <Text
        style={[
          s.buttonText,
          secondary && s.secondaryText,
          disabled && s.disabledText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ExpiryNotice({ group }: { group: CommunityGroup }) {
  const { s } = useGroupStyles();
  if (!group.warning) return null;
  return (
    <View style={s.notice} accessibilityLiveRegion="polite">
      <Text style={s.label}>This group is due to close</Text>
      <Text style={s.body}>
        Without new activity, this group and its chat history will be deleted on{" "}
        {new Date(group.deleteAfter).toLocaleDateString()}.
      </Text>
      <Text style={s.muted}>
        A new message or group event starts the activity countdown again.
      </Text>
    </View>
  );
}

export function GroupCard({
  group,
  onPress,
}: {
  group: CommunityGroup;
  onPress: () => void;
}) {
  const { s, colors } = useGroupStyles();

  const memberLabel =
    `${group.memberCount} ${
      group.memberCount === 1 ? "member" : "members"
    }`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open group ${group.name}. ${memberLabel}${
        group.joined ? ". Joined" : ""
      }${
        group.unreadCount
          ? `. ${group.unreadCount} unread messages`
          : ""
      }`}
      onPress={onPress}
      style={[
        s.card,
        {
          minHeight: 72,
          paddingVertical: 14,
          gap: 4,
        },
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Text
          numberOfLines={2}
          style={[
            s.heading,
            { flex: 1, minWidth: 0 },
          ]}
        >
          {group.name}
        </Text>

        {group.unreadCount > 0 && (
          <View
            style={{
              minWidth: 24,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: radius.pill,
              backgroundColor: colors.accent,
            }}
          >
            <Text
              style={{
                color: colors.background,
                fontSize: 13,
                lineHeight: 18,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              {group.unreadCount}
            </Text>
          </View>
        )}
      </View>

      <Text style={s.muted}>
        {memberLabel}
      </Text>

      {group.warning && (
        <Text style={s.muted}>
          Inactivity deadline:{" "}
          {new Date(group.deleteAfter).toLocaleDateString()}
        </Text>
      )}
    </Pressable>
  );
}