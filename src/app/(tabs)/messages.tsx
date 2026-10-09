
import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";

import { MessageItem } from "../../components/message-item";
import type { AppColors } from "../../constants/app-colors";
import { useAppTheme } from "../../context/theme-context";
import {
  getConversations,
  type StoredConversation,
} from "../../data/conversation-storage";
import { sampleConversations } from "../../data/sample-conversations";

export default function MessagesScreen() {
  const [searchText, setSearchText] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [conversations, setConversations] =
    useState<StoredConversation[]>(sampleConversations);

  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Refresh whenever you return from a chat.
  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadMessages() {
        try {
          const saved = await getConversations();

          if (active) {
            setConversations(
              [...saved].sort(
                (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
              ),
            );
          }
        } catch {
          if (active) {
            Alert.alert(
              "Messages",
              "Could not load saved conversations.",
            );
          }
        }
      }

      loadMessages();

      return () => {
        active = false;
      };
    }, []),
  );

  const unreadTotal = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );

  const filteredConversations = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return conversations.filter((conversation) => {
      if (unreadOnly && conversation.unreadCount === 0) {
        return false;
      }

      return JSON.stringify(conversation)
        .toLowerCase()
        .includes(query);
    });
  }, [conversations, searchText, unreadOnly]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headingRow}>
        <View style={styles.heading}>
          <Text style={styles.title}>Messages</Text>
          <Text style={styles.subtitle}>
            Your recent conversations
          </Text>
        </View>

        <Pressable
          style={styles.notificationButton}
          onPress={() => setUnreadOnly((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={
            unreadOnly
              ? "Show all conversations"
              : "Show unread conversations"
          }
        >
          <SymbolView
            name={{
              ios: "bell",
              android: "notifications",
              web: "notifications",
            }}
            size={25}
            tintColor={unreadOnly ? colors.accent : colors.text}
          />

          {unreadTotal > 0 && (
            <View style={styles.notificationBadge}>
              <Text style={styles.notificationBadgeText}>
                {unreadTotal > 99 ? "99+" : unreadTotal}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={styles.searchBar}>
        <SymbolView
          name={{
            ios: "magnifyingglass",
            android: "search",
            web: "search",
          }}
          size={21}
          tintColor={colors.muted}
        />

        <TextInput
          style={styles.searchInput}
          placeholder="Search messages"
          placeholderTextColor={colors.muted}
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.conversationList}>
        {filteredConversations.map((conversation) => (
          <MessageItem
            key={conversation.id}
            conversation={conversation}
          />
        ))}

        {filteredConversations.length === 0 && (
          <Text style={styles.noResults}>
            {unreadOnly && !searchText
              ? "No unread conversations."
              : "No conversations found."}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
      paddingBottom: 32,
    },
    headingRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      paddingBottom: 18,
    },
    heading: {
      gap: 4,
    },
    title: {
      color: colors.text,
      fontSize: 26,
      fontWeight: "700",
    },
    subtitle: {
      color: colors.muted,
      fontSize: 14,
    },
    notificationButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    notificationBadge: {
      position: "absolute",
      top: 0,
      right: 0,
      minWidth: 19,
      height: 19,
      paddingHorizontal: 4,
      borderRadius: 10,
      backgroundColor: "#E87561",
      alignItems: "center",
      justifyContent: "center",
    },
    notificationBadgeText: {
      color: "#FFFFFF",
      fontSize: 11,
      fontWeight: "800",
    },
    searchBar: {
      height: 54,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 15,
      marginBottom: 22,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
    },
    conversationList: {
      gap: 10,
    },
    noResults: {
      color: colors.muted,
      fontSize: 14,
      textAlign: "center",
      marginTop: 30,
    },
  });
}
