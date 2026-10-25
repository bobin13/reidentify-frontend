import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
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
import { resolveArea, selectionForProfile } from "../../lib/locations";
import { articlePreviewImage, newsImageIdentity } from "../../lib/news-images";
import {
  fetchAreaNews,
  type NewsArticle,
  type NewsResult,
} from "../../lib/news";

const NEWS_FILTERS = [
  { id: "all", label: "Latest" },
  { id: "community", label: "Community" },
  { id: "health", label: "Health & safety" },
  { id: "culture", label: "Culture & learning" },
] as const;
type NewsFilter = (typeof NEWS_FILTERS)[number]["id"];
type NewsState = {
  key: string;
  result: NewsResult | null;
  problem: string | null;
  loading: boolean;
  refreshing: boolean;
};

async function openArticle(article: NewsArticle) {
  try {
    await Linking.openURL(article.url);
  } catch {
    Alert.alert("Couldn't open article", "Please try again.");
  }
}

// Existing group previews are retained for this Home update.
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
  const { user, loading: authLoading } = useAuth();
  const insets = useSafeAreaInsets();
  const selection = user ? selectionForProfile(user) : null;
  const location = resolveArea(selection);
  const cityId = location?.cityId ?? null;
  const districtId = location?.districtId ?? null;
  const cityName = location?.city ?? null;
  const scopeKey = `${user?.id ?? "guest"}:${cityId ?? "ontario"}:${districtId ?? ""}`;
  const title = `${cityName || "Ontario"} news`;
  const [state, setState] = useState<NewsState>({
    key: scopeKey,
    result: null,
    problem: null,
    loading: true,
    refreshing: false,
  });
  const [filter, setFilter] = useState<NewsFilter>("all");
  const [visibleCount, setVisibleCount] = useState(6);
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
  // Hide old-account/old-area results immediately, before the next effect runs.
  const current = state.key === scopeKey ? state : null;
  const result = current?.result ?? null;
  const loading = authLoading || !current || current.loading;
  const refreshing = current?.refreshing ?? false;
  const problem = current?.problem ?? null;

  const loadNews = useCallback(async () => {
    request.current?.abort();
    if (authLoading) return;
    const controller = new AbortController();
    request.current = controller;
    setState((old) => ({
      key: scopeKey,
      result: old.key === scopeKey ? old.result : null,
      problem: null,
      loading: old.key !== scopeKey || !old.result,
      refreshing: true,
    }));
    try {
      const fresh = await fetchAreaNews(cityId, districtId, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      setState({
        key: scopeKey,
        result: fresh,
        problem: null,
        loading: false,
        refreshing: false,
      });
    } catch (error) {
      if (controller.signal.aborted || request.current !== controller) return;
      setState((old) => ({
        key: scopeKey,
        result: old.key === scopeKey ? old.result : null,
        problem:
          error instanceof Error
            ? error.message
            : "News is unavailable. Please try again.",
        loading: false,
        refreshing: false,
      }));
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [authLoading, scopeKey, cityId, districtId]);

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

  useEffect(() => {
    setFilter("all");
    setVisibleCount(6);
  }, [scopeKey]);
  const matches = useMemo(() => {
    const seen = new Set<string>();
    return (result?.articles ?? [])
      .filter((article) => filter === "all" || article.topics.includes(filter))
      .sort((a, b) => Number(!!b.imageUrl) - Number(!!a.imageUrl))
      .map((article) => {
        const key =
          article.imageGroupKey || newsImageIdentity(article.imageUrl);
        const hidePhoto = !!key && seen.has(key);
        if (key) seen.add(key);
        return { ...article, hidePhoto };
      })
      .sort(
        (a, b) =>
          Number(!!b.imageUrl && !b.hidePhoto) -
          Number(!!a.imageUrl && !a.hidePhoto),
      );
  }, [result, filter]);
  const displayPhotos = useMemo(() => {
    const seen = new Set<string>(),
      photos = new Map<string, string | null>();
    for (const article of matches) {
      const candidate = article.hidePhoto
        ? null
        : article.imageUrl || previewImages[article.url] || null;
      const key =
        candidate && (article.imageGroupKey || newsImageIdentity(candidate));
      photos.set(article.id, key && seen.has(key) ? null : candidate);
      if (key) seen.add(key);
    }
    return photos;
  }, [matches, previewImages]);
  const visibleArticles = useMemo(
    () => matches.slice(0, visibleCount),
    [matches, visibleCount],
  );

  useEffect(() => {
    if (!focused || loading || refreshing || !result?.imageGroupingPending)
      return;
    const timer = setTimeout(() => void loadNews(), 2500);
    return () => clearTimeout(timer);
  }, [focused, loading, refreshing, result?.imageGroupingPending, loadNews]);

  useEffect(() => {
    if (!focused || loading) return;
    const controller = new AbortController();
    const targets = visibleArticles.filter((a) => !a.imageUrl).slice(0, 8);
    let cursor = 0;
    async function worker() {
      while (!controller.signal.aborted) {
        const article = targets[cursor++];
        if (!article) break;
        const image = await articlePreviewImage(article.url, controller.signal);
        if (!controller.signal.aborted)
          setPreviewImages((old) =>
            old[article.url] === image ? old : { ...old, [article.url]: image },
          );
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
  const updatedAt = result?.checkedAt ? new Date(result.checkedAt) : null;

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
            {cityName ? (
              <Text
                accessibilityRole="header"
                style={[styles.sectionTitle, styles.newsHeadingTitle]}
              >
                {title}
              </Text>
            ) : (
              <Text style={[styles.newsDescription, styles.newsHeadingTitle]}>
                Updates from across Ontario.
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Refresh ${title}`}
              accessibilityState={{ disabled: refreshing }}
              disabled={refreshing}
              onPress={() => void loadNews()}
              style={styles.refreshButton}
              hitSlop={6}
            >
              <Text style={styles.refreshText}>
                {refreshing ? "Refreshing…" : "Refresh"}
              </Text>
            </Pressable>
          </View>
          {cityName && (
            <Text style={styles.newsDescription}>
              Updates from {cityName} and the surrounding area.
            </Text>
          )}
          {cityName && result?.coverage === "ontario-only" && (
            <Text style={styles.newsDescription}>
              Updates for your area aren't available right now. Here is the
              latest Ontario news.
            </Text>
          )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {NEWS_FILTERS.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: filter === option.id }}
                onPress={() => {
                  setFilter(option.id);
                  setVisibleCount(6);
                }}
                style={[
                  styles.filterChip,
                  filter === option.id && styles.selectedChip,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    filter === option.id && styles.selectedFilterText,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {loading && (
            <View style={styles.newsState}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.newsDescription}>Loading {title}…</Text>
            </View>
          )}

          {(problem || result?.notice) && (
            <View accessibilityLiveRegion="polite" style={styles.newsState}>
              <Text style={styles.newsStateTitle}>
                Some news is unavailable
              </Text>
              <Text style={styles.newsDescription}>
                {problem || result?.notice}
              </Text>
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
                  key={displayPhotos.get(article.id) || "no-photo"}
                  uri={displayPhotos.get(article.id)}
                />
                <View style={styles.newsMeta}>
                  <Text style={styles.newsSource}>{article.source}</Text>
                  <Text style={styles.newsArea}>{article.areaLabel}</Text>
                </View>
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
            !(problem && !result?.articles.length) && (
              <View style={styles.newsState}>
                <Text style={styles.newsStateTitle}>
                  No matching news right now
                </Text>
                <Text style={styles.newsDescription}>
                  {result?.articles.length
                    ? "Try Latest to see the other recent updates."
                    : "The feeds have no recent articles available. Try refreshing later."}
                </Text>
                {filter !== "all" && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Show latest news"
                    onPress={() => {
                      setFilter("all");
                      setVisibleCount(6);
                    }}
                    style={styles.retryButton}
                  >
                    <Text style={styles.selectedFilterText}>
                      Show latest news
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          {!loading && matches.length > visibleCount && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleCount((count) => count + 6)}
              style={styles.moreNewsButton}
            >
              <Text style={styles.sectionLink}>Show more news</Text>
            </Pressable>
          )}
          {updatedAt && (
            <Text style={styles.newsDate}>
              Last checked{" "}
              {updatedAt.toLocaleTimeString("en-CA", {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              · Articles from the past 30 days
            </Text>
          )}
        </View>

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
    moreNewsButton: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    newsMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    newsArea: { color: colors.muted, fontSize: 12, lineHeight: 18 },
    newsSection: { gap: 8, marginBottom: 28 },
    newsHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8,
    },
    newsHeadingTitle: { flex: 1 },
    refreshButton: {
      minHeight: 32,
      justifyContent: "center",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: colors.accent,
    },
    refreshText: {
      color: colors.background,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "800",
    },
    newsDescription: { color: colors.muted, fontSize: 15, lineHeight: 22 },
    filters: { gap: 8 },
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
      marginBottom: 2,
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