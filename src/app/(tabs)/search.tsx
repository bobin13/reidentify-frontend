import { useMemo, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppColors } from "../../constants/app-colors";
import { useAppTheme } from "../../context/theme-context";

type Filter = "all" | "groups" | "people";

type CommunityEntry = {
  id: string;
  kind: "group" | "person";
  name: string;
  area: string;
  description: string;
  interests: string[];
  info: string;
};

// Sample records. Replace these with database/API records later.
const COMMUNITY: CommunityEntry[] = [
  {
    id: "group-walking",
    kind: "group",
    name: "Walking & outdoors",
    area: "Etobicoke, Toronto",
    description:
      "Enjoy gentle walks, gardening conversations and fresh air with a friendly local group. Everyone can take things at their own pace.",
    interests: ["Walking", "Gardening", "Nature"],
    info: "24 members · Saturday morning meetups",
  },
  {
    id: "group-books",
    kind: "group",
    name: "Learning & books",
    area: "Etobicoke, Toronto",
    description:
      "A welcoming book club for sharing stories, discussing books and learning something new together. You do not need to be an expert to join the conversation.",
    interests: ["Reading", "Books", "Learning"],
    info: "18 members · Tuesday afternoon meetups",
  },
  {
    id: "group-volunteering",
    kind: "group",
    name: "Volunteering",
    area: "Etobicoke, Toronto",
    description:
      "Meet neighbours while helping your community. Explore food bank support, community gardening and other local volunteer activities.",
    interests: ["Volunteering", "Community", "Helping others"],
    info: "16 members · Meetups vary by activity",
  },
  {
    id: "group-music",
    kind: "group",
    name: "Music & culture",
    area: "Etobicoke, Toronto",
    description:
      "Share favourite music, enjoy concerts and discover cultural activities together. From a relaxed music chat to a museum visit, there is plenty to explore.",
    interests: ["Music", "Concerts", "Culture", "Museums"],
    info: "22 members · Monthly meetups",
  },
  {
    id: "person-riley",
    kind: "person",
    name: "Riley Chen",
    area: "Etobicoke, Toronto",
    description:
      "Enjoys relaxed park walks and tending a small garden. Looking forward to meeting neighbours with similar interests.",
    interests: ["Walking", "Gardening", "Nature"],
    info: "Languages: English, Mandarin",
  },
  {
    id: "person-samira",
    kind: "person",
    name: "Samira Khan",
    area: "Etobicoke, Toronto",
    description:
      "Enjoys volunteering, sharing recipes and helping with community activities. Always happy to learn something new.",
    interests: ["Volunteering", "Cooking", "Community"],
    info: "Languages: English, Urdu",
  },
  {
    id: "person-theo",
    kind: "person",
    name: "Theo Martin",
    area: "Toronto",
    description:
      "A music enthusiast who enjoys local concerts, museum visits and discovering different cultures.",
    interests: ["Music", "Concerts", "Culture"],
    info: "Languages: English, French",
  },
  {
    id: "person-ava",
    kind: "person",
    name: "Ava Brooks",
    area: "Etobicoke, Toronto",
    description:
      "Enjoys a good book, friendly discussions and learning new skills. Interested in finding a local book club.",
    interests: ["Books", "Reading", "Learning"],
    info: "Languages: English",
  },
];

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "groups", label: "Groups" },
  { key: "people", label: "People" },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter((word) => word !== "&")
    .map((word) => word[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function SearchScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<CommunityEntry | null>(
    null
  );

  const words = normalize(query).split(/\s+/).filter(Boolean);

  const matches = COMMUNITY.filter((entry) => {
    const searchable = normalize(
      [
        entry.name,
        entry.area,
        entry.description,
        entry.info,
        ...entry.interests,
      ].join(" ")
    );

    return words.every((word) => searchable.includes(word));
  });

  const sections = [
    {
      key: "groups",
      title: "Groups",
      items: matches.filter((entry) => entry.kind === "group"),
    },
    {
      key: "people",
      title: "People",
      items: matches.filter((entry) => entry.kind === "person"),
    },
  ].filter(
    (section) => filter === "all" || filter === section.key
  );

  const resultCount = sections.reduce(
    (count, section) => count + section.items.length,
    0
  );

  function openDetails(entry: CommunityEntry) {
    Keyboard.dismiss();
    setSelected(entry);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>
            Search
          </Text>
          <Text style={styles.subtitle}>
            Find groups and people in your community
          </Text>
        </View>

        <View style={styles.searchBar}>
          <SymbolView
            name={{
              ios: "magnifyingglass",
              android: "search",
              web: "search",
            }}
            size={22}
            tintColor={colors.muted}
          />

          <TextInput
            accessibilityLabel="Search groups and people"
            placeholder="Try gardening or a person's name"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            selectionColor={colors.accent}
            style={styles.searchInput}
          />

          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery("")}
              style={styles.clearButton}
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.filters}>
          {FILTERS.map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{
                selected: filter === option.key,
              }}
              onPress={() => setFilter(option.key)}
              style={({ pressed }) => [
                styles.filterButton,
                filter === option.key && styles.activeFilter,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  filter === option.key &&
                    styles.activeFilterText,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text
          accessibilityLiveRegion="polite"
          style={styles.resultCount}
        >
          {resultCount} {resultCount === 1 ? "result" : "results"}
          {query.trim()
            ? ` for “${query.trim()}”`
            : " to explore"}
        </Text>

        {sections
          .filter((section) => section.items.length > 0)
          .map((section) => (
            <View key={section.key} style={styles.section}>
              <Text
                accessibilityRole="header"
                style={styles.sectionTitle}
              >
                {section.title} ({section.items.length})
              </Text>

              {section.items.map((entry) => (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${entry.kind} details for ${entry.name}`}
                  onPress={() => openDetails(entry)}
                  style={({ pressed }) => [
                    styles.card,
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.avatar,
                      entry.kind === "group" &&
                        styles.groupAvatar,
                    ]}
                  >
                    <Text style={styles.initials}>
                      {getInitials(entry.name)}
                    </Text>
                  </View>

                  <View style={styles.cardCopy}>
                    <Text style={styles.cardName}>
                      {entry.name}
                    </Text>
                    <Text style={styles.cardArea}>
                      {entry.area}
                    </Text>
                    <Text style={styles.cardInterests}>
                      {entry.interests.join(" · ")}
                    </Text>
                  </View>

                  <Text
                    style={styles.chevron}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    ›
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}

        {resultCount === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              No results found
            </Text>
            <Text style={styles.emptyText}>
              Try another name or interest, or choose a different
              filter.
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setQuery("");
                setFilter("all");
              }}
              style={styles.resetButton}
            >
              <Text style={styles.resetText}>
                Show all groups and people
              </Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.sampleNote}>
          Showing sample groups and people for this preview.
        </Text>
      </ScrollView>

      <Modal
        visible={selected !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessible={false}
            style={styles.backdrop}
            onPress={() => setSelected(null)}
          />

          {selected && (
            <View
              accessibilityViewIsModal
              style={[
                styles.detailSheet,
                {
                  paddingBottom: Math.max(insets.bottom, 20),
                },
              ]}
            >
              <View style={styles.detailHeader}>
                <Text style={styles.detailKind}>
                  {selected.kind === "group"
                    ? "Group details"
                    : "Person details"}
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close details"
                  onPress={() => setSelected(null)}
                  style={styles.closeButton}
                >
                  <Text style={styles.closeText}>Close</Text>
                </Pressable>
              </View>

              <ScrollView
                style={styles.detailScroll}
                contentContainerStyle={styles.detailContent}
                showsVerticalScrollIndicator={false}
              >
                <Text
                  accessibilityRole="header"
                  style={styles.detailTitle}
                >
                  {selected.name}
                </Text>

                <Text style={styles.subtitle}>
                  {selected.area}
                </Text>

                <Text style={styles.detailInfo}>
                  {selected.info}
                </Text>

                <Text
                  accessibilityRole="header"
                  style={styles.sectionTitle}
                >
                  About
                </Text>

                <Text style={styles.description}>
                  {selected.description}
                </Text>

                <Text
                  accessibilityRole="header"
                  style={styles.sectionTitle}
                >
                  Interests
                </Text>

                <View style={styles.interestTags}>
                  {selected.interests.map((interest) => (
                    <View
                      key={interest}
                      style={styles.interestTag}
                    >
                      <Text style={styles.interestText}>
                        {interest}
                      </Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.sampleNote}>
                  This is a sample {selected.kind} profile.
                </Text>
              </ScrollView>
            </View>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
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
      gap: 18,
    },
    heading: {
      gap: 6,
    },
    title: {
      color: colors.text,
      fontSize: 28,
      fontWeight: "700",
    },
    subtitle: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 24,
    },
    searchBar: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 14,
      color: colors.text,
      fontSize: 16,
    },
    clearButton: {
      minHeight: 48,
      minWidth: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    clearText: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: "700",
    },
    filters: {
      flexDirection: "row",
      gap: 10,
    },
    filterButton: {
      flex: 1,
      minHeight: 48,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 10,
    },
    activeFilter: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    filterText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "600",
    },
    activeFilterText: {
      color: colors.background,
    },
    resultCount: {
      color: colors.muted,
      fontSize: 14,
    },
    section: {
      gap: 12,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.accent,
      justifyContent: "center",
      alignItems: "center",
    },
    groupAvatar: {
      borderRadius: 14,
    },
    initials: {
      color: colors.background,
      fontSize: 17,
      fontWeight: "700",
    },
    cardCopy: {
      flex: 1,
      gap: 5,
    },
    cardName: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
    },
    cardArea: {
      color: colors.muted,
      fontSize: 14,
    },
    cardInterests: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 21,
    },
    chevron: {
      color: colors.muted,
      fontSize: 28,
    },
    pressed: {
      opacity: 0.75,
    },
    emptyState: {
      padding: 24,
      gap: 12,
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
    },
    emptyText: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 24,
      textAlign: "center",
    },
    resetButton: {
      minHeight: 48,
      justifyContent: "center",
      paddingVertical: 12,
    },
    resetText: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: "700",
      textAlign: "center",
    },
    sampleNote: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 20,
    },
    modalRoot: {
      flex: 1,
      justifyContent: "flex-end",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.55)",
    },
    detailSheet: {
      maxHeight: "85%",
      paddingHorizontal: 22,
      paddingTop: 12,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    detailHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 12,
    },
    detailKind: {
      color: colors.muted,
      fontSize: 15,
      fontWeight: "600",
    },
    closeButton: {
      minHeight: 48,
      minWidth: 56,
      justifyContent: "center",
      alignItems: "center",
    },
    closeText: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: "700",
    },
    detailScroll: {
      flexShrink: 1,
    },
    detailContent: {
      gap: 16,
      paddingBottom: 16,
    },
    detailTitle: {
      color: colors.text,
      fontSize: 26,
      fontWeight: "700",
    },
    detailInfo: {
      color: colors.accent,
      fontSize: 16,
      lineHeight: 24,
    },
    description: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 26,
    },
    interestTags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    interestTag: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    interestText: {
      color: colors.text,
      fontSize: 15,
    },
  });
}