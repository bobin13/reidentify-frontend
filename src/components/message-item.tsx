import { useMemo } from "react";
import { router } from "expo-router";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { AppColors } from "../constants/app-colors";
import { card, radius, type } from "../constants/theme";
import { useAppTheme } from "../context/theme-context";
import type { Chat } from "../lib/messaging";
import {
  ChatText,
  hideSwearWords,
  useChatFilter,
} from "./chat-display";

type MessageItemProps = {
  conversation: Chat;
};

export function MessageItem({ conversation }: MessageItemProps) {
  const { colors } = useAppTheme();
  const { enabled } = useChatFilter();

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  const initials = conversation.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Pressable
        onPress={() =>
          router.push({
            pathname: "/conversation/[id]",
            params: { id: conversation.id },
          })
        }
        accessibilityLabel={`Open conversation with ${conversation.name}. ${
          enabled
            ? hideSwearWords(conversation.preview)
            : conversation.preview
        }`}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.row,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.avatar}>
          <Text style={styles.initials}>
            {initials}
          </Text>
        </View>

        <View style={styles.details}>
          <View style={styles.nameLine}>
            <Text numberOfLines={1} style={styles.name}>
              {conversation.name}
            </Text>

            <Text style={styles.timestamp}>
              {conversation.timestamp}
            </Text>
          </View>

          <View style={styles.previewLine}>
            <ChatText
              numberOfLines={1}
              style={[
                styles.preview,
                conversation.unreadCount > 0 && styles.previewUnread,
              ]}
            >
              {conversation.preview}
            </ChatText>

            {conversation.unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadCount}>
                  {conversation.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
    </Pressable>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    row: {
      ...card(colors),
      minHeight: 76,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    pressed: { opacity: 0.8 },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    initials: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: "700",
    },
    details: { flex: 1, minWidth: 0, gap: 3 },
    nameLine: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    name: { ...type.heading, flex: 1, color: colors.text },
    timestamp: { ...type.caption, fontSize: 12, color: colors.muted },
    previewLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    preview: {
      ...type.caption,
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
    },
    previewUnread: { color: colors.text, fontWeight: "600" },
    unreadBadge: {
      minWidth: 22,
      height: 22,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    unreadCount: {
      color: colors.background,
      fontSize: 12,
      fontWeight: "700",
    },
  });
}
