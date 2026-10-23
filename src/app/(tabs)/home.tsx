import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { XMLParser } from "fast-xml-parser";
import { decodeHTML } from "entities";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppColors } from "../../constants/app-colors";
import { useAppTheme } from "../../context/theme-context";
import { useAuth } from "../../context/auth-context";
import { articlePreviewImage, imageFromFeedItem } from "../../lib/news-images";

type NewsArticle = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: number | null;
  imageUrl: string | null;
  stale?: boolean;
};

const NEWS_SOURCES = [
  { name: "City of Toronto", url: "https://www.toronto.ca/news/feed/" },
  { name: "Toronto Public Library", url: "https://www.tpl.ca/news/feed/" },
];

const NEWS_FILTERS = [
  "For you",
  "All Toronto",
  "Community",
  "Health & safety",
  "Culture & learning",
] as const;
type NewsFilter = (typeof NEWS_FILTERS)[number];

const TOPICS: Record<string, string[]> = {
  Community: [
    "community",
    "volunteer",
    "recreation",
    "park",
    "garden",
    "walking",
    "housing",
    "transit",
    "accessib",
  ],
  "Health & safety": [
    "health",
    "well-being",
    "wellbeing",
    "caregiver",
    "senior",
    "older adult",
    "safety",
    "fire prevention",
    "vaccin",
  ],
  "Culture & learning": [
    "library",
    "libraries",
    "librarian",
    "book",
    "reading",
    "learning",
    "workshop",
    "museum",
    "music",
    "culture",
    "arts",
    "festival",
    "nuit blanche",
  ],
};

const INTEREST_KEYWORDS: Record<string, string[]> = {
  "Walking & outdoors": [
    "walk",
    "park",
    "garden",
    "nature",
    "outdoor",
    "trail",
  ],
  "Learning & books": [
    "library",
    "libraries",
    "librarian",
    "book",
    "reading",
    "learning",
    "workshop",
  ],
  Volunteering: ["volunteer", "community", "donation", "helping"],
  "Music & culture": [
    "music",
    "culture",
    "arts",
    "museum",
    "concert",
    "festival",
    "nuit blanche",
  ],
};

const rssParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
});

function plainText(value: unknown) {
  if (typeof value !== "string") return "";
  return decodeHTML(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(normalize(word)));
}

function topicScore(article: NewsArticle, interests: string[]) {
  const text = normalize(`${article.title} ${article.summary}`);
  const general = Object.values(TOPICS).some((words) =>
    includesAny(text, words),
  );
  const interestMatch = interests.some((interest) =>
    includesAny(text, INTEREST_KEYWORDS[interest] ?? [interest]),
  );
  const olderAdultMatch = includesAny(text, [
    "senior",
    "older adult",
    "caregiver",
    "retirement",
    "accessib",
  ]);
  return (
    (general ? 1 : 0) + (interestMatch ? 5 : 0) + (olderAdultMatch ? 4 : 0)
  );
}

function areaScore(article: NewsArticle, area: string) {
  // Toronto is already the feed's region. Boost specific neighbourhood mentions.
  const places = area
    .split(",")
    .map(normalize)
    .filter(
      (place) =>
        place.length >= 3 && !["toronto", "ontario", "canada"].includes(place),
    );
  return includesAny(normalize(`${article.title} ${article.summary}`), places)
    ? 2
    : 0;
}

function recentArticles(articles: NewsArticle[]) {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const unique = new Map<string, NewsArticle>();
  for (const article of articles) {
    if (article.publishedAt !== null && article.publishedAt < cutoff) continue;
    unique.set(article.id, article);
  }
  return [...unique.values()].sort(
    (a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0),
  );
}

async function fetchNewsSource(
  source: (typeof NEWS_SOURCES)[number],
  signal: AbortSignal,
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel);
  if (signal.aborted) cancel();
  const timeout = setTimeout(cancel, 15000);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const xml = await response.text();
    if (xml.length > 2000000) throw new Error("Feed is too large");

    const feed = rssParser.parse(xml) as {
      rss?: {
        channel?: {
          item?: Record<string, unknown> | Record<string, unknown>[];
        };
      };
    };
    if (!feed.rss?.channel) throw new Error("Invalid news feed");
    const raw = feed.rss.channel.item;
    const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    const articles: NewsArticle[] = [];

    for (const item of items) {
      const title = plainText(item.title);
      const link = typeof item.link === "string" ? item.link.trim() : "";
      if (!title || !link.startsWith("https://")) continue;
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        continue;
      }
      url.hash = "";
      const text = plainText(item.description);
      const date = Date.parse(
        typeof item.pubDate === "string" ? item.pubDate : "",
      );
      articles.push({
        id: url.toString(),
        title,
        summary: text.length > 190 ? `${text.slice(0, 187).trimEnd()}…` : text,
        url: url.toString(),
        source: source.name,
        publishedAt: Number.isFinite(date) ? date : null,
        imageUrl: imageFromFeedItem(item, url.toString()),
      });
    }
    return articles;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}

async function openArticle(article: NewsArticle) {
  try {
    await Linking.openURL(article.url);
  } catch {
    Alert.alert("Couldn't open article", "Please try again.");
  }
}

/*
  Temporary data.
  Later this can come from your backend/API instead.
*/
const featuredActivity = {
  id: "1",
  title: "Community Garden Morning",
  category: "VOLUNTEERING",
  date: "18",
  month: "OCT",
  time: "Friday, 10:00 am",
  location: "Oakfield Garden",
  distance: "0.8 miles",
  image: require("../../../assets/images/placeholder1.jpg"),
};

const nearbyGroups = [
  {
    id: "1",
    title: "Riverside Walkers",
    details: "42 members · 1.2 miles",
    image: require("../../../assets/images/placeholder2.jpg"),
  },
  {
    id: "2",
    title: "Green Fingers Club",
    details: "28 members · 0.8 miles",
    image: require("../../../assets/images/placeholder3.jpg"),
  },
];

function NewsPhoto({ uri }: { uri: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return null;
  return (
    <Image
      source={{ uri }}
      style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 12 }}
      resizeMode="cover"
      accessible={false}
      onError={() => setFailed(true)}
    />
  );
}

export default function HomeScreen() {
  const { colors, theme } = useAppTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [filter, setFilter] = useState<NewsFilter>("For you");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [focused, setFocused] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [previewImages, setPreviewImages] = useState<
    Record<string, string | null>
  >({});
  const request = useRef<AbortController | null>(null);
  const styles = useMemo(
    () => createStyles(colors, theme === "dark"),
    [colors, theme],
  );

  const loadNews = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    setProblem(null);

    const results = await Promise.allSettled(
      NEWS_SOURCES.map((source) => fetchNewsSource(source, controller.signal)),
    );
    if (controller.signal.aborted) return;

    const fresh: NewsArticle[] = [];
    const failed: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") fresh.push(...result.value);
      else failed.push(NEWS_SOURCES[index].name);
    });

    setArticles((previous) =>
      recentArticles([
        ...previous
          .filter((article) => failed.includes(article.source))
          .map((article) => ({ ...article, stale: true })),
        ...fresh,
      ]),
    );
    if (failed.length < NEWS_SOURCES.length) setUpdatedAt(new Date());
    setProblem(
      failed.length
        ? `Couldn't refresh ${failed.join(" and ")}. Check your connection and try again.`
        : null,
    );
    setLoading(false);
    setRefreshing(false);
    request.current = null;
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void loadNews();
      return () => {
        setFocused(false);
        setNotificationsOpen(false);
        request.current?.abort();
      };
    }, [loadNews]),
  );

  const area = user?.area?.trim() ?? "";
  const interests = useMemo(() => user?.interests ?? [], [user?.interests]);
  const visibleArticles = useMemo(() => {
    const matches = articles.filter((article) => {
      if (filter === "All Toronto") return true;
      if (filter === "For you")
        return topicScore(article, interests) + areaScore(article, area) > 0;
      return includesAny(
        normalize(`${article.title} ${article.summary}`),
        TOPICS[filter],
      );
    });
    if (filter === "For you") {
      matches.sort(
        (a, b) =>
          topicScore(b, interests) +
            areaScore(b, area) -
            (topicScore(a, interests) + areaScore(a, area)) ||
          (b.publishedAt ?? 0) - (a.publishedAt ?? 0),
      );
    }
    return matches;
  }, [articles, filter, area, interests]);

  useEffect(() => {
    if (!focused || loading) return;
    const controller = new AbortController();
    // Headlines appear first. Only inspect a few missing previews at a time.
    const targets = visibleArticles
      .filter((article) => !article.imageUrl)
      .slice(0, 20);
    let cursor = 0;
    async function worker() {
      while (!controller.signal.aborted) {
        const article = targets[cursor++];
        if (!article) break;
        const image = await articlePreviewImage(article.url, controller.signal);
        if (!controller.signal.aborted) {
          setPreviewImages((old) =>
            old[article.url] === image ? old : { ...old, [article.url]: image },
          );
        }
      }
    }
    void Promise.all([worker(), worker()]);
    return () => controller.abort();
  }, [focused, loading, visibleArticles]);

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = user?.fullName.trim().split(/\s+/)[0] || "neighbour";
  const outsideToronto =
    area !== "" &&
    !/\b(toronto|etobicoke|scarborough|north york|east york)\b/i.test(area);

  return (
    <View style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 30 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing && !loading}
            onRefresh={() => void loadNews()}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>R</Text>
            </View>

            <Text style={styles.brandText}>ReIdentify</Text>
          </View>

          <Pressable
            style={styles.notificationButton}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={() => setNotificationsOpen(true)}
          >
            <SymbolView
              name={{
                ios: "bell",
                android: "notifications",
                web: "notifications",
              }}
              size={25}
              tintColor={colors.text}
            />
          </Pressable>
        </View>

        {/* GREETING */}
        <Text style={styles.date}>
          {now
            .toLocaleDateString("en-CA", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
            .toUpperCase()}
        </Text>

        <Text style={styles.greeting}>
          {greeting}, {name}
        </Text>

        {/* LIVE LOCAL NEWS */}
        <View style={styles.newsSection}>
          <View style={styles.newsHeading}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Local news
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh local news"
              accessibilityState={{ disabled: refreshing }}
              disabled={refreshing}
              onPress={() => void loadNews()}
              style={styles.refreshButton}
            >
              <Text style={styles.sectionLink}>
                {refreshing ? "Refreshing…" : "Refresh"}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.newsDescription}>
            Toronto updates about community life, health, learning and culture.
          </Text>
          {outsideToronto && (
            <Text style={styles.newsDescription}>
              Your profile area is {area}. These sources currently cover
              Toronto.
            </Text>
          )}
          {filter === "For you" && (
            <Text style={styles.newsDescription}>
              Prioritized by community topics
              {interests.length ? " and your interests" : ""}
              {area && !outsideToronto
                ? `, with a boost for mentions of ${area}`
                : ""}
              .
            </Text>
          )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {NEWS_FILTERS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={option}
                accessibilityState={{ selected: filter === option }}
                onPress={() => setFilter(option)}
                style={[
                  styles.filterChip,
                  filter === option && styles.selectedChip,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    filter === option && styles.selectedFilterText,
                  ]}
                >
                  {option}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {loading && (
            <View style={styles.newsState}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.newsDescription}>Loading local news…</Text>
            </View>
          )}

          {problem && (
            <View accessibilityLiveRegion="polite" style={styles.newsState}>
              <Text style={styles.newsStateTitle}>
                Some news is unavailable
              </Text>
              <Text style={styles.newsDescription}>{problem}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry news"
                disabled={refreshing}
                onPress={() => void loadNews()}
                style={styles.retryButton}
              >
                <Text style={styles.selectedFilterText}>
                  {refreshing ? "Trying again…" : "Try again"}
                </Text>
              </Pressable>
            </View>
          )}

          {!loading &&
            visibleArticles.map((article) => (
              <Pressable
                key={article.id}
                accessibilityRole="link"
                accessibilityLabel={`Read ${article.title} from ${article.source}`}
                accessibilityHint="Opens the publisher's website"
                onPress={() => void openArticle(article)}
                style={({ pressed }) => [
                  styles.newsCard,
                  pressed && styles.pressed,
                ]}
              >
                <NewsPhoto
                  key={
                    article.imageUrl || previewImages[article.url] || "no-photo"
                  }
                  uri={article.imageUrl || previewImages[article.url]}
                />
                <Text style={styles.newsSource}>{article.source}</Text>
                <Text style={styles.newsTitle}>{article.title}</Text>
                {!!article.summary && (
                  <Text style={styles.newsSummary}>{article.summary}</Text>
                )}
                <View style={styles.newsFooter}>
                  <Text style={styles.newsDate}>
                    {article.publishedAt === null
                      ? "Date unavailable"
                      : new Date(article.publishedAt).toLocaleDateString(
                          "en-CA",
                          { month: "short", day: "numeric", year: "numeric" },
                        )}
                  </Text>
                  <Text style={styles.sectionLink}>Read article ↗</Text>
                </View>
                {article.stale && (
                  <Text style={styles.newsDate}>
                    Saved from an earlier refresh
                  </Text>
                )}
              </Pressable>
            ))}

          {!loading &&
            !visibleArticles.length &&
            !(problem && !articles.length) && (
              <View style={styles.newsState}>
                <Text style={styles.newsStateTitle}>
                  No matching news right now
                </Text>
                <Text style={styles.newsDescription}>
                  {articles.length
                    ? "Try All Toronto to see the other recent updates."
                    : "The feeds have no recent articles available. Try refreshing later."}
                </Text>
                {filter !== "All Toronto" && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Show all Toronto news"
                    onPress={() => setFilter("All Toronto")}
                    style={styles.retryButton}
                  >
                    <Text style={styles.selectedFilterText}>
                      Show all Toronto news
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          {updatedAt && (
            <Text style={styles.newsDate}>
              Last checked{" "}
              {updatedAt.toLocaleTimeString("en-CA", {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              · Articles from the past 90 days
            </Text>
          )}
        </View>

        {/* HAPPENING SOON — EXISTING ACTIVITY PREVIEW */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Happening soon</Text>

          <Pressable>
            <Text style={styles.sectionLink}>See all</Text>
          </Pressable>
        </View>

        <Pressable style={styles.featuredCard}>
          <Image source={featuredActivity.image} style={styles.featuredImage} />

          <View style={styles.dateBadge}>
            <Text style={styles.dateNumber}>{featuredActivity.date}</Text>

            <Text style={styles.dateMonth}>{featuredActivity.month}</Text>
          </View>

          <View style={styles.featuredBody}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>
                {featuredActivity.category}
              </Text>
            </View>

            <Text style={styles.featuredTitle}>{featuredActivity.title}</Text>

            <View style={styles.infoRow}>
              <SymbolView
                name={{
                  ios: "clock",
                  android: "schedule",
                  web: "schedule",
                }}
                size={17}
                tintColor={colors.muted}
              />

              <Text style={styles.infoText}>{featuredActivity.time}</Text>
            </View>

            <View style={styles.infoRow}>
              <SymbolView
                name={{
                  ios: "location",
                  android: "location_on",
                  web: "location_on",
                }}
                size={17}
                tintColor={colors.muted}
              />

              <Text style={styles.infoText}>
                {featuredActivity.location} · {featuredActivity.distance}
              </Text>
            </View>
          </View>
        </Pressable>

        {/* GROUPS NEAR YOU */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Groups near you</Text>

          <Pressable onPress={() => router.push("/map")}>
            <Text style={styles.sectionLink}>View map</Text>
          </Pressable>
        </View>

        <View style={styles.groupsRow}>
          {nearbyGroups.map((group) => (
            <Pressable key={group.id} style={styles.groupCard}>
              <Image source={group.image} style={styles.groupImage} />

              <View style={styles.groupBody}>
                <Text style={styles.groupTitle}>{group.title}</Text>

                <Text style={styles.groupDetails}>{group.details}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* COMMUNITY MESSAGE */}
        <View style={styles.messageCard}>
          <SymbolView
            name={{
              ios: "heart",
              android: "favorite_border",
              web: "favorite_border",
            }}
            size={27}
            tintColor={colors.accent}
          />

          <View style={styles.messageContent}>
            <Text style={styles.messageTitle}>
              A little hello goes a long way
            </Text>

            <Text style={styles.messageText}>
              Join a group and meet someone new this week.
            </Text>
          </View>
        </View>
      </ScrollView>
      <Modal
        transparent
        visible={notificationsOpen}
        animationType="fade"
        onRequestClose={() => setNotificationsOpen(false)}
      >
        <View style={styles.notificationOverlay}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            accessible={false}
            onPress={() => setNotificationsOpen(false)}
          />
          <View style={styles.notificationPanel} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Notifications
            </Text>
            <Text style={styles.newsSummary}>
              No notifications to show yet.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close notifications"
              onPress={() => setNotificationsOpen(false)}
              style={styles.notificationClose}
            >
              <Text style={styles.selectedFilterText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(colors: AppColors, isDark: boolean) {
  return StyleSheet.create({
    newsSection: { gap: 12, marginBottom: 28 },
    newsHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8,
    },
    refreshButton: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 8,
    },
    newsDescription: { color: colors.muted, fontSize: 15, lineHeight: 22 },
    filters: { gap: 8, paddingVertical: 4 },
    filterChip: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 14,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    selectedChip: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    filterText: { color: colors.text, fontSize: 14, fontWeight: "600" },
    selectedFilterText: {
      color: colors.background,
      fontSize: 14,
      fontWeight: "700",
    },
    newsState: {
      padding: 18,
      gap: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    newsStateTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
    retryButton: {
      alignSelf: "flex-start",
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.accent,
    },
    newsCard: {
      gap: 10,
      padding: 18,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    pressed: { opacity: 0.75 },
    newsSource: { color: colors.accent, fontSize: 13, fontWeight: "700" },
    newsTitle: {
      color: colors.text,
      fontSize: 20,
      lineHeight: 28,
      fontWeight: "700",
    },
    newsSummary: { color: colors.muted, fontSize: 16, lineHeight: 24 },
    newsFooter: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginTop: 4,
    },
    newsDate: { color: colors.muted, fontSize: 12, lineHeight: 18 },
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },

    container: {
      flex: 1,
      backgroundColor: colors.background,
    },

    content: {
      paddingHorizontal: 20,
      paddingBottom: 30,
    },

    header: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      marginBottom: 14,
    },

    brand: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    logo: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: "#1D7566",
      alignItems: "center",
      justifyContent: "center",
    },

    logoText: {
      color: "#FFFFFF",
      fontSize: 28,
      fontWeight: "700",
      fontFamily: "serif",
    },

    brandText: {
      color: colors.text,
      fontSize: 19,
      fontWeight: "700",
    },

    notificationButton: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
    },

    notificationOverlay: {
      flex: 1,
      padding: 20,
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.5)",
    },
    notificationPanel: {
      width: "100%",
      maxWidth: 480,
      alignSelf: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 18,
      padding: 20,
      gap: 16,
    },
    notificationClose: {
      minHeight: 48,
      justifyContent: "center",
      alignItems: "center",
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.accent,
    },

    date: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 1,
      marginBottom: 8,
    },

    greeting: {
      color: colors.text,
      fontSize: 26,
      lineHeight: 32,
      fontWeight: "700",
      fontFamily: "serif",
      marginBottom: 18,
    },

    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },

    sectionTitle: {
      color: colors.text,
      fontSize: 25,
      fontWeight: "700",
      fontFamily: "serif",
    },

    sectionLink: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: "700",
    },

    featuredCard: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      marginBottom: 28,
    },

    featuredImage: {
      width: "100%",
      height: 190,
      resizeMode: "cover",
    },

    dateBadge: {
      position: "absolute",
      top: 155,
      left: 15,
      width: 58,
      height: 58,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      elevation: 4,
    },

    dateNumber: {
      color: colors.text,
      fontSize: 21,
      fontWeight: "800",
    },

    dateMonth: {
      color: isDark ? "#E87561" : "#AD4D3C",
      fontSize: 10,
      fontWeight: "800",
    },

    featuredBody: {
      paddingHorizontal: 18,
      paddingTop: 25,
      paddingBottom: 18,
    },

    categoryBadge: {
      alignSelf: "flex-start",
      backgroundColor: isDark ? "#173129" : "#E5F3EB",
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      marginBottom: 8,
    },

    categoryText: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.6,
    },

    featuredTitle: {
      color: colors.text,
      fontSize: 23,
      lineHeight: 27,
      fontWeight: "700",
      fontFamily: "serif",
      marginBottom: 14,
    },

    infoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      marginTop: 6,
    },

    infoText: {
      color: colors.muted,
      fontSize: 13,
    },

    groupsRow: {
      flexDirection: "row",
      gap: 12,
      marginBottom: 22,
    },

    groupCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },

    groupImage: {
      width: "100%",
      height: 105,
      resizeMode: "cover",
    },

    groupBody: {
      padding: 11,
    },

    groupTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },

    groupDetails: {
      color: colors.muted,
      fontSize: 11,
      marginTop: 5,
    },

    messageCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: isDark ? "#29261B" : "#FFF6D9",
      borderWidth: 1,
      borderColor: isDark ? "#403A25" : "#E8DCAD",
      borderRadius: 16,
      padding: 18,
      gap: 15,
      marginBottom: 20,
    },

    messageContent: {
      flex: 1,
    },

    messageTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },

    messageText: {
      color: colors.muted,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 4,
    },
  });
}