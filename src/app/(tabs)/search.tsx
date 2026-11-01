import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { GroupDirectory } from "../../components/community-groups";
import {
  ActivityIndicator,
  Image,
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
import { SymbolView } from "expo-symbols";

import type { AppColors } from "../../constants/app-colors";
import {
  INTEREST_CATEGORIES,
  recognizedInterests,
  type InterestCategory,
} from "../../constants/interests";
import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";
import { ApiError, apiRequest } from "../../lib/api";
import { auth } from "../../lib/firebase";

type Section = "interests" | "groups" | "people";
type Person = {
  id: string;
  fullName: string;
  area: string;
  interests: string[];
};
type PublicProfile = Person & {
  aboutMe: string;
  age: number | null;
  profileVisibility: "public" | "private";
  photoVersion: string | null;
};
type PeoplePage = { people: Person[]; nextCursor: string | null };

function accountFor(uid: string) {
  const account = auth.currentUser;
  if (!account || account.uid !== uid) throw new Error("Please sign in again.");
  return account;
}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Could not load. Please try again.";
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sameSelection(a: readonly string[], b: readonly string[]) {
  const left = new Set(a);
  const right = new Set(b);
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

export default function SearchScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const { colors } = useAppTheme();
  const { user, loading, updateProfile } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [section, setSection] = useState<Section>("interests");
  const [category, setCategory] = useState<InterestCategory | null>(null);
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const closePerson = useCallback(() => setPerson(null), []);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const markUnavailable = useCallback((id: string) => {
    setUnavailable((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, []);
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
    draft?.owner === uid ? draft.values : recognizedInterests(saved);
  const dirty = draft?.owner === uid && !sameSelection(selected, saved);
  const busy = saving || loading;
  const previousCategories = saved.some(
    (value) => !recognizedInterests([value]).length,
  );
  const shownInterests = showAll ? selected : selected.slice(0, 6);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Carry explicitly chosen guest interests into the first sign-in.
    // Drafts from a signed-in account never move to another account.
    setDraft((current) =>
      current?.owner === "" && uid
        ? { owner: uid, values: current.values }
        : null,
    );
    setCategory(null);
    setPerson(null);
    setUnavailable([]);
    setFeedback(null);
    setShowAll(false);
  }, [uid]);

  useEffect(() => {
    if (params.section === "groups") {
      setSection("groups");
      router.setParams({ section: undefined });
    }
  }, [params.section]);

  function choose(values: string[]) {
    if (busy) return;
    setDraft({ owner: uid, values: recognizedInterests(values) });
    setFeedback(null);
  }

  function toggle(interest: string) {
    choose(
      selected.includes(interest)
        ? selected.filter((value) => value !== interest)
        : [...selected, interest],
    );
  }

  async function save() {
    if (!user || busy || !dirty || saveLock.current) return;
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
      if (!mounted.current || currentUid.current !== owner) return;
      if (!result.ok) {
        setFeedback({ text: result.message, error: true });
        return;
      }
      setDraft(null);
      setCategory(null);
      setFeedback({ text: "Your interests have been saved.", error: false });
    } catch (error) {
      if (mounted.current && currentUid.current === owner) {
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
      if (mounted.current) setSaving(false);
    }
  }

  function saveBar() {
    return (
      <View style={styles.saveBar}>
        {feedback && (
          <Text
            accessibilityRole={feedback.error ? "alert" : undefined}
            accessibilityLiveRegion="polite"
            style={styles.feedback}
          >
            {feedback.text}
          </Text>
        )}
        <Text style={styles.saveHint} accessibilityLiveRegion="polite">
          {loading && !user
            ? "Loading your interests…"
            : !user
              ? "Sign in to save interests to your profile."
              : `${selected.length} ${selected.length === 1 ? "interest" : "interests"} selected${dirty ? " · Unsaved changes" : ""}`}
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
            <Text style={styles.primaryText}>Sign in to save</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || !dirty, busy: saving }}
            disabled={busy || !dirty}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.primaryButton,
              (busy || !dirty) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {saving && <ActivityIndicator color={colors.background} />}
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
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        accessibilityElementsHidden={!!category || !!person}
        importantForAccessibility={
          category || person ? "no-hide-descendants" : "auto"
        }
      >
        <View style={styles.top}>
          <Text accessibilityRole="header" style={styles.title}>
            Search
          </Text>
          <Text style={styles.subtitle}>
            Explore interests and find your community
          </Text>
          <View style={styles.tabs}>
            {(["interests", "groups", "people"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: section === value }}
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
                    section === value && styles.activeTabText,
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
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  What do you enjoy?
                </Text>
                <Text style={styles.body}>
                  Open a category and choose activities you like. You can choose
                  more than one.
                </Text>
                {previousCategories && (
                  <Text style={styles.body}>
                    Your earlier choices were broad categories. Choose specific
                    activities below to update them.
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
                          <Text style={styles.tagText}>{interest} ×</Text>
                        </Pressable>
                      ))}
                    </View>
                    {selected.length > 6 && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setShowAll(!showAll)}
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
                      <Text style={styles.linkText}>Clear selections</Text>
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
                    <Text style={styles.linkText}>Undo changes</Text>
                  </Pressable>
                )}
              </View>

              {INTEREST_CATEGORIES.map((item) => {
                const count = item.activities.filter((value) =>
                  selected.includes(value),
                ).length;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}, ${count} selected. Choose activities`}
                    onPress={() => setCategory(item)}
                    style={({ pressed }) => [
                      styles.category,
                      count > 0 && styles.chosenCategory,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.iconBox}>
                      <Text style={styles.categoryIcon} accessible={false}>
                        {item.icon}
                      </Text>
                    </View>
                    <View style={styles.cardCopy}>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                      <Text style={styles.body}>{item.description}</Text>
                      <Text style={styles.categoryCount}>
                        {count > 0
                          ? `${count} selected`
                          : `${item.activities.length} activities to explore`}
                      </Text>
                    </View>
                    <Text style={styles.chevron} accessible={false}>
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
                    section === "groups" ? "Search groups" : "Search people"
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
                  maxLength={100}
                  returnKeyType="search"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  selectionColor={colors.accent}
                />
                {!!query && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    onPress={() => setQuery("")}
                    style={styles.textButton}
                  >
                    <Text style={styles.linkText}>Clear</Text>
                  </Pressable>
                )}
              </View>
              {section === "groups" ? (
                <GroupDirectory search={query} />
              ) : (
                <PeopleDirectory
                  key={uid}
                  uid={uid}
                  loadingAccount={loading}
                  query={query}
                  onSelect={setPerson}
                  unavailable={unavailable}
                />
              )}
            </>
          )}
        </ScrollView>
        {section === "interests" && saveBar()}
      </KeyboardAvoidingView>

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
              <Text style={styles.linkText}>‹ Back to categories</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.pickerTitle}>
              {category?.icon} {category?.title}
            </Text>
            <Text style={styles.body}>
              Tap an activity to select it. Tap again to remove it.
            </Text>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
          >
            {category?.activities.map((interest) => {
              const checked = selected.includes(interest);
              return (
                <Pressable
                  key={interest}
                  accessibilityRole="checkbox"
                  accessibilityLabel={interest}
                  accessibilityState={{ checked, disabled: busy }}
                  disabled={busy}
                  onPress={() => toggle(interest)}
                  style={({ pressed }) => [
                    styles.activityRow,
                    checked && styles.chosenCategory,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.checkbox, checked && styles.checkedBox]}>
                    {checked && (
                      <Text style={styles.checkmark} accessible={false}>
                        ✓
                      </Text>
                    )}
                  </View>
                  <Text style={styles.activityText}>{interest}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {saveBar()}
        </SafeAreaView>
      </Modal>

      {person && uid && (
        <PublicPerson
          key={`${uid}:${person}`}
          uid={uid}
          id={person}
          onClose={closePerson}
          onUnavailable={markUnavailable}
        />
      )}
    </>
  );
}

// These components stay in this file; Interests and Groups keep their own logic.
function PeopleDirectory({
  uid,
  loadingAccount,
  query,
  onSelect,
  unavailable,
}: {
  uid: string;
  loadingAccount: boolean;
  query: string;
  onSelect: (id: string) => void;
  unavailable: string[];
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const search = normalize(query).replace(/\s+/g, " ");
  const [page, setPage] = useState<PeoplePage & { search: string }>({
    people: [],
    nextCursor: null,
    search: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const visible =
    page.search === search
      ? {
          ...page,
          people: page.people.filter(
            (entry) => !unavailable.includes(entry.id),
          ),
        }
      : { people: [], nextCursor: null };

  const load = useCallback(
    async (cursor: string | null, ticket: number) => {
      if (inFlight.current || !uid) return;
      inFlight.current = true;
      setBusy(true);
      setError("");
      try {
        const path = `/api/public-people?q=${encodeURIComponent(search)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const result = await apiRequest<PeoplePage>(
          accountFor(uid),
          "GET",
          undefined,
          path,
        );
        if (generation.current !== ticket) return;
        setPage((old) => ({
          search,
          nextCursor: result.nextCursor,
          people: cursor
            ? [
                ...new Map(
                  [...old.people, ...result.people].map((entry) => [
                    entry.id,
                    entry,
                  ]),
                ).values(),
              ]
            : result.people,
        }));
      } catch (cause) {
        if (generation.current === ticket) setError(errorMessage(cause));
      } finally {
        if (generation.current === ticket) {
          inFlight.current = false;
          setBusy(false);
        }
      }
    },
    [uid, search],
  );

  useFocusEffect(
    useCallback(() => {
      const ticket = ++generation.current;
      inFlight.current = false;
      setPage({ people: [], nextCursor: null, search });
      setError("");
      setBusy(!!uid && !loadingAccount);
      // One request after typing pauses; paging requires an explicit tap.
      const timer =
        uid && !loadingAccount
          ? setTimeout(() => void load(null, ticket), 400)
          : null;
      return () => {
        if (timer) clearTimeout(timer);
        generation.current++;
      };
    }, [uid, loadingAccount, search, refresh, load]),
  );

  if (loadingAccount)
    return (
      <ActivityIndicator
        accessibilityLabel="Loading account"
        color={colors.accent}
      />
    );
  if (!uid)
    return (
      <>
        <Text style={styles.body}>
          Sign in to find people who have made their profiles public.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.primaryButton}
          onPress={() => router.push("/(tabs)/profile")}
        >
          <Text style={styles.primaryText}>Sign in</Text>
        </Pressable>
      </>
    );
  return (
    <>
      <View style={styles.peopleHeading}>
        <Text
          style={[styles.body, { flex: 1 }]}
          accessibilityLiveRegion="polite"
        >
          {visible.people.length}{" "}
          {visible.people.length === 1 ? "person" : "people"} shown
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={styles.textButton}
          onPress={() => setRefresh((n) => n + 1)}
        >
          <Text style={styles.linkText}>Refresh</Text>
        </Pressable>
      </View>
      {visible.people.map((entry) => (
        <Pressable
          key={entry.id}
          accessibilityRole="button"
          accessibilityLabel={`View ${entry.fullName}'s profile`}
          onPress={() => {
            Keyboard.dismiss();
            onSelect(entry.id);
          }}
          style={({ pressed }) => [styles.category, pressed && styles.pressed]}
        >
          <View style={styles.iconBox}>
            <Text style={styles.avatarText}>{initials(entry.fullName)}</Text>
          </View>
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>{entry.fullName}</Text>
            {!!entry.area && <Text style={styles.body}>{entry.area}</Text>}
            {!!entry.interests.length && (
              <Text numberOfLines={2} style={styles.body}>
                {entry.interests.join(" · ")}
              </Text>
            )}
          </View>
          <Text style={styles.chevron} accessible={false}>
            ›
          </Text>
        </Pressable>
      ))}
      {busy && (
        <ActivityIndicator
          accessibilityLabel="Loading people"
          color={colors.accent}
        />
      )}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={styles.body}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.textButton}
            onPress={() => void load(visible.nextCursor, generation.current)}
          >
            <Text style={styles.linkText}>Try again</Text>
          </Pressable>
        </>
      )}
      {!busy && !error && !visible.people.length && (
        <Text style={styles.body}>
          {visible.nextCursor
            ? "No matches in this batch. Try another name or interest, or load more people."
            : search
              ? "No public profiles match this search."
              : "No public profiles to show yet."}
        </Text>
      )}
      {!error && !!visible.nextCursor && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          accessibilityState={{ disabled: busy }}
          style={[styles.primaryButton, busy && styles.disabled]}
          onPress={() => void load(visible.nextCursor, generation.current)}
        >
          <Text style={styles.primaryText}>Load more people</Text>
        </Pressable>
      )}
    </>
  );
}

function PublicPerson({
  uid,
  id,
  onClose,
  onUnavailable,
}: {
  uid: string;
  id: string;
  onClose: () => void;
  onUnavailable: (id: string) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [opening, setOpening] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const messageLock = useRef(false);
  useFocusEffect(
    useCallback(() => {
      const ticket = ++generation.current;
      setProfile(null);
      setPhoto(null);
      setError("");
      setBusy(true);
      void (async () => {
        try {
          const account = accountFor(uid);
          const result = await apiRequest<{ profile: PublicProfile }>(
            account,
            "GET",
            undefined,
            `/api/profiles/${encodeURIComponent(id)}`,
          );
          if (generation.current !== ticket) return;
          if (result.profile.profileVisibility !== "public")
            throw new ApiError("Profile is no longer available.", 404);
          setProfile(result.profile);
          setBusy(false);
          if (result.profile.photoVersion) {
            try {
              const image = await apiRequest<{ jpeg: string }>(
                account,
                "GET",
                undefined,
                `/api/profiles/${encodeURIComponent(id)}/photo?version=${encodeURIComponent(result.profile.photoVersion)}`,
              );
              if (generation.current === ticket)
                setPhoto(`data:image/jpeg;base64,${image.jpeg}`);
            } catch (cause) {
              if (
                generation.current === ticket &&
                cause instanceof ApiError &&
                cause.status === 404
              ) {
                // A visibility change must also hide the already opened details.
                onUnavailable(id);
                setProfile(null);
                setError("Profile is no longer available.");
              }
            }
          }
        } catch (cause) {
          if (
            generation.current === ticket &&
            cause instanceof ApiError &&
            cause.status === 404
          )
            onUnavailable(id);
          if (generation.current === ticket)
            setError(
              cause instanceof ApiError && cause.status === 404
                ? "Profile is no longer available."
                : errorMessage(cause),
            );
        } finally {
          if (generation.current === ticket) setBusy(false);
        }
      })();
      return () => {
        generation.current++;
      };
    }, [uid, id, retry, onUnavailable]),
  );

  async function message() {
    if (messageLock.current || !profile) return;
    const ticket = generation.current;
    messageLock.current = true;
    setOpening(true);
    setError("");
    try {
      const account = accountFor(uid);
      const check = await apiRequest<{ profile: PublicProfile }>(
        account,
        "GET",
        undefined,
        `/api/profiles/${encodeURIComponent(id)}`,
      );
      if (generation.current !== ticket) return;
      if (check.profile.profileVisibility !== "public")
        throw new ApiError("Profile is no longer available.", 404);
      const result = await apiRequest<{ conversation: { id: string } }>(
        account,
        "POST",
        { peerId: id },
        "/api/conversations",
      );
      if (generation.current !== ticket) return;
      onClose();
      router.push({
        pathname: "/conversation/[id]",
        params: { id: result.conversation.id },
      });
    } catch (cause) {
      if (generation.current === ticket) {
        const unavailable = cause instanceof ApiError && cause.status === 404;
        if (unavailable) {
          onUnavailable(id);
          setProfile(null);
          setPhoto(null);
        }
        setError(
          unavailable ? "Profile is no longer available." : errorMessage(cause),
        );
      }
    } finally {
      messageLock.current = false;
      if (generation.current === ticket) setOpening(false);
    }
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.container}>
        <View style={styles.pickerHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close person details"
            onPress={onClose}
            style={styles.textButton}
          >
            <Text style={styles.linkText}>‹ Back to people</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {busy && (
            <ActivityIndicator
              accessibilityLabel="Loading profile"
              color={colors.accent}
            />
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.body}>
              {error}
            </Text>
          )}
          {!busy && !profile && (
            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={() => setRetry((n) => n + 1)}
            >
              <Text style={styles.linkText}>Try again</Text>
            </Pressable>
          )}
          {profile && (
            <>
              {photo ? (
                <Image
                  source={{ uri: photo }}
                  accessibilityLabel={`${profile.fullName}'s profile photo`}
                  style={styles.profilePhoto}
                  onError={() => setPhoto(null)}
                />
              ) : (
                <View style={styles.profileInitials}>
                  <Text style={[styles.avatarText, { fontSize: 30 }]}>
                    {initials(profile.fullName)}
                  </Text>
                </View>
              )}
              <Text accessibilityRole="header" style={styles.title}>
                {profile.fullName}
              </Text>
              {!!profile.area && (
                <Text style={styles.body}>{profile.area}</Text>
              )}
              {profile.age !== null && (
                <Text style={styles.body}>Age {profile.age}</Text>
              )}
              {!!profile.aboutMe && (
                <>
                  <Text style={styles.sectionTitle}>About me</Text>
                  <Text style={styles.body}>{profile.aboutMe}</Text>
                </>
              )}
              {!!profile.interests.length && (
                <>
                  <Text style={styles.sectionTitle}>Interests</Text>
                  <View style={styles.tags}>
                    {profile.interests.map((interest) => (
                      <View key={interest} style={styles.tag}>
                        <Text style={styles.tagText}>{interest}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={opening}
                accessibilityState={{ disabled: opening, busy: opening }}
                style={[styles.primaryButton, opening && styles.disabled]}
                onPress={() => void message()}
              >
                {opening && <ActivityIndicator color={colors.background} />}
                <Text style={styles.primaryText}>
                  {opening ? "Opening…" : "Message"}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    top: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, gap: 8 },
    title: { color: colors.text, fontSize: 28, fontWeight: "700" },
    subtitle: { color: colors.muted, fontSize: 17, lineHeight: 25 },
    tabs: { flexDirection: "row", gap: 8, marginTop: 12 },
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
    activeTab: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabText: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
      textAlign: "center",
    },
    activeTabText: { color: colors.background },
    scroll: { flex: 1 },
    content: { padding: 20, paddingTop: 8, paddingBottom: 28, gap: 14 },
    summary: {
      padding: 18,
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sectionTitle: { color: colors.text, fontSize: 21, fontWeight: "700" },
    body: { color: colors.muted, fontSize: 16, lineHeight: 24 },
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
    chosenCategory: { borderColor: colors.accent, borderWidth: 2 },
    iconBox: {
      width: 52,
      minHeight: 52,
      borderRadius: 16,
      backgroundColor: colors.background,
      justifyContent: "center",
      alignItems: "center",
    },
    categoryIcon: { fontSize: 28 },
    cardCopy: { flex: 1, minWidth: 0, gap: 5 },
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
    chevron: { color: colors.muted, fontSize: 28 },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tag: {
      minHeight: 48,
      maxWidth: "100%",
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    tagText: { color: colors.text, fontSize: 16, lineHeight: 23 },
    textButton: { minHeight: 48, justifyContent: "center", paddingVertical: 8 },
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
    disabled: { opacity: 0.55 },
    pressed: { opacity: 0.75 },
    pickerHeader: { padding: 20, paddingTop: 8, gap: 12 },
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
    checkedBox: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkmark: { color: colors.background, fontSize: 22, fontWeight: "700" },
    activityText: { flex: 1, color: colors.text, fontSize: 19, lineHeight: 28 },
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
    avatarText: { color: colors.accent, fontSize: 18, fontWeight: "700" },
    peopleHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
    profilePhoto: { width: 104, height: 104, borderRadius: 52 },
    profileInitials: {
      width: 104,
      height: 104,
      borderRadius: 52,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
    },
  });
}