import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { GroupInbox } from "../../components/community-groups";
import { useGroupStyles } from "../../components/group-ui";

import { MessageItem } from "../../components/message-item";
import type { AppColors } from "../../constants/app-colors";
import { card, gutter, radius, type } from "../../constants/theme";
import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import {
  getChats,
  getMembers,
  messageError,
  startChat,
  timeLabel,
  type Chat,
  type Member,
} from "../../lib/messaging";

export default function MessagesScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<"direct" | "groups">(
    params.section === "groups" ? "groups" : "direct",
  );
  useEffect(() => {
    if (params.section === "groups") {
      setSection("groups");
      router.setParams({ section: undefined });
    }
  }, [params.section]);
  const { s } = useGroupStyles();
  return (
    <View style={s.root}>
      <View style={s.tabs}>
        {(["direct", "groups"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: section === value }}
            onPress={() => setSection(value)}
            style={[s.tab, section === value && s.tabActive]}
          >
            <Text style={[s.tabText, section === value && s.tabTextActive]}>
              {value === "direct" ? "Direct chats" : "Groups"}
            </Text>
          </Pressable>
        ))}
      </View>
      {section === "groups" ? <GroupInbox /> : <DirectMessagesScreen />}
    </View>
  );
}

function DirectMessagesScreen() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.id || "";
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [peopleMode, setPeopleMode] = useState(false);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const [result, setResult] = useState<{
    owner: string;
    chats: Chat[];
    people: Member[];
  }>({
    owner: "",
    chats: [],
    people: [],
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState("");

  const pending = useRef(false);
  const identity = useRef(uid);
  identity.current = uid;

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;

      let active = true;
      let busy = false;

      setError("");
      setLoading(true);

      async function refresh() {
        if (
          !active ||
          busy ||
          (AppState.currentState && AppState.currentState !== "active")
        ) {
          return;
        }

        busy = true;

        try {
          if (peopleMode) {
            const data = await getMembers(uid);

            if (active && auth.currentUser?.uid === uid) {
              setResult((old) => ({
                owner: uid,
                chats: old.owner === uid ? old.chats : [],
                people: data.people,
              }));
            }
          } else {
            const data = await getChats(uid);

            if (active && auth.currentUser?.uid === uid) {
              setResult((old) => ({
                owner: uid,
                chats: data.conversations,
                people: old.owner === uid ? old.people : [],
              }));
            }
          }

          if (active && auth.currentUser?.uid === uid) {
            setError("");
          }
        } catch (failure) {
          if (active) setError(messageError(failure));
        } finally {
          if (active) setLoading(false);
          busy = false;
        }
      }

      void refresh();

      const timer = setInterval(() => void refresh(), 10000);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });

      return () => {
        active = false;
        clearInterval(timer);
        subscription.remove();
      };
    }, [uid, peopleMode]),
  );

  async function openChat(peerId: string) {
    if (pending.current || !uid) return;

    pending.current = true;
    setOpening(peerId);
    setError("");

    try {
      const data = await startChat(uid, peerId);

      if (identity.current === uid && auth.currentUser?.uid === uid) {
        router.push({
          pathname: "/conversation/[id]",
          params: { id: data.conversation.id },
        });
      }
    } catch (failure) {
      if (identity.current === uid) {
        setError(messageError(failure));
      }
    } finally {
      pending.current = false;
      setOpening("");
    }
  }

  const chats = result.owner === uid ? result.chats : [];
  const people = result.owner === uid ? result.people : [];
  const search = query.trim().toLowerCase();

  const filteredChats = chats.filter(
    (chat) =>
      (!unreadOnly || chat.unreadCount > 0) &&
      `${chat.name} ${chat.handle} ${chat.preview}`
        .toLowerCase()
        .includes(search),
  );

  const filteredPeople = people.filter((person) =>
    `${person.name} ${person.area}`.toLowerCase().includes(search),
  );

  if (authLoading && !user) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>
          Sign in to chat with your community.
        </Text>
        <Pressable
          style={styles.button}
          onPress={() => router.push("/profile")}
        >
          <Text style={styles.buttonText}>Go to profile</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heading}>
        <Text style={styles.title}>
          {peopleMode ? "New message" : "Messages"}
        </Text>

        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            setPeopleMode(!peopleMode);
            setQuery("");
          }}
        >
          <Text style={styles.buttonText}>
            {peopleMode ? "Back" : "New message"}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle}>
        {peopleMode ? "Choose a member to chat with" : "Your conversations"}
      </Text>

      <TextInput
        accessibilityLabel={
          peopleMode ? "Search members" : "Search conversations"
        }
        style={styles.input}
        placeholder={peopleMode ? "Search names or areas" : "Search messages"}
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {!peopleMode && (
        <View style={styles.filters}>
          {[false, true].map((value) => (
            <Pressable
              key={String(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: unreadOnly === value }}
              style={[
                styles.filter,
                unreadOnly === value && styles.filterActive,
              ]}
              onPress={() => setUnreadOnly(value)}
            >
              <Text
                style={[
                  styles.filterText,
                  unreadOnly === value && styles.filterTextActive,
                ]}
              >
                {value ? "Unread" : "All"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {loading && <ActivityIndicator color={colors.accent} />}

      {!!error && (
        <Text accessibilityRole="alert" style={styles.body}>
          {error}
        </Text>
      )}

      {peopleMode
        ? filteredPeople.map((person) => (
            <Pressable
              key={person.id}
              accessibilityRole="button"
              disabled={!!opening}
              onPress={() => void openChat(person.id)}
              style={styles.person}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{person.name}</Text>
                <Text style={styles.subtitle}>
                  {person.area || "Community member"}
                </Text>
              </View>

              {opening === person.id ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.link}>Chat</Text>
              )}
            </Pressable>
          ))
        : filteredChats.map((chat) => (
            <MessageItem
              key={chat.id}
              conversation={{
                ...chat,
                timestamp: timeLabel(chat.timestamp),
              }}
            />
          ))}

      {!loading &&
        !error &&
        (peopleMode
          ? filteredPeople.length === 0
          : filteredChats.length === 0) && (
          <Text style={styles.subtitle}>
            {peopleMode
              ? "No other members found."
              : unreadOnly
                ? "No unread conversations."
                : "No conversations yet. Tap New message to start."}
          </Text>
        )}
    </ScrollView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: gutter, paddingTop: 14, paddingBottom: 32, gap: 12 },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      gap: 16,
      backgroundColor: colors.background,
    },
    heading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    title: { ...type.display, color: colors.text, flexShrink: 1 },
    subtitle: {
      ...type.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
    },
    body: { ...type.body, color: colors.text },
    link: { ...type.label, color: colors.accent, fontWeight: "700" },
    name: { ...type.heading, color: colors.text },
    input: {
      minHeight: 50,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    button: {
      minHeight: 42,
      justifyContent: "center",
      paddingHorizontal: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    buttonText: {
      ...type.label,
      color: colors.background,
      fontWeight: "700",
    },
    filters: { flexDirection: "row", gap: 8 },
    filter: {
      minHeight: 40,
      justifyContent: "center",
      paddingHorizontal: 18,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    filterActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    filterText: { ...type.label, fontSize: 14, color: colors.text },
    filterTextActive: { color: colors.background, fontWeight: "700" },
    person: {
      ...card(colors),
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      minHeight: 72,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
  });
}
