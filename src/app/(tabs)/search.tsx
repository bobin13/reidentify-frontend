import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { router } from "expo-router";
import { SymbolView } from "expo-symbols";

import {
  ActivityIndicator,
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

import { SafeAreaView } from "react-native-safe-area-context";

import type { AppColors } from "../../constants/app-colors";

import {
  INTEREST_CATEGORIES,
  recognizedInterests,
  type InterestCategory,
} from "../../constants/interests";

import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";

type Section = "interests" | "groups" | "people";

type Person = {
  id: string;
  name: string;
  area: string;
  description: string;
  interests: string[];
  info: string;
};

// Existing preview people.
// Replace with real records when people discovery is connected.
const PEOPLE: Person[] = [
  {
    id: "riley",
    name: "Riley Chen",
    area: "Etobicoke, Toronto",
    description:
      "Enjoys relaxed park walks and tending a small garden. Looking forward to meeting neighbours with similar interests.",
    interests: ["Walking", "Gardening", "Nature outings"],
    info: "English, Mandarin",
  },
  {
    id: "samira",
    name: "Samira Khan",
    area: "Etobicoke, Toronto",
    description:
      "Enjoys volunteering, sharing recipes and helping with community activities. Always happy to learn something new.",
    interests: ["Volunteering", "Cooking", "Community events"],
    info: "English, Urdu",
  },
  {
    id: "theo",
    name: "Theo Martin",
    area: "Toronto",
    description:
      "A music enthusiast who enjoys local concerts, museum visits and discovering different cultures.",
    interests: ["Listening to music", "Concerts", "Museums"],
    info: "English, French",
  },
  {
    id: "ava",
    name: "Ava Brooks",
    area: "Etobicoke, Toronto",
    description:
      "Enjoys a good book, friendly discussions and learning new skills. Interested in finding a local book club.",
    interests: ["Reading", "Book clubs", "Lectures/classes"],
    info: "English",
  },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sameSelection(
  a: readonly string[],
  b: readonly string[]
) {
  const left = new Set(a);
  const right = new Set(b);

  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

export default function SearchScreen() {
  const { colors } = useAppTheme();
  const { user, loading, updateProfile } = useAuth();

  const styles = useMemo(
    () => createStyles(colors),
    [colors]
  );

  const [section, setSection] =
    useState<Section>("interests");

  const [category, setCategory] =
    useState<InterestCategory | null>(null);

  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<Person | null>(null);

  const [draft, setDraft] = useState<{
    owner: string;
    values: string[];
  } | null>(null);

  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);

  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  const saveLock = useRef(false);
  const mounted = useRef(true);

  const uid = user?.id ?? "";
  const currentUid = useRef(uid);
  currentUid.current = uid;

  const saved = user?.interests ?? [];

  const selected =
    draft?.owner === uid
      ? draft.values
      : recognizedInterests(saved);

  const dirty =
    draft?.owner === uid &&
    !sameSelection(selected, saved);

  const busy = saving || loading;

  const previousCategories = saved.some(
    (value) => !recognizedInterests([value]).length
  );

  const shownInterests = showAll
    ? selected
    : selected.slice(0, 6);

  const words = normalize(query)
    .split(/\s+/)
    .filter(Boolean);

  const matches = PEOPLE.filter((entry) => {
    const text = normalize(
      [
        entry.name,
        entry.area,
        entry.description,
        entry.info,
        ...entry.interests,
      ].join(" ")
    );

    return words.every((word) => text.includes(word));
  });

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Carry guest choices into the first sign-in.
    // A signed-in account's draft never moves to another account.
    setDraft((current) =>
      current?.owner === "" && uid
        ? { owner: uid, values: current.values }
        : null
    );

    setCategory(null);
    setPerson(null);
    setFeedback(null);
    setShowAll(false);
  }, [uid]);

  function choose(values: string[]) {
    if (busy) return;

    setDraft({
      owner: uid,
      values: recognizedInterests(values),
    });

    setFeedback(null);
  }

  function toggle(interest: string) {
    choose(
      selected.includes(interest)
        ? selected.filter((value) => value !== interest)
        : [...selected, interest]
    );
  }

  async function save() {
    if (!user || busy || !dirty || saveLock.current) {
      return;
    }

    const owner = user.id;
    const values = [...selected];

    saveLock.current = true;
    setSaving(true);
    setFeedback(null);

    try {
      const result = await updateProfile({
        fullName: user.fullName,
        area: user.area,
        interests: values,
      });

      if (
        !mounted.current ||
        currentUid.current !== owner
      ) {
        return;
      }

      if (!result.ok) {
        setFeedback({
          text: result.message,
          error: true,
        });
        return;
      }

      setDraft(null);
      setCategory(null);

      setFeedback({
        text: "Your interests have been saved.",
        error: false,
      });
    } catch (error) {
      if (
        mounted.current &&
        currentUid.current === owner
      ) {
        setFeedback({
          text:
            error instanceof Error
              ? error.message
              : "Could not save. Please try again.",
          error: true,
        });
      }
    } finally {
      saveLock.current = false;

      if (mounted.current) {
        setSaving(false);
      }
    }
  }

  function saveBar() {
    return (
      <View style={styles.saveBar}>
        {feedback && (
          <Text
            accessibilityRole={
              feedback.error ? "alert" : undefined
            }
            accessibilityLiveRegion="polite"
            style={styles.feedback}
          >
            {feedback.text}
          </Text>
        )}

        <Text
          style={styles.saveHint}
          accessibilityLiveRegion="polite"
        >
          {loading && !user
            ? "Loading your interests…"
            : !user
              ? "Sign in to save interests to your profile."
              : `${selected.length} ${
                  selected.length === 1
                    ? "interest"
                    : "interests"
                } selected${
                  dirty ? " · Unsaved changes" : ""
                }`}
        </Text>

        {!user && !loading ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setCategory(null);
              router.push("/(tabs)/profile");
            }}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryText}>
              Sign in to save
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: busy || !dirty,
              busy: saving,
            }}
            disabled={busy || !dirty}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.primaryButton,
              (busy || !dirty) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {saving && (
              <ActivityIndicator
                color={colors.background}
              />
            )}

            <Text style={styles.primaryText}>
              {saving ? "Saving…" : "Save interests"}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={
          Platform.OS === "ios" ? "padding" : "height"
        }
        accessibilityElementsHidden={
          !!category || !!person
        }
        importantForAccessibility={
          category || person
            ? "no-hide-descendants"
            : "auto"
        }
      >
        <View style={styles.top}>
          <Text
            accessibilityRole="header"
            style={styles.title}
          >
            Search
          </Text>

          <Text style={styles.subtitle}>
            Explore interests and find your community
          </Text>

          <View style={styles.tabs}>
            {(
              ["interests", "groups", "people"] as const
            ).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{
                  selected: section === value,
                }}
                onPress={() => {
                  Keyboard.dismiss();
                  setSection(value);
                  setQuery("");
                }}
                style={({ pressed }) => [
                  styles.tab,
                  section === value && styles.activeTab,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    section === value &&
                      styles.activeTabText,
                  ]}
                >
                  {value === "interests"
                    ? "Interests"
                    : value === "groups"
                      ? "Groups"
                      : "People"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {section === "interests" ? (
            <>
              <View style={styles.summary}>
                <Text
                  accessibilityRole="header"
                  style={styles.sectionTitle}
                >
                  What do you enjoy?
                </Text>

                <Text style={styles.body}>
                  Open a category and choose activities
                  you like. You can choose more than one.
                </Text>

                {previousCategories && (
                  <Text style={styles.body}>
                    Your earlier choices were broad
                    categories. Choose specific activities
                    below to update them.
                  </Text>
                )}

                {selected.length > 0 && (
                  <>
                    <View style={styles.tags}>
                      {shownInterests.map((interest) => (
                        <Pressable
                          key={interest}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${interest}`}
                          disabled={busy}
                          onPress={() => toggle(interest)}
                          style={styles.tag}
                        >
                          <Text style={styles.tagText}>
                            {interest}  ×
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    {selected.length > 6 && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          setShowAll(!showAll)
                        }
                        style={styles.textButton}
                      >
                        <Text style={styles.linkText}>
                          {showAll
                            ? "Show fewer"
                            : `Show all ${selected.length} selected interests`}
                        </Text>
                      </Pressable>
                    )}

                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => choose([])}
                      style={styles.textButton}
                    >
                      <Text style={styles.linkText}>
                        Clear selections
                      </Text>
                    </Pressable>
                  </>
                )}

                {dirty && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      setDraft(null);
                      setFeedback(null);
                    }}
                    style={styles.textButton}
                  >
                    <Text style={styles.linkText}>
                      Undo changes
                    </Text>
                  </Pressable>
                )}
              </View>

              {INTEREST_CATEGORIES.map((item) => {
                const count = item.activities.filter(
                  (value) => selected.includes(value)
                ).length;

                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}, ${count} selected. Choose activities`}
                    onPress={() => setCategory(item)}
                    style={({ pressed }) => [
                      styles.category,
                      count > 0 &&
                        styles.chosenCategory,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.iconBox}>
                      <Text
                        style={styles.categoryIcon}
                        accessible={false}
                      >
                        {item.icon}
                      </Text>
                    </View>

                    <View style={styles.cardCopy}>
                      <Text style={styles.cardTitle}>
                        {item.title}
                      </Text>

                      <Text style={styles.body}>
                        {item.description}
                      </Text>

                      <Text style={styles.categoryCount}>
                        {count > 0
                          ? `${count} selected`
                          : `${item.activities.length} activities to explore`}
                      </Text>
                    </View>

                    <Text
                      style={styles.chevron}
                      accessible={false}
                    >
                      ›
                    </Text>
                  </Pressable>
                );
              })}
            </>
          ) : (
            <>
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
                  accessibilityLabel={
                    section === "groups"
                      ? "Search groups"
                      : "Search people"
                  }
                  style={styles.searchInput}
                  placeholder={
                    section === "groups"
                      ? "Search by group name or interest"
                      : "Search by name or interest"
                  }
                  placeholderTextColor={colors.muted}
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={() =>
                    Keyboard.dismiss()
                  }
                  selectionColor={colors.accent}
                />

                {!!query && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    onPress={() => setQuery("")}
                    style={styles.textButton}
                  >
                    <Text style={styles.linkText}>
                      Clear
                    </Text>
                  </Pressable>
                )}
              </View>

              {section === "groups" ? (
                <View style={styles.summary}>
                  <Text
                    accessibilityRole="header"
                    style={styles.sectionTitle}
                  >
                    Community groups
                  </Text>

                  <Text style={styles.body}>
                    Groups bring people together around
                    shared interests.
                  </Text>

                  <Text style={styles.body}>
                    {query.trim()
                      ? "No groups match your search."
                      : "No groups to show yet."}
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={styles.body}>
                    Preview: these are sample profiles.
                  </Text>

                  <Text
                    accessibilityLiveRegion="polite"
                    style={styles.body}
                  >
                    {matches.length}{" "}
                    {matches.length === 1
                      ? "person"
                      : "people"}{" "}
                    found
                  </Text>

                  {matches.map((entry) => (
                    <Pressable
                      key={entry.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open person details for ${entry.name}`}
                      onPress={() => {
                        Keyboard.dismiss();
                        setPerson(entry);
                      }}
                      style={({ pressed }) => [
                        styles.category,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.iconBox}>
                        <Text style={styles.avatarText}>
                          {entry.name
                            .split(" ")
                            .map((word) => word[0])
                            .slice(0, 2)
                            .join("")}
                        </Text>
                      </View>

                      <View style={styles.cardCopy}>
                        <Text style={styles.cardTitle}>
                          {entry.name}
                        </Text>

                        <Text style={styles.body}>
                          {entry.area}
                        </Text>

                        <Text style={styles.body}>
                          {entry.interests.join(" · ")}
                        </Text>
                      </View>

                      <Text
                        style={styles.chevron}
                        accessible={false}
                      >
                        ›
                      </Text>
                    </Pressable>
                  ))}

                  {!matches.length && (
                    <Text style={styles.body}>
                      Try another name or interest.
                    </Text>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>

        {section === "interests" && saveBar()}
      </KeyboardAvoidingView>

      {/* Activity selection */}
      <Modal
        visible={category !== null}
        animationType="slide"
        onRequestClose={() => setCategory(null)}
      >
        <SafeAreaView
          edges={["top", "bottom"]}
          style={styles.container}
          testID="interest-picker"
        >
          <View style={styles.pickerHeader}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setCategory(null)}
              style={styles.textButton}
            >
              <Text style={styles.linkText}>
                ‹ Back to categories
              </Text>
            </Pressable>

            <Text
              accessibilityRole="header"
              style={styles.pickerTitle}
            >
              {category?.icon} {category?.title}
            </Text>

            <Text style={styles.body}>
              Tap an activity to select it. Tap again to
              remove it.
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
          >
            {category?.activities.map((interest) => {
              const checked =
                selected.includes(interest);

              return (
                <Pressable
                  key={interest}
                  accessibilityRole="checkbox"
                  accessibilityLabel={interest}
                  accessibilityState={{
                    checked,
                    disabled: busy,
                  }}
                  disabled={busy}
                  onPress={() => toggle(interest)}
                  style={({ pressed }) => [
                    styles.activityRow,
                    checked && styles.chosenCategory,
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      checked && styles.checkedBox,
                    ]}
                  >
                    {checked && (
                      <Text
                        style={styles.checkmark}
                        accessible={false}
                      >
                        ✓
                      </Text>
                    )}
                  </View>

                  <Text style={styles.activityText}>
                    {interest}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {saveBar()}
        </SafeAreaView>
      </Modal>

      {/* Existing sample person details */}
      <Modal
        visible={person !== null}
        animationType="slide"
        onRequestClose={() => setPerson(null)}
      >
        <SafeAreaView
          edges={["top", "bottom"]}
          style={styles.container}
        >
          <View style={styles.pickerHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close person details"
              onPress={() => setPerson(null)}
              style={styles.textButton}
            >
              <Text style={styles.linkText}>
                ‹ Back to people
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
          >
            <Text
              accessibilityRole="header"
              style={styles.title}
            >
              {person?.name}
            </Text>

            <Text style={styles.body}>
              Sample profile · {person?.area}
            </Text>

            <Text style={styles.body}>
              {person?.description}
            </Text>

            <Text style={styles.body}>
              Languages: {person?.info}
            </Text>

            <Text style={styles.sectionTitle}>
              Interests
            </Text>

            <Text style={styles.body}>
              {person?.interests.join(" · ")}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    top: {
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 14,
      gap: 8,
    },
    title: {
      color: colors.text,
      fontSize: 28,
      fontWeight: "700",
    },
    subtitle: {
      color: colors.muted,
      fontSize: 17,
      lineHeight: 25,
    },
    tabs: {
      flexDirection: "row",
      gap: 8,
      marginTop: 12,
    },
    tab: {
      flex: 1,
      minHeight: 54,
      padding: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
    },
    activeTab: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    tabText: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
      textAlign: "center",
    },
    activeTabText: {
      color: colors.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      padding: 20,
      paddingTop: 8,
      paddingBottom: 28,
      gap: 14,
    },
    summary: {
      padding: 18,
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 21,
      fontWeight: "700",
    },
    body: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 24,
    },
    category: {
      flexDirection: "row",
      alignItems: "center",
      padding: 16,
      gap: 14,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chosenCategory: {
      borderColor: colors.accent,
      borderWidth: 2,
    },
    iconBox: {
      width: 52,
      minHeight: 52,
      borderRadius: 16,
      backgroundColor: colors.background,
      justifyContent: "center",
      alignItems: "center",
    },
    categoryIcon: {
      fontSize: 28,
    },
    cardCopy: {
      flex: 1,
      minWidth: 0,
      gap: 5,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 19,
      lineHeight: 27,
      fontWeight: "700",
    },
    categoryCount: {
      color: colors.accent,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "600",
    },
    chevron: {
      color: colors.muted,
      fontSize: 28,
    },
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    tag: {
      minHeight: 48,
      maxWidth: "100%",
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    tagText: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 23,
    },
    textButton: {
      minHeight: 48,
      justifyContent: "center",
      paddingVertical: 8,
    },
    linkText: {
      color: colors.accent,
      fontSize: 17,
      lineHeight: 25,
      fontWeight: "700",
    },
    saveBar: {
      gap: 10,
      padding: 16,
      paddingHorizontal: 20,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    saveHint: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 23,
      textAlign: "center",
    },
    primaryButton: {
      minHeight: 56,
      borderRadius: 14,
      padding: 14,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    },
    primaryText: {
      color: colors.background,
      fontSize: 18,
      lineHeight: 26,
      fontWeight: "700",
      textAlign: "center",
    },
    feedback: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 25,
      fontWeight: "600",
    },
    disabled: {
      opacity: 0.55,
    },
    pressed: {
      opacity: 0.75,
    },
    pickerHeader: {
      padding: 20,
      paddingTop: 8,
      gap: 12,
    },
    pickerTitle: {
      color: colors.text,
      fontSize: 26,
      lineHeight: 35,
      fontWeight: "700",
    },
    activityRow: {
      minHeight: 68,
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    checkbox: {
      width: 30,
      height: 30,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: colors.muted,
      justifyContent: "center",
      alignItems: "center",
    },
    checkedBox: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    checkmark: {
      color: colors.background,
      fontSize: 22,
      fontWeight: "700",
    },
    activityText: {
      flex: 1,
      color: colors.text,
      fontSize: 19,
      lineHeight: 28,
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
      fontSize: 17,
    },
    avatarText: {
      color: colors.accent,
      fontSize: 18,
      fontWeight: "700",
    },
  });
}