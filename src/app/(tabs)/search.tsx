import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { FeedItem } from "../../components/feed-item";
import { colors } from "../../constants/app-colors";
import { sampleFeedPosts } from "../../data/feed-posts";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heading}>
          <Text style={styles.title}>Search</Text>
          <Text style={styles.subtitle}>Find posts and people</Text>
        </View>
      </ScrollView>

      <View style={styles.searchDock}>
        <View style={styles.searchBar}>
          <SymbolView
            name={{ ios: "magnifyingglass", android: "search", web: "search" }}
            size={20}
            tintColor={colors.muted}
          />
          <TextInput
            accessibilityLabel="Search feed posts"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder="Search posts or people"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            selectionColor={colors.accent}
            style={styles.searchInput}
            value={query}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 20,
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
  emptyState: {
    paddingVertical: 24,
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
  },
  searchDock: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  searchBar: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
});
