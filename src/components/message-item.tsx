import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../constants/app-colors";
import type { Conversation } from "../data/sample-conversations";

type MessageItemProps = {
  conversation: Conversation;
};

export function MessageItem({ conversation }: MessageItemProps) {
  const initials = conversation.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Link
      href={{
        pathname: "/conversation/[id]",
        params: { id: conversation.id },
      }}
      asChild
    >
      <Pressable
        accessibilityLabel={`Open conversation with ${conversation.name}. ${conversation.preview}`}
        accessibilityRole="button"
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.avatar}>
          <Text style={styles.initials}>{initials}</Text>
        </View>
        <View style={styles.details}>
          <View style={styles.nameLine}>
            <Text style={styles.name}>{conversation.name}</Text>
            <Text style={styles.timestamp}>{conversation.timestamp}</Text>
          </View>
          <View style={styles.previewLine}>
            <Text numberOfLines={1} style={styles.preview}>
              {conversation.preview}
            </Text>
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
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.72,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  initials: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "700",
  },
  details: {
    flex: 1,
    gap: 6,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  timestamp: {
    color: colors.muted,
    fontSize: 12,
  },
  previewLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  preview: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  unreadCount: {
    color: colors.background,
    fontSize: 11,
    fontWeight: "700",
  },
});
