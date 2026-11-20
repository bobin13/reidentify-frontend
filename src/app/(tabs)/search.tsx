import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { router, useLocalSearchParams } from "expo-router";
import { GroupDirectory } from "../../components/community-groups";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ModalSafeArea } from "../../components/modal-safe-area";
import { SymbolView } from "expo-symbols";

import {
  INTEREST_CATEGORIES,
  MIN_INTERESTS,
  recognizedInterests,
  type InterestCategory,
} from "../../constants/interests";
import { setGuestInterestDraft } from "../../lib/guest-interests";
import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";

import { useLatest } from "../../lib/use-latest";

import { createStyles } from "../../components/search/search-styles";
import {
  PeopleDirectory,
  PublicPerson,
} from "../../components/search/people-directory";
type Section = "interests" | "groups" | "people";
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
  const currentUid = useLatest(uid);

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

