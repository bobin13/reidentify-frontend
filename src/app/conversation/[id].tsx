
import { useCallback, useMemo, useState, useRef } from "react";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { AppColors } from "../../constants/app-colors";
import { useAppTheme } from "../../context/theme-context";
import type { ConversationMessage } from "../../data/sample-conversations";
import {
  markConversationRead,
  sendConversationMessage,
  type StoredConversation,
} from "../../data/conversation-storage";

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = typeof id === "string" ? id : "";

  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [conversation, setConversation] =
    useState<StoredConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList<ConversationMessage>>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadConversation() {
        try {
          const result = await markConversationRead(conversationId);

          if (active) {
            setConversation(result);
            setLoading(false);
          }
        } catch {
          if (active) {
            setLoading(false);
            Alert.alert("Error", "Could not open this conversation.");
          }
        }
      }

      loadConversation();

      return () => {
        active = false;
      };
    }, [conversationId]),
  );

  async function handleSend() {
    const text = draft.trim();

    if (!text || sending || !conversation) return;

    setSending(true);

    try {
      const updated = await sendConversationMessage(
        conversation.id,
        text,
      );

      setConversation(updated);
      setDraft("");
    } catch {
      Alert.alert(
        "Message not saved",
        "Please try sending your message again.",
      );
    } finally {
      setSending(false);
    }
  }

  function renderMessage({ item }: { item: ConversationMessage }) {
    const isMine = item.sender === "you";

    return (
      <View
        style={[
          styles.messageRow,
          isMine && styles.myMessageRow,
        ]}
      >
        <View
          style={[
            styles.bubble,
            isMine ? styles.myBubble : styles.theirBubble,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isMine && styles.myMessageText,
            ]}
          >
            {item.text}
          </Text>

          <Text
            style={[
              styles.messageTime,
              isMine && styles.myMessageTime,
            ]}
          >
            {item.timestamp}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: conversation?.name ?? "Conversation",
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerTintColor: colors.text,
        }}
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {loading ? (
          <ActivityIndicator
            style={styles.loading}
            color={colors.accent}
          />
        ) : !conversation ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              Conversation not found.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.contactHeader}>
              <Text style={styles.handle}>
                {conversation.handle}
              </Text>
            </View>

            <FlatList
              ref={listRef}
              style={styles.messageList}
              contentContainerStyle={styles.messageListContent}
              data={conversation.messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() =>
                listRef.current?.scrollToEnd({ animated: true })
              }
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  No messages yet. Start a conversation!
                </Text>
              }
            />

            <View style={styles.composer}>
              <TextInput
                style={styles.messageInput}
                value={draft}
                onChangeText={setDraft}
                placeholder="Type a message..."
                placeholderTextColor={colors.muted}
                multiline
                maxLength={2000}
                accessibilityLabel="Message text"
              />

              <Pressable
                style={[
                  styles.sendButton,
                  (!draft.trim() || sending) && styles.disabledButton,
                ]}
                onPress={handleSend}
                disabled={!draft.trim() || sending}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                <Text style={styles.sendButtonText}>
                  Send
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    loading: {
      flex: 1,
    },
    contactHeader: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    handle: {
      color: colors.muted,
      fontSize: 13,
      textAlign: "center",
    },
    messageList: {
      flex: 1,
    },
    messageListContent: {
      padding: 16,
      gap: 12,
      flexGrow: 1,
      justifyContent: "flex-end",
    },
    messageRow: {
      flexDirection: "row",
      justifyContent: "flex-start",
    },
    myMessageRow: {
      justifyContent: "flex-end",
    },
    bubble: {
      maxWidth: "84%",
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 17,
    },
    theirBubble: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 4,
    },
    myBubble: {
      backgroundColor: colors.accent,
      borderBottomRightRadius: 4,
    },
    messageText: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 21,
    },
    myMessageText: {
      color: colors.background,
    },
    messageTime: {
      color: colors.muted,
      fontSize: 11,
      marginTop: 6,
      textAlign: "right",
    },
    myMessageTime: {
      color: colors.background,
      opacity: 0.7,
    },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
      padding: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    messageInput: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      color: colors.text,
      fontSize: 15,
      textAlignVertical: "top",
    },
    sendButton: {
      height: 44,
      paddingHorizontal: 18,
      borderRadius: 22,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    disabledButton: {
      opacity: 0.45,
    },
    sendButtonText: {
      color: colors.background,
      fontSize: 14,
      fontWeight: "700",
    },
    emptyContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyText: {
      color: colors.muted,
      textAlign: "center",
      fontSize: 14,
    },
  });
}
