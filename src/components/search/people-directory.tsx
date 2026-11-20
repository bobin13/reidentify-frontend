import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { router, useFocusEffect } from "expo-router";

import {
  ActivityIndicator,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { ModalSafeArea } from "../modal-safe-area";

import { useAppTheme } from "../../context/theme-context";
import { ApiError, apiRequest } from "../../lib/api";
import { auth } from "../../lib/firebase";
import { createStyles } from "./search-styles";

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

// People search and public profiles for the Search screen.
export function PeopleDirectory({
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

export function PublicPerson({
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
