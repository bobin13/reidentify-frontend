import { StyleSheet, Text, View } from "react-native";
import { colors } from "../constants/app-colors";

type FeedItemProps = {
  authorName: string;
  handle: string;
  timestamp: string;
  content: string;
  likes: number;
  comments: number;
};

export function FeedItem({
  authorName,
  handle,
  timestamp,
  content,
  likes,
  comments,
}: FeedItemProps) {
  const initials = authorName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.initials}>{initials}</Text>
        </View>
        <View style={styles.authorDetails}>
          <Text style={styles.authorName}>{authorName}</Text>
          <Text style={styles.metadata}>
            {handle} · {timestamp}
          </Text>
        </View>
        <Text style={styles.more}>...</Text>
      </View>

      <Text style={styles.content}>{content}</Text>

      <View style={styles.footer}>
        <Text style={styles.engagement}>Like {likes}</Text>
        <Text style={styles.engagement}>Comment {comments}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  initials: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "700",
  },
  authorDetails: {
    flex: 1,
    gap: 3,
  },
  authorName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  metadata: {
    color: colors.muted,
    fontSize: 12,
  },
  more: {
    color: colors.muted,
    fontSize: 18,
    fontWeight: "700",
  },
  content: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 23,
  },
  footer: {
    flexDirection: "row",
    gap: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  engagement: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
});
