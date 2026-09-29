import { ScrollView, StyleSheet, Text, View } from "react-native";
import { FeedItem } from "../../components/feed-item";
import { colors } from "../../constants/app-colors";
import { sampleFeedPosts } from "../../data/feed-posts";

export default function FeedScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.title}>Feed</Text>
        <Text style={styles.subtitle}>Updates from your circle</Text>
      </View>

      {sampleFeedPosts.map((post) => (
        <FeedItem key={post.handle} {...post} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
