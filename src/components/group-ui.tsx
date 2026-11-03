import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../context/theme-context";
import type { CommunityGroup } from "../lib/groups";
import { ChatText } from "./chat-display";
export function useGroupStyles() {
  const { colors } = useAppTheme();
  const s = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.background },
        content: { padding: 20, gap: 14, paddingBottom: 28 },
        title: {
          color: colors.text,
          fontSize: 25,
          lineHeight: 34,
          fontWeight: "700",
        },
        heading: {
          color: colors.text,
          fontSize: 20,
          lineHeight: 28,
          fontWeight: "700",
        },
        body: { color: colors.text, fontSize: 17, lineHeight: 26 },
        muted: { color: colors.muted, fontSize: 16, lineHeight: 24 },
        card: {
          gap: 10,
          padding: 16,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 16,
        },
        row: {
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        },
        input: {
          minHeight: 56,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          color: colors.text,
          backgroundColor: colors.surface,
          fontSize: 18,
        },
        button: {
          minHeight: 52,
          justifyContent: "center",
          alignItems: "center",
          padding: 13,
          paddingHorizontal: 18,
          borderRadius: 12,
          backgroundColor: colors.accent,
        },
        buttonText: {
          color: colors.background,
          fontSize: 17,
          lineHeight: 25,
          fontWeight: "700",
          textAlign: "center",
        },
        secondary: {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        secondaryText: { color: colors.text },
        disabled: { opacity: 0.5 },
        disabledButton: { backgroundColor: colors.border },
        disabledText: { color: colors.muted },
        tabs: {
          flexDirection: "row",
          gap: 8,
          padding: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        tab: {
          flex: 1,
          minHeight: 52,
          padding: 10,
          justifyContent: "center",
          alignItems: "center",
          borderRadius: 12,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        selected: { borderColor: colors.accent, borderWidth: 2 },
        notice: {
          padding: 14,
          gap: 6,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: colors.accent,
          backgroundColor: colors.surface,
        },
        label: {
          color: colors.text,
          fontSize: 17,
          lineHeight: 25,
          fontWeight: "700",
        },
        check: {
          minHeight: 58,
          flexDirection: "row",
          alignItems: "center",
          padding: 14,
          gap: 12,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          backgroundColor: colors.surface,
        },
        footer: {
          padding: 16,
          gap: 10,
          backgroundColor: colors.surface,
          borderTopWidth: 1,
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
          paddingVertical: 12,
          gap: 6,
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
              borderRadius: 12,
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