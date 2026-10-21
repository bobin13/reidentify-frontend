import { useCallback, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
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

import { MessageItem } from "../../components/message-item";
import type { AppColors } from "../../constants/app-colors";
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

      if (
        identity.current === uid &&
        auth.currentUser?.uid === uid
      ) {
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
        {peopleMode
          ? "Choose a member to chat with"
          : "Your conversations"}
      </Text>

      <TextInput
        accessibilityLabel={
          peopleMode ? "Search members" : "Search conversations"
        }
        style={styles.input}
        placeholder={
          peopleMode ? "Search names or areas" : "Search messages"
        }
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
                unreadOnly === value && { borderColor: colors.accent },
              ]}
              onPress={() => setUnreadOnly(value)}
            >
              <Text style={styles.body}>
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
                <Text style={styles.body}>Chat →</Text>
              )}
            </Pressable>
          ))
        : filteredChats.map((chat) => (
            <MessageItem
              key={chat.id}
              conversation={{
                ...chat,
                timestamp: timeLabel(chat.timestamp),
                messages: [],
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
    content: { padding: 20, paddingBottom: 32, gap: 16 },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      gap: 20,
      backgroundColor: colors.background,
    },
    heading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    title: {
      color: colors.text,
      fontSize: 26,
      fontWeight: "700",
      flexShrink: 1,
    },
    subtitle: { color: colors.muted, fontSize: 16, lineHeight: 23 },
    body: { color: colors.text, fontSize: 16, lineHeight: 23 },
    name: { color: colors.text, fontSize: 18, fontWeight: "600" },
    input: {
      minHeight: 54,
      fontSize: 17,
      color: colors.text,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 15,
      paddingVertical: 12,
    },
    button: {
      minHeight: 48,
      justifyContent: "center",
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: colors.accent,
    },
    buttonText: {
      color: colors.background,
      fontSize: 16,
      fontWeight: "700",
    },
    filters: { flexDirection: "row", gap: 12 },
    filter: {
      minHeight: 48,
      justifyContent: "center",
      paddingHorizontal: 20,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    person: {
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      minHeight: 80,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
    },
  });
}