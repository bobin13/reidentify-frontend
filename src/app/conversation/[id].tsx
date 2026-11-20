import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ChatAvatar,
  ChatBubble,
  useChatPhotos,
} from "../../components/chat-display";
import type { AppColors } from "../../constants/app-colors";
import { radius, type } from "../../constants/theme";
import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import {
  fetchedCursor,
  getMessages,
  markRead,
  mergeMessages,
  messageError,
  sendMessage,
  timeLabel,
  type Chat,
  type ChatMessage,
} from "../../lib/messaging";
import { useLatest } from "../../lib/use-latest";

type ChatState = {
  owner: string;
  chat: Chat | null;
  messages: ChatMessage[];
  cursor: string | null;
  syncedId?: string;
};

const empty: ChatState = {
  owner: "",
  chat: null,
  messages: [],
  cursor: null,
};

export default function ConversationScreen() {
  const params = useLocalSearchParams<{
    id: string | string[];
  }>();

  const id = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const { user } = useAuth();
  const uid = user?.id || "";
  const key = `${uid}:${id}`;

  const { colors } = useAppTheme();
  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  const insets = useSafeAreaInsets();

  const [state, setState] = useState<ChatState>(empty);
  const current = useLatest(state);

  const identity = useLatest(key);

  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);

  const sendPending = useRef(false);

  const retry = useRef<{
    id: string;
    text: string;
  } | null>(null);

  const list = useRef<FlatList<ChatMessage>>(null);
  const nearBottom = useRef(true);

  useEffect(() => {
    setDraft("");
    setSendError("");
    retry.current = null;
    nearBottom.current = true;
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      if (!uid || !id) return;

      let active = true;
      let busy = false;

      setLoadError("");

      async function refresh() {
        if (
          !active ||
          busy ||
          (AppState.currentState &&
            AppState.currentState !== "active")
        ) {
          return;
        }

        busy = true;

        try {
          const previous = current.current;

          const after =
            previous.owner === key
              ? previous.syncedId
              : undefined;

          const page = await getMessages(uid, id, after);

          if (!active || auth.currentUser?.uid !== uid) {
            return;
          }

          setLoadError("");

          if (page.unchanged) {
            if (page.needsRead) {
              await markRead(
                uid,
                id,
                after && after !== "none"
                  ? after
                  : null,
              );
            }

            return;
          }

          const messages = page.messages || [];
          const latestId = fetchedCursor(messages, after);

          setState((old) => ({
            owner: key,
            chat: page.conversation || old.chat,
            messages:
              old.owner === key
                ? mergeMessages(old.messages, messages)
                : messages,
            cursor:
              old.owner === key && old.syncedId
                ? old.cursor
                : page.nextCursor || null,
            syncedId: latestId,
          }));

          if (
            !page.hasMoreNew &&
            page.conversation?.unreadCount
          ) {
            await markRead(
              uid,
              id,
              latestId !== "none" ? latestId : null,
            );
          }
        } catch (failure) {
          if (active) {
            setLoadError(messageError(failure));
          }
        } finally {
          busy = false;
        }
      }

      void refresh();

      const timer = setInterval(
        () => void refresh(),
        4000,
      );

      const subscription = AppState.addEventListener(
        "change",
        (value) => {
          if (value === "active") {
            void refresh();
          }
        },
      );

      return () => {
        active = false;
        clearInterval(timer);
        subscription.remove();
      };
    }, [uid, id, key]),
  );

  async function send() {
    const text = draft.trim();

    if (!uid || !id || !text || sendPending.current) {
      return;
    }

    sendPending.current = true;
    setSending(true);
    setSendError("");

    if (!retry.current || retry.current.text !== text) {
      retry.current = {
        id: `${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 14)}`,
        text,
      };
    }

    const request = retry.current;

    try {
      const data = await sendMessage(
        uid,
        id,
        request.id,
        text,
      );

      if (
        identity.current !== key ||
        auth.currentUser?.uid !== uid
      ) {
        return;
      }

      nearBottom.current = true;

      setState((old) =>
        old.owner === key
          ? {
              ...old,
              messages: mergeMessages(
                old.messages,
                [data.message],
              ),
            }
          : old,
      );

      setDraft("");
      retry.current = null;
    } catch (failure) {
      if (identity.current === key) {
        setSendError(messageError(failure));
      }
    } finally {
      sendPending.current = false;
      setSending(false);
    }
  }

  async function older() {
    if (
      olderLoading ||
      !uid ||
      !id ||
      state.owner !== key ||
      !state.cursor
    ) {
      return;
    }

    nearBottom.current = false;
    setOlderLoading(true);

    try {
      const page = await getMessages(
        uid,
        id,
        undefined,
        state.cursor,
      );

      if (
        identity.current === key &&
        auth.currentUser?.uid === uid
      ) {
        setState((old) => ({
          ...old,
          messages: mergeMessages(
            old.messages,
            page.messages || [],
          ),
          cursor: page.nextCursor || null,
        }));
      }
    } catch (failure) {
      if (identity.current === key) {
        setLoadError(messageError(failure));
      }
    } finally {
      setOlderLoading(false);
    }
  }

  const chat =
    state.owner === key ? state.chat : null;

  const messages =
    state.owner === key ? state.messages : [];

  const photos = useChatPhotos(
    [
      ...(chat?.peerId ? [chat.peerId] : []),
      ...messages.map((message) => message.senderId),
    ],
  );

  const goBack = () =>
    router.canGoBack()
      ? router.back()
      : router.replace("/messages");

  const sendDisabled =
    !draft.trim() || sending || !chat;

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>
          Sign in to view this conversation.
        </Text>

        <Pressable
          style={styles.send}
          onPress={() => router.push("/profile")}
        >
          <Text style={styles.sendText}>
            Go to profile
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={
        Platform.OS === "ios" ? "padding" : "height"
      }
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to messages"
          style={styles.back}
          onPress={goBack}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <ChatAvatar
            name={chat?.name || "Conversation"}
            uri={chat?.peerId ? photos[chat.peerId] : undefined}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {chat?.name || "Conversation"}
            </Text>

            {!!chat?.handle && (
              <Text style={styles.muted}>
                {chat.handle}
              </Text>
            )}
          </View>
        </View>
      </View>

      {!!loadError && (
        <Text
          accessibilityRole="alert"
          style={styles.error}
        >
          {loadError}
        </Text>
      )}

      {!chat && !loadError && (
        <ActivityIndicator
          style={{ margin: 20 }}
          color={colors.accent}
        />
      )}

      <FlatList
        ref={list}
        style={{ flex: 1 }}
        data={messages}
        keyExtractor={(message) => message.id}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent }) => {
          nearBottom.current =
            nativeEvent.contentSize.height -
              nativeEvent.contentOffset.y -
              nativeEvent.layoutMeasurement.height <
            100;
        }}
        onContentSizeChange={() => {
          if (nearBottom.current) {
            list.current?.scrollToEnd({
              animated: false,
            });
          }
        }}
        ListHeaderComponent={
          state.owner === key && state.cursor ? (
            <Pressable
              style={styles.back}
              disabled={olderLoading}
              onPress={() => void older()}
            >
              <Text style={styles.muted}>
                {olderLoading
                  ? "Loading…"
                  : "Load older messages"}
              </Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          chat ? (
            <Text style={styles.muted}>
              Say hello to start your conversation.
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => {
          const own =
            item.senderId === uid ||
            item.senderId === auth.currentUser?.uid;
          const previous = messages[index - 1];

          const continuing =
            !!previous &&
            previous.senderId === item.senderId;

          return (
            <ChatBubble
              own={own}
              name={
                own
                  ? user.fullName
                  : chat?.name || "Member"
              }
              photoUri={photos[item.senderId]}
              text={item.text}
              time={timeLabel(item.createdAt)}
              createdAt={item.createdAt}
              showSender={!continuing}
              variant="direct"
            />
          );
        }}
      />

      {!!sendError && (
        <Text
          accessibilityRole="alert"
          style={styles.error}
        >
          {sendError}
        </Text>
      )}

      <View
        style={[
          styles.composer,
          {
            paddingBottom: Math.max(
              12,
              insets.bottom,
            ),
          },
        ]}
      >
        <TextInput
          accessibilityLabel="Message"
          style={styles.input}
          placeholder="Write a message"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={2000}
          value={draft}
          onChangeText={setDraft}
          editable={!sending}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled: sendDisabled,
            busy: sending,
          }}
          disabled={sendDisabled}
          onPress={() => void send()}
          style={[
            styles.send,
            sendDisabled && { opacity: 0.5 },
          ]}
        >
          {sending ? (
            <ActivityIndicator
              color={colors.background}
            />
          ) : (
            <Text style={styles.sendText}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: {
      flex: 1,
      padding: 24,
      gap: 16,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    back: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 8,
    },
    backText: { ...type.label, color: colors.accent },
    title: { ...type.heading, fontSize: 18, color: colors.text, fontWeight: "700" },
    body: { ...type.body, color: colors.text },
    muted: { ...type.caption, color: colors.muted },
    messages: {
      flexGrow: 1,
      justifyContent: "flex-end",
      gap: 0,
      padding: 14,
    },
    error: { ...type.body, fontSize: 15, color: colors.text, padding: 12 },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      padding: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    input: {
      flex: 1,
      minHeight: 46,
      maxHeight: 140,
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.surfaceAlt,
    },
    send: {
      minHeight: 46,
      minWidth: 68,
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.accent,
    },
    sendText: { ...type.label, color: colors.background, fontWeight: "700" },
  });
}
