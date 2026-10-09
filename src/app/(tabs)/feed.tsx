import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { FeedItem } from "../../components/feed-item";
import type { AppColors } from "../../constants/app-colors";
import { useAppTheme } from "../../context/theme-context";
import { sampleFeedPosts } from "../../data/feed-posts";

export default function FeedScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.title}>Feed</Text>
        <Text style={styles.subtitle}>
          Updates from your circle
        </Text>
      </View>

      {sampleFeedPosts.map((post) => (
        <FeedItem key={post.handle} {...post} />
      ))}
    </ScrollView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
      paddingBottom: 32,
      gap: 16,
    },
    heading: {
      gap: 4,
      paddingBottom: 4,
    },
    title: {
      color: colors.text,
      fontSize: 26,
      fontWeight: "700",
    },
    subtitle: {
      color: colors.muted,
      fontSize: 14,
    },
  });
}