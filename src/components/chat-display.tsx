import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "firebase/auth";
import {
  Alert,
  Image,
  Switch,
  Text,
  View,
  type TextProps,
} from "react-native";

import { useAuth } from "../context/auth-context";
import { useAppTheme } from "../context/theme-context";
import { auth } from "../lib/firebase";
import { ApiError, apiRequest } from "../lib/api";

const SWEAR_WORDS =
  /^(?:motherfuck(?:er|ers|ing)?|fuck(?:s|ed|ing|er|ers)?|f\*+ck|bullshit|shit(?:s|ty|ting|head|heads)?|bitch(?:es|y|ing)?|bastards?|assholes?|arseholes?|dick(?:s|head|heads)?|cock(?:s|sucker|suckers)?|cunts?|twats?|wank(?:er|ers|ing)?|piss(?:ed|es|ing)?)$/i;

export function hideSwearWords(text: string) {
  return text.replace(
    /[a-z0-9_\u00c0-\u024f\u0300-\u036f*]+/gi,
    (word) => (SWEAR_WORDS.test(word) ? "****" : word),
  );
}

type Preference = {
  enabled: boolean;
  loaded: boolean;
  revision: number;
  listeners: Set<() => void>;
  writing: Promise<unknown>;
};

const preferences = new Map<string, Preference>();

function preference(key: string) {
  let value = preferences.get(key);

  if (!value) {
    value = {
      enabled: true,
      loaded: false,
      revision: 0,
      listeners: new Set(),
      writing: Promise.resolve(),
    };

    preferences.set(key, value);
  }

  return value;
}

const notify = (value: Preference) =>
  value.listeners.forEach((listener) => listener());

// Reads the saved choice once per account. Kept outside the hook because it
// mutates the shared store, which React Compiler does not allow in a hook.
function loadPreference(key: string) {
  const value = preference(key);
  if (value.loaded) return;

  value.loaded = true;
  const revision = value.revision;

  void AsyncStorage.getItem(key)
    .then((saved) => {
      if (value.revision !== revision) return;

      value.enabled = saved !== "off";
      notify(value);
    })
    .catch(() => {
      // Keep filtering enabled if storage is unavailable.
    });
}

async function savePreference(key: string, next: boolean) {
  const value = preference(key);
  const previous = value.enabled;
  const revision = ++value.revision;

  value.enabled = next;
  notify(value);

  const write = value.writing
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(key, next ? "on" : "off"));

  value.writing = write;

  try {
    await write;
  } catch (error) {
    if (value.revision === revision) {
      value.enabled = previous;
      notify(value);
    }

    throw error;
  }
}

export function useChatFilter() {
  const { user } = useAuth();
  const key = `reidentify:hide-swear-words:${user?.id || "guest"}`;

  const subscribe = useCallback(
    (listener: () => void) => {
      const entry = preference(key);
      entry.listeners.add(listener);

      return () => {
        entry.listeners.delete(listener);
      };
    },
    [key],
  );

  const snapshot = useCallback(
    () => preference(key).enabled,
    [key],
  );

  const enabled = useSyncExternalStore(
    subscribe,
    snapshot,
    () => true,
  );

  useEffect(() => loadPreference(key), [key]);

  const setEnabled = (next: boolean) => savePreference(key, next);

  return { enabled, setEnabled };
}

export function ChatText({
  children,
  accessibilityLabel,
  ...props
}: Omit<TextProps, "children"> & { children: string }) {
  const { enabled } = useChatFilter();

  return (
    <Text
      {...props}
      accessibilityLabel={
        enabled && accessibilityLabel
          ? hideSwearWords(accessibilityLabel)
          : accessibilityLabel
      }
    >
      {enabled ? hideSwearWords(children) : children}
    </Text>
  );
}

export function ChatFilterSetting() {
  const { colors } = useAppTheme();
  const { enabled, setEnabled } = useChatFilter();
  const [saving, setSaving] = useState(false);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 17,
            fontWeight: "600",
          }}
        >
          Profanity filter
        </Text>

        <Text
          style={{
            color: colors.muted,
            fontSize: 14,
            lineHeight: 20,
          }}
        >
          {enabled ? "On" : "Off"} · For your chats on this device
        </Text>
      </View>

      <Switch
        accessibilityLabel="Profanity filter"
        value={enabled}
        disabled={saving}
        onValueChange={(next) => {
          setSaving(true);

          void setEnabled(next)
            .catch(() =>
              Alert.alert("Couldn't save setting", "Please try again."),
            )
            .finally(() => setSaving(false));
        }}
        trackColor={{
          false: colors.border,
          true: colors.accent,
        }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

// Load each distinct sender once for the focused chat.
// Older senders beyond this limit retain initials.
// Avatars are shared by every chat and group screen. Which photo version a
// member has is re-checked at most every 5 minutes per viewer; the photo
// bytes are cached by version, which never changes content.
const PROFILE_TTL_MS = 5 * 60 * 1000;
const MAX_PHOTOS = 60;
const photoVersions = new Map<string, { version: string | null; at: number }>();
const photoData = new Map<string, string>();
const photoLoads = new Map<string, Promise<string | null>>();

// undefined: not known yet. null: the member has no visible photo.
function cachedPhoto(viewer: string, id: string): string | null | undefined {
  const saved = photoVersions.get(`${viewer}:${id}`);
  if (!saved) return undefined;
  return saved.version ? photoData.get(`${id}:${saved.version}`) : null;
}

function cachedPhotos(viewer: string, ids: readonly string[]) {
  const photos: Record<string, string> = {};
  for (const id of ids) {
    const uri = cachedPhoto(viewer, id);
    if (uri) photos[id] = uri;
  }
  return photos;
}

function loadPhoto(account: User, viewer: string, id: string) {
  const key = `${viewer}:${id}`;
  const saved = photoVersions.get(key);
  if (saved && Date.now() - saved.at < PROFILE_TTL_MS) {
    const uri = cachedPhoto(viewer, id);
    if (uri !== undefined) return Promise.resolve(uri);
  }
  const running = photoLoads.get(key);
  if (running) return running;

  const path = `/api/profiles/${encodeURIComponent(id)}`;
  const job = (async () => {
    let version: string | null;
    try {
      const { profile } = await apiRequest<{
        profile: { photoVersion: string | null };
      }>(account, "GET", undefined, path);
      version = profile.photoVersion;
    } catch (error) {
      // A missing or private profile has no photo for this viewer; other
      // failures are not remembered so the next visit tries again.
      if (error instanceof ApiError && [403, 404].includes(error.status)) {
        photoVersions.set(key, { version: null, at: Date.now() });
      }
      return null;
    }
    photoVersions.set(key, { version, at: Date.now() });
    if (!version) return null;

    const dataKey = `${id}:${version}`;
    const known = photoData.get(dataKey);
    if (known) return known;
    try {
      const { jpeg } = await apiRequest<{ jpeg: string }>(
        account,
        "GET",
        undefined,
        `${path}/photo?version=${encodeURIComponent(version)}`,
      );
      const uri = `data:image/jpeg;base64,${jpeg}`;
      photoData.set(dataKey, uri);
      while (photoData.size > MAX_PHOTOS) {
        photoData.delete(photoData.keys().next().value!);
      }
      return uri;
    } catch {
      return null;
    }
  })().finally(() => photoLoads.delete(key));
  photoLoads.set(key, job);
  return job;
}

export function useChatPhotos(senderIds: readonly string[]) {
  const { user } = useAuth();
  const uid = user?.id || "";

  const idsKey = JSON.stringify(
    [...new Set([...senderIds].reverse().filter(Boolean))]
      .slice(0, 32)
      .sort(),
  );

  const key = `${uid}:${idsKey}`;

  const [state, setState] = useState<{
    key: string;
    photos: Record<string, string>;
  }>(() => ({
    key,
    photos: cachedPhotos(uid, JSON.parse(idsKey) as string[]),
  }));

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const account = auth.currentUser;
      const ids = JSON.parse(idsKey) as string[];

      // Show what is already cached straight away, then refresh.
      setState({ key, photos: cachedPhotos(uid, ids) });

      if (!uid || !account || account.uid !== uid) return;

      let cursor = 0;

      async function worker() {
        while (active && auth.currentUser?.uid === uid) {
          const id = ids[cursor++];
          if (!id) return;

          const uri = await loadPhoto(account!, uid, id);
          if (!active || auth.currentUser?.uid !== uid) return;

          setState((old) => {
            if (old.key !== key || (old.photos[id] ?? null) === uri) return old;
            const photos = { ...old.photos };
            if (uri) photos[id] = uri;
            else delete photos[id];
            return { key, photos };
          });
        }
      }

      void worker();
      void worker();

      return () => {
        active = false;
      };
    }, [uid, idsKey, key]),
  );

  return state.key === key ? state.photos : {};
}

export function ChatAvatar({
  name,
  uri,
}: {
  name: string;
  uri?: string;
}) {
  const { colors } = useAppTheme();
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [uri]);

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] || "")
      .join("")
      .toUpperCase() || "?";

  return (
    <View
      accessible={false}
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: colors.accentSoft,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          accessible={false}
          onError={() => setFailed(true)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
          }}
        />
      ) : (
        <Text
          style={{
            color: colors.accent,
            fontSize: 11,
            fontWeight: "700",
          }}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}

export function ChatBubble({
  own,
  name,
  photoUri,
  text,
  time,
  createdAt,
  showSender,
  variant = "group",
  edited = false,
}: {
  own: boolean;
  name: string;
  photoUri?: string;
  text: string;
  time: string;
  createdAt: string;
  showSender: boolean;
  variant?: "group" | "direct";
  edited?: boolean;
}) {
  const { colors } = useAppTheme();
  // Own messages are filled with the accent in both direct and group chats.
  const green = own;
  void variant;

  return (
    <View
      style={{
        alignSelf: own ? "flex-end" : "flex-start",
        maxWidth: "86%",
        marginTop: showSender ? 10 : 3,
        paddingHorizontal: 14,
        paddingTop: 8,
        paddingBottom: 7,
        borderWidth: 1,
        borderColor: green ? colors.accent : colors.border,
        borderRadius: 20,
        // The corner nearest the sender is tightened into a tail.
        borderBottomRightRadius: own ? 6 : 20,
        borderBottomLeftRadius: own ? 20 : 6,
        backgroundColor: green ? colors.accent : colors.surface,
      }}
    >
      {showSender && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            marginBottom: 3,
          }}
        >
          <ChatAvatar name={name} uri={photoUri} />

          <Text
            style={{
              color: green
                ? colors.background
                : colors.accent,
              fontSize: 14,
              lineHeight: 20,
              fontWeight: "600",
              flexShrink: 1,
            }}
          >
            {name}
          </Text>
        </View>
      )}

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          columnGap: 8,
          rowGap: 0,
        }}
      >
        <ChatText
          style={{
            color: green
              ? colors.background
              : colors.text,
            fontSize: 16,
            lineHeight: 22,
            maxWidth: "100%",
            flexShrink: 1,
          }}
          accessibilityLabel={`${own ? "You" : name}: ${text}`}
        >
          {text}
        </ChatText>

        <Text
          accessibilityLabel={`${new Date(
            createdAt,
          ).toLocaleString()}${edited ? ", edited" : ""}`}
          style={{
            color: green
              ? colors.background
              : colors.muted,
            fontSize: 11,
            lineHeight: 16,
            opacity: green ? 0.75 : 1,
            marginLeft: "auto",
            flexShrink: 0,
            textAlign: "right",
            paddingBottom: 1,
          }}
        >
          {time}
          {edited ? " · Edited" : ""}
        </Text>
      </View>
    </View>
  );
}