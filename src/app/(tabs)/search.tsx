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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ModalSafeArea } from "../../components/modal-safe-area";
import { SymbolView } from "expo-symbols";

import type { AppColors } from "../../constants/app-colors";
import { card, gutter, radius, shadow, type } from "../../constants/theme";
import {
  INTEREST_CATEGORIES,
  MIN_INTERESTS,
  recognizedInterests,
  type InterestCategory,
} from "../../constants/interests";
import { setGuestInterestDraft } from "../../lib/guest-interests";
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

const BANNER_MS = 5000;

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
  const insets = useSafeAreaInsets();
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
  const [bannerShown, setBannerShown] = useState(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveLock = useRef(false);
  const mounted = useRef(true);
  const uid = user?.id ?? "";
  const currentUid = useRef(uid);
  currentUid.current = uid;

  const saved = user?.interests ?? [];
  const selected =
    draft?.owner === uid ? draft.values : recognizedInterests(saved);
  const dirty = draft?.owner === uid && !sameSelection(selected, saved);
  const tooFew = !!user && selected.length < MIN_INTERESTS;
  const busy = saving || loading;
  const previousCategories = saved.some(
    (value) => !recognizedInterests([value]).length,
  );
  const shownInterests = showAll ? selected : selected.slice(0, 6);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
  }, []);

  // Show the status banner beside the save button, then hide it again after
  // five seconds. Each new change restarts the countdown.
  function flashBanner() {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBannerShown(true);
    bannerTimer.current = setTimeout(() => {
      bannerTimer.current = null;
      if (mounted.current) setBannerShown(false);
    }, BANNER_MS);
  }

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
    const recognized = recognizedInterests(values);
    // A guest's picks seed the first-run interests screen after sign-in.
    if (!uid) setGuestInterestDraft(recognized);
    setDraft({ owner: uid, values: recognized });
    setFeedback(null);
    flashBanner();
  }

  function toggle(interest: string) {
    choose(
      selected.includes(interest)
        ? selected.filter((value) => value !== interest)
        : [...selected, interest],
    );
  }

  async function save() {
    if (!user || busy || !dirty || tooFew || saveLock.current) return;
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
        flashBanner();
        return;
      }
      setDraft(null);
      setCategory(null);
      setFeedback({ text: "Your interests have been saved.", error: false });
      flashBanner();
    } catch (error) {
      if (mounted.current && currentUid.current === owner) {
        setFeedback({
          text:
            error instanceof Error
              ? error.message
              : "Could not save. Please try again.",
          error: true,
        });
        flashBanner();
      }
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  // Floating save control pinned to the bottom-right corner. The status text
  // sits in a small bubble above the button; taps elsewhere pass through.
  function saveBar(bottomInset = 0) {
    const blocked = busy || !dirty || tooFew;
    return (
      <View
        pointerEvents="box-none"
        style={[styles.saveFloat, { bottom: 20 + bottomInset }]}
      >
        {bannerShown && (
          <View style={styles.saveBubble}>
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
                  : tooFew
                    ? `Choose at least ${MIN_INTERESTS} interests · ${selected.length} selected`
                    : `${selected.length} ${selected.length === 1 ? "interest" : "interests"} selected${dirty ? " · Unsaved changes" : ""}`}
            </Text>
          </View>
        )}
        {!user && !loading ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setCategory(null);
              router.push("/(tabs)/profile");
            }}
            style={({ pressed }) => [
              styles.saveButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.saveButtonText}>Sign in to save</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saving ? "Saving interests" : "Save interests"}
            accessibilityState={{ disabled: blocked, busy: saving }}
            disabled={blocked}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.saveButton,
              styles.saveIconButton,
              blocked && styles.saveButtonDisabled,
              pressed && styles.saveButtonPressed,
            ]}
          >
            {blocked && !saving && (
              <View pointerEvents="none" style={styles.saveButtonWash} />
            )}
            {saving ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <SymbolView
                name={{
                  ios: "square.and.arrow.down",
                  android: "save",
                  web: "save",
                }}
                size={28}
                tintColor={colors.background}
              />
            )}
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
          contentContainerStyle={[
            styles.content,
            section === "interests" && styles.floatSpace,
          ]}
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
                      <SymbolView
                        name={item.symbol}
                        size={24}
                        tintColor={colors.accent}
                      />
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
        <ModalSafeArea
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
              {category?.title}
            </Text>
            <Text style={styles.body}>
              Tap an activity to select it. Tap again to remove it.
            </Text>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, styles.floatSpace]}
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
          {saveBar(insets.bottom)}
        </ModalSafeArea>
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
      <ModalSafeArea edges={["top", "bottom"]} style={styles.container}>
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
      </ModalSafeArea>
    </Modal>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    top: {
      paddingHorizontal: gutter,
      paddingTop: 14,
      paddingBottom: 12,
      gap: 4,
    },
    title: { ...type.display, color: colors.text },
    subtitle: { ...type.body, color: colors.muted },

    // Segmented control
    tabs: {
      flexDirection: "row",
      gap: 4,
      marginTop: 14,
      padding: 4,
      borderRadius: radius.md + 2,
      backgroundColor: colors.surfaceAlt,
    },
    tab: {
      flex: 1,
      minHeight: 44,
      paddingHorizontal: 8,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md - 2,
    },
    activeTab: { backgroundColor: colors.accent, ...shadow(colors, "card") },
    tabText: { ...type.label, color: colors.muted, textAlign: "center" },
    activeTabText: { color: colors.background, fontWeight: "700" },

    scroll: { flex: 1 },
    content: {
      padding: gutter,
      paddingTop: 8,
      paddingBottom: 28,
      gap: 12,
    },
    summary: { ...card(colors), padding: 18, gap: 12 },
    sectionTitle: { ...type.title, fontSize: 20, color: colors.text },
    body: { ...type.body, color: colors.muted },

    // Category and person rows
    category: {
      ...card(colors),
      flexDirection: "row",
      alignItems: "center",
      padding: 14,
      gap: 14,
    },
    chosenCategory: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      justifyContent: "center",
      alignItems: "center",
    },
    cardCopy: { flex: 1, minWidth: 0, gap: 2 },
    cardTitle: { ...type.heading, color: colors.text },
    categoryCount: {
      ...type.caption,
      color: colors.accent,
      fontWeight: "600",
      marginTop: 2,
    },
    chevron: { color: colors.muted, fontSize: 24, lineHeight: 26 },

    // Chips
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tag: {
      minHeight: 40,
      maxWidth: "100%",
      justifyContent: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    tagText: { ...type.label, color: colors.text, fontWeight: "500" },
    textButton: { minHeight: 44, justifyContent: "center", paddingVertical: 6 },
    linkText: { ...type.label, color: colors.accent, fontWeight: "700" },

    // Room at the end of a list so the floating save control never covers
    // the last rows.
    floatSpace: { paddingBottom: 160 },
    saveFloat: {
      position: "absolute",
      right: gutter,
      left: gutter,
      alignItems: "flex-end",
      gap: 8,
    },
    saveBubble: {
      maxWidth: 280,
      gap: 4,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      ...shadow(colors, "raised"),
    },
    saveHint: { ...type.caption, color: colors.muted, textAlign: "right" },
    feedback: {
      ...type.caption,
      fontSize: 14,
      color: colors.text,
      fontWeight: "600",
      textAlign: "right",
    },
    saveButton: {
      minHeight: 52,
      borderRadius: radius.pill,
      paddingVertical: 12,
      paddingHorizontal: 22,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
      // A deep, soft shadow lifts the button off the list behind it.
      ...shadow(colors, "floating"),
    },
    saveIconButton: {
      width: 60,
      height: 60,
      borderRadius: 30,
      paddingVertical: 0,
      paddingHorizontal: 0,
    },
    // Inactive keeps the app green but paler, with a lighter shadow. The
    // button itself stays solid so list rows do not show through; the wash
    // below tints it toward the page colour.
    saveButtonDisabled: {
      shadowOpacity: 0.16,
      elevation: 4,
    },
    saveButtonWash: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderRadius: 30,
      backgroundColor: colors.background,
      opacity: 0.5,
    },
    // Pressing sinks the button toward the surface.
    saveButtonPressed: {
      transform: [{ scale: 0.94 }],
      shadowOffset: { width: 0, height: 3 },
      shadowRadius: 6,
      elevation: 4,
    },
    saveButtonText: {
      ...type.label,
      fontSize: 16,
      color: colors.background,
      fontWeight: "700",
      textAlign: "center",
    },

    primaryButton: {
      minHeight: 52,
      borderRadius: radius.pill,
      paddingHorizontal: 20,
      paddingVertical: 12,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    },
    primaryText: {
      ...type.label,
      fontSize: 16,
      color: colors.background,
      fontWeight: "700",
      textAlign: "center",
    },
    disabled: { opacity: 0.55 },
    pressed: { opacity: 0.8 },

    // Activity picker and person sheets
    pickerHeader: { paddingHorizontal: gutter, paddingTop: 4, gap: 6 },
    pickerTitle: { ...type.display, fontSize: 26, color: colors.text },
    activityRow: {
      ...card(colors),
      minHeight: 60,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    checkbox: {
      width: 26,
      height: 26,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: colors.muted,
      justifyContent: "center",
      alignItems: "center",
    },
    checkedBox: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkmark: {
      color: colors.background,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
    },
    activityText: { ...type.body, flex: 1, fontSize: 17, color: colors.text },
    searchBar: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 16,
    },
    avatarText: { color: colors.accent, fontSize: 17, fontWeight: "700" },
    peopleHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
    profilePhoto: { width: 104, height: 104, borderRadius: 52 },
    profileInitials: {
      width: 104,
      height: 104,
      borderRadius: 52,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
  });
}
