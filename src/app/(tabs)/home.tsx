import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppColors } from "../../constants/app-colors";
import { card, gutter, radius, shadow, type } from "../../constants/theme";
import { useAppTheme } from "../../context/theme-context";
import { useAuth } from "../../context/auth-context";
import {
  resolveArea,
  selectionForProfile,
} from "../../lib/locations";
import {
  newsImageIdentity,
} from "../../lib/news-images";
import {
  fetchAreaNews,
  fetchInterestNews,
  INTEREST_PAGE,
  type InterestNewsResult,
  type NewsArticle,
  type NewsResult,
} from "../../lib/news";
import { auth } from "../../lib/firebase";

// Stories shown before the rest of the first For you page loads.
const FIRST_INTEREST_BATCH = 2;

const NEWS_FILTERS = [
  { id: "all", label: "Latest" },
  { id: "foryou", label: "For you" },
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

// Interest-based stories live outside the local feed: they are paged by
// the server ten at a time and appended on "Load more".
type InterestState = {
  owner: string;
  articles: NewsArticle[];
  nextOffset: number | null;
  topics: InterestNewsResult["topics"];
  notice: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loaded: boolean;
};

function emptyInterest(owner: string): InterestState {
  return {
    owner,
    articles: [],
    nextOffset: null,
    topics: [],
    notice: null,
    loading: false,
    loadingMore: false,
    error: null,
    loaded: false,
  };
}

async function openArticle(article: NewsArticle) {
  try {
    await Linking.openURL(article.url);
  } catch {
    Alert.alert(
      "Couldn't open article",
      "Please try again.",
    );
  }
}

function NewsPhoto({
  uri,
}: {
  uri: string | null | undefined;
}) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) return null;

  return (
    // expo-image keeps news photos in a disk cache across launches.
    <Image
      source={{ uri }}
      style={{
        width: "100%",
        aspectRatio: 16 / 9,
      }}
      contentFit="cover"
      transition={150}
      recyclingKey={uri}
      accessible={false}
      onError={() => setFailed(true)}
    />
  );
}

export default function HomeScreen() {
  const { colors } = useAppTheme();
  const { user, loading: authLoading } = useAuth();
  const insets = useSafeAreaInsets();

  const selection = user
    ? selectionForProfile(user)
    : null;

  const location = resolveArea(selection);
  const cityId = location?.cityId ?? null;
  const districtId = location?.districtId ?? null;
  const cityName = location?.city ?? null;

  const scopeKey =
    `${user?.id ?? "guest"}:${cityId ?? "ontario"}:${districtId ?? ""}`;

  const title = `${cityName || "Ontario"} news`;


  const [state, setState] = useState<NewsState>({
    key: scopeKey,
    result: null,
    problem: null,
    loading: true,
    refreshing: false,
  });

  const [filter, setFilter] =
    useState<NewsFilter>("all");

  const [visibleCount, setVisibleCount] = useState(6);
  const [focused, setFocused] = useState(false);

  const [notificationsOpen, setNotificationsOpen] =
    useState(false);

  const request = useRef<AbortController | null>(null);

  const uid = user?.id ?? "";
  const [interest, setInterest] = useState<InterestState>(() =>
    emptyInterest(""),
  );
  const interestRequest = useRef<AbortController | null>(null);

  const loadInterestNews = useCallback(
    async (offset: number) => {
      const account = auth.currentUser;
      if (!uid || !account || account.uid !== uid) return;

      interestRequest.current?.abort();
      const controller = new AbortController();
      interestRequest.current = controller;

      setInterest((old) => ({
        ...(old.owner === uid ? old : emptyInterest(uid)),
        owner: uid,
        loading: offset === 0,
        loadingMore: offset > 0,
        error: null,
      }));

      const current = () =>
        !controller.signal.aborted &&
        interestRequest.current === controller;

      const apply = (
        page: InterestNewsResult,
        append: boolean,
        filling: boolean,
      ) =>
        setInterest((old) => {
          const kept =
            old.owner === uid && append ? old.articles : [];
          const seen = new Set(kept.map((item) => item.id));

          return {
            owner: uid,
            articles: [
              ...kept,
              ...page.articles.filter((item) => !seen.has(item.id)),
            ],
            nextOffset: page.nextOffset,
            topics: page.topics,
            notice: page.notice,
            loading: false,
            loadingMore: filling,
            error: null,
            loaded: true,
          };
        });

      try {
        // A fresh feed asks for a couple of stories first so something
        // appears quickly, then fills the rest of the page in the background.
        const first = await fetchInterestNews(
          account,
          offset,
          offset === 0 ? FIRST_INTEREST_BATCH : INTEREST_PAGE,
        );
        if (!current()) return;

        const fillFrom = offset === 0 ? first.nextOffset : null;
        apply(first, offset > 0, fillFrom !== null);

        if (fillFrom !== null) {
          try {
            const rest = await fetchInterestNews(
              account,
              fillFrom,
              INTEREST_PAGE - FIRST_INTEREST_BATCH,
            );
            if (!current()) return;
            apply(rest, true, false);
          } catch {
            // Keep the stories already shown; nextOffset still points at the
            // gap, so Load more picks up from there.
            if (current()) {
              setInterest((old) => ({ ...old, loadingMore: false }));
            }
          }
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          interestRequest.current !== controller
        ) {
          return;
        }

        setInterest((old) => ({
          ...(old.owner === uid ? old : emptyInterest(uid)),
          owner: uid,
          loading: false,
          loadingMore: false,
          error:
            error instanceof Error
              ? error.message
              : "News is unavailable. Please try again.",
        }));
      } finally {
        if (interestRequest.current === controller) {
          interestRequest.current = null;
        }
      }
    },
    [uid],
  );

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  const current =
    state.key === scopeKey ? state : null;

  const result = current?.result ?? null;

  const loading =
    authLoading || !current || current.loading;

  const refreshing = current?.refreshing ?? false;
  const problem = current?.problem ?? null;

  const loadNews = useCallback(async () => {
    request.current?.abort();

    if (authLoading) return;

    const controller = new AbortController();
    request.current = controller;

    setState((old) => ({
      key: scopeKey,
      result:
        old.key === scopeKey ? old.result : null,
      problem: null,
      loading:
        old.key !== scopeKey || !old.result,
      refreshing: true,
    }));

    try {
      const fresh = await fetchAreaNews(
        cityId,
        districtId,
        controller.signal,
      );

      if (
        controller.signal.aborted ||
        request.current !== controller
      ) {
        return;
      }

      setState({
        key: scopeKey,
        result: fresh,
        problem: null,
        loading: false,
        refreshing: false,
      });
    } catch (error) {
      if (
        controller.signal.aborted ||
        request.current !== controller
      ) {
        return;
      }

      setState((old) => ({
        key: scopeKey,
        result:
          old.key === scopeKey ? old.result : null,
        problem:
          error instanceof Error
            ? error.message
            : "News is unavailable. Please try again.",
        loading: false,
        refreshing: false,
      }));
    } finally {
      if (request.current === controller) {
        request.current = null;
      }
    }
  }, [
    authLoading,
    scopeKey,
    cityId,
    districtId,
  ]);

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
    if (filter === "foryou") {
      return (interest.owner === uid ? interest.articles : []).map(
        (article) => ({ ...article, hidePhoto: false }),
      );
    }

    const seen = new Set<string>();

    return (result?.articles ?? [])
      .filter(
        (article) =>
          filter === "all" ||
          article.topics.includes(filter),
      )
      .sort(
        (a, b) =>
          Number(!!b.imageUrl) -
          Number(!!a.imageUrl),
      )
      .map((article) => {
        const key =
          article.imageGroupKey ||
          newsImageIdentity(article.imageUrl);

        const hidePhoto =
          !!key && seen.has(key);

        if (key) seen.add(key);

        return { ...article, hidePhoto };
      })
      .sort(
        (a, b) =>
          Number(!!b.imageUrl && !b.hidePhoto) -
          Number(!!a.imageUrl && !a.hidePhoto),
      );
  }, [result, filter, interest, uid]);

  const displayPhotos = useMemo(() => {
    const seen = new Set<string>();

    const photos =
      new Map<string, string | null>();

    for (const article of matches) {
      const candidate = article.hidePhoto
        ? null
        : article.imageUrl ||
          article.previewImageUrl ||
          null;

      const key =
        candidate &&
        (article.imageGroupKey ||
          newsImageIdentity(candidate));

      photos.set(
        article.id,
        key && seen.has(key)
          ? null
          : candidate,
      );

      if (key) seen.add(key);
    }

    return photos;
  }, [matches]);

  const visibleArticles = useMemo(
    () => (filter === "foryou" ? matches : matches.slice(0, visibleCount)),
    [matches, visibleCount, filter],
  );

  useEffect(() => {
    if (
      !focused ||
      loading ||
      refreshing ||
      !result?.imageGroupingPending
    ) {
      return;
    }

    const timer = setTimeout(
      () => void loadNews(),
      2500,
    );

    return () => clearTimeout(timer);
  }, [
    focused,
    loading,
    refreshing,
    result?.imageGroupingPending,
    loadNews,
  ]);

  const now = new Date();
  const hour = now.getHours();

  const greeting =
    hour < 12
      ? "Good morning"
      : hour < 18
        ? "Good afternoon"
        : "Good evening";

  const name =
    user?.fullName.trim().split(/\s+/)[0] ||
    "neighbour";

  const updatedAt = result?.checkedAt
    ? new Date(result.checkedAt)
    : null;

  const forYou = filter === "foryou";
  const interestReady = interest.owner === uid;
  const feedLoading = forYou
    ? interestReady
      ? interest.loading
      : !!uid
    : loading;
  const feedRetrying = forYou ? interest.loading : refreshing;
  const feedProblem = forYou
    ? interestReady
      ? interest.error
      : null
    : problem;
  const feedNotice = forYou
    ? interestReady && interest.topics.length
      ? interest.notice
      : null
    : result?.notice;
  const feedEmptyText = forYou
    ? interest.topics.length
      ? "Nothing new for your interests right now. Check back later."
      : interest.notice ||
        "Add interests in Search to see news picked for you."
    : result?.articles.length
      ? "Try Latest to see the other recent updates."
      : "The feeds have no recent articles available. Try refreshing later.";
  const interestNames = [
    ...new Set(interest.topics.flatMap((topic) => topic.interests)),
  ];

  return (
    <View style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom:
              insets.bottom + 30,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            // For you shows its own loading state while it reloads, so the
            // pull spinner only tracks the area feed.
            refreshing={!forYou && refreshing && !loading}
            onRefresh={() =>
              void (forYou ? loadInterestNews(0) : loadNews())
            }
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>
                R
              </Text>
            </View>

            <Text style={styles.brandText}>
              ReIdentify
            </Text>
          </View>

          <Pressable
            style={styles.notificationButton}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={() =>
              setNotificationsOpen(true)
            }
          >
            <SymbolView
              name={{
                ios: "bell",
                android: "notifications",
                web: "notifications",
              }}
              size={21}
              tintColor={colors.text}
            />
          </Pressable>
        </View>

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

        <View style={styles.newsSection}>
          <View style={styles.newsHeading}>
            <Text
              style={[
                styles.newsDescription,
                styles.newsHeadingTitle,
              ]}
            >
              {title}
            </Text>
          </View>

          {cityName &&
            result?.coverage === "ontario-only" && (
              <Text style={styles.newsDescription}>
                Updates for your area aren&apos;t available
                right now. Here is the latest Ontario
                news.
              </Text>
            )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {NEWS_FILTERS.filter(
              (option) => option.id !== "foryou" || !!user,
            ).map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{
                  selected:
                    filter === option.id,
                }}
                onPress={() => {
                  setFilter(option.id);
                  setVisibleCount(6);
                  if (
                    option.id === "foryou" &&
                    !(
                      interest.owner === uid &&
                      (interest.loaded || interest.loading)
                    )
                  ) {
                    void loadInterestNews(0);
                  }
                }}
                style={[
                  styles.filterChip,
                  filter === option.id &&
                    styles.selectedChip,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    filter === option.id &&
                      styles.selectedFilterText,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {feedLoading && (
            <View style={styles.newsState}>
              <ActivityIndicator
                color={colors.accent}
              />

              <Text style={styles.newsDescription}>
                {forYou
                  ? "Finding news for your interests… this can take a few seconds."
                  : `Loading ${title}…`}
              </Text>
            </View>
          )}

          {(feedProblem || feedNotice) && (
            <View
              accessibilityLiveRegion="polite"
              style={styles.newsState}
            >
              <Text style={styles.newsStateTitle}>
                Some news is unavailable
              </Text>

              <Text style={styles.newsDescription}>
                {feedProblem || feedNotice}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry news"
                disabled={feedRetrying}
                onPress={() =>
                  void (forYou
                    ? loadInterestNews(0)
                    : loadNews())
                }
                style={styles.retryButton}
              >
                <Text
                  style={styles.selectedFilterText}
                >
                  {feedRetrying
                    ? "Trying again…"
                    : "Try again"}
                </Text>
              </Pressable>
            </View>
          )}

          {!feedLoading &&
            visibleArticles.map((article) => (
              <Pressable
                key={article.id}
                accessibilityRole="link"
                accessibilityLabel={`Read ${article.title} from ${article.source}`}
                accessibilityHint="Opens the publisher's website"
                onPress={() =>
                  void openArticle(article)
                }
                style={({ pressed }) => [
                  styles.newsCard,
                  pressed && styles.pressed,
                ]}
              >
                <NewsPhoto
                  key={
                    displayPhotos.get(article.id) ||
                    "no-photo"
                  }
                  uri={displayPhotos.get(article.id)}
                />

                <View style={styles.newsBody}>
                  <View style={styles.newsMeta}>
                    <Text style={styles.newsSource}>
                      {article.source}
                    </Text>

                    <Text style={styles.newsArea}>
                      {article.areaLabel}
                    </Text>
                  </View>

                  <Text style={styles.newsTitle}>
                    {article.title}
                  </Text>

                  {!!article.summary && (
                    <Text style={styles.newsSummary}>
                      {article.summary}
                    </Text>
                  )}

                  <View style={styles.newsFooter}>
                    <Text style={styles.newsDate}>
                      {article.publishedAt === null
                        ? "Date unavailable"
                        : new Date(
                            article.publishedAt,
                          ).toLocaleDateString(
                            "en-CA",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            },
                          )}
                    </Text>

                    <Text style={styles.sectionLink}>
                      Read article ↗
                    </Text>
                  </View>

                  {article.stale && (
                    <Text style={styles.newsDate}>
                      Saved from an earlier refresh
                    </Text>
                  )}
                </View>
              </Pressable>
            ))}

          {!feedLoading &&
            !visibleArticles.length &&
            !(forYou
              ? feedProblem ||
                !interestReady ||
                !interest.loaded ||
                interest.loadingMore
              : problem && !result?.articles.length) && (
              <View style={styles.newsState}>
                <Text style={styles.newsStateTitle}>
                  No matching news right now
                </Text>

                <Text style={styles.newsDescription}>
                  {feedEmptyText}
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
                    <Text
                      style={styles.selectedFilterText}
                    >
                      Show latest news
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

          {!feedLoading &&
            (forYou
              ? interest.nextOffset !== null
              : matches.length > visibleCount) && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: forYou && interest.loadingMore,
                  busy: forYou && interest.loadingMore,
                }}
                disabled={forYou && interest.loadingMore}
                onPress={() =>
                  forYou
                    ? void loadInterestNews(interest.nextOffset ?? 0)
                    : setVisibleCount((count) => count + 6)
                }
                style={styles.moreNewsButton}
              >
                <Text style={styles.sectionLink}>
                  {forYou
                    ? interest.loadingMore
                      ? "Loading more…"
                      : "Load more"
                    : "Show more news"}
                </Text>
              </Pressable>
            )}

          {forYou &&
            interestReady &&
            interest.loaded &&
            interestNames.length > 0 && (
              <Text style={styles.newsDate}>
                Picked from your interests:{" "}
                {interestNames.slice(0, 6).join(", ")}
                {interestNames.length > 6 ? " and more" : ""}
              </Text>
            )}

          {!forYou && updatedAt && (
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

        <View style={styles.messageCard}>
          <SymbolView
            name={{
              ios: "heart",
              android: "favorite_border",
              web: "favorite_border",
            }}
            size={24}
            tintColor={colors.accent}
          />

          <View style={styles.messageContent}>
            <Text style={styles.messageTitle}>
              A little hello goes a long way
            </Text>

            <Text style={styles.messageText}>
              Join a group and meet someone new
              this week.
            </Text>
          </View>
        </View>
      </ScrollView>

      <Modal
        transparent
        visible={notificationsOpen}
        animationType="fade"
        onRequestClose={() =>
          setNotificationsOpen(false)
        }
      >
        <View style={styles.notificationOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessible={false}
            onPress={() =>
              setNotificationsOpen(false)
            }
          />

          <View
            style={styles.notificationPanel}
            accessibilityViewIsModal
          >
            <Text
              accessibilityRole="header"
              style={styles.sectionTitle}
            >
              Notifications
            </Text>

            <Text style={styles.newsSummary}>
              No notifications to show yet.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close notifications"
              onPress={() =>
                setNotificationsOpen(false)
              }
              style={styles.notificationClose}
            >
              <Text style={styles.selectedFilterText}>
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: gutter,
      paddingBottom: 30,
    },
    pressed: {
      opacity: 0.8,
    },

    // Brand bar
    header: {
      minHeight: 60,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 18,
    },
    brand: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    logo: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    logoText: {
      color: colors.background,
      fontSize: 21,
      lineHeight: 26,
      fontWeight: "800",
    },
    brandText: {
      ...type.heading,
      color: colors.text,
      fontWeight: "700",
    },
    notificationButton: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },

    // Greeting
    date: {
      ...type.eyebrow,
      color: colors.accent,
      marginBottom: 6,
    },
    greeting: {
      ...type.display,
      color: colors.text,
      marginBottom: 22,
    },

    // News feed
    newsSection: {
      gap: 14,
      marginBottom: 28,
    },
    newsHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    newsHeadingTitle: {
      ...type.heading,
      flex: 1,
      minWidth: 0,
      color: colors.text,
    },
    newsDescription: {
      ...type.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
    },
    filters: {
      gap: 8,
      paddingRight: gutter,
    },
    filterChip: {
      minHeight: 40,
      justifyContent: "center",
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    selectedChip: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    filterText: {
      ...type.label,
      fontSize: 14,
      color: colors.text,
    },
    selectedFilterText: {
      ...type.label,
      fontSize: 14,
      color: colors.background,
      fontWeight: "700",
    },
    newsState: {
      ...card(colors),
      padding: 18,
      gap: 12,
    },
    newsStateTitle: {
      ...type.heading,
      color: colors.text,
    },
    retryButton: {
      alignSelf: "flex-start",
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    newsCard: {
      ...card(colors),
      borderRadius: radius.xl - 4,
      overflow: "hidden",
    },
    newsBody: {
      padding: 16,
      gap: 8,
    },
    newsMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    newsSource: {
      ...type.eyebrow,
      color: colors.accent,
    },
    newsArea: {
      ...type.caption,
      fontSize: 12,
      color: colors.muted,
    },
    newsTitle: {
      color: colors.text,
      fontSize: 19,
      lineHeight: 25,
      fontWeight: "700",
      letterSpacing: -0.3,
    },
    newsSummary: {
      ...type.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
    },
    newsFooter: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginTop: 6,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    newsDate: {
      ...type.caption,
      color: colors.muted,
    },
    sectionTitle: {
      ...type.title,
      color: colors.text,
    },
    sectionLink: {
      ...type.label,
      fontSize: 14,
      color: colors.accent,
      fontWeight: "700",
    },
    moreNewsButton: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },

    // Notifications sheet
    notificationOverlay: {
      flex: 1,
      padding: gutter,
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    notificationPanel: {
      width: "100%",
      maxWidth: 480,
      alignSelf: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.xl,
      padding: 22,
      gap: 14,
      ...shadow(colors, "floating"),
    },
    notificationClose: {
      minHeight: 48,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },

    // Closing encouragement card
    messageCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.accentSoft,
      borderRadius: radius.lg,
      padding: 18,
      gap: 14,
      marginBottom: 20,
    },
    messageContent: {
      flex: 1,
      gap: 2,
    },
    messageTitle: {
      ...type.label,
      color: colors.text,
    },
    messageText: {
      ...type.caption,
      color: colors.muted,
    },
  });
}
