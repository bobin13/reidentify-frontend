import { useMemo, useState } from "react";
import {
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
import { sampleConversations } from "../../data/sample-conversations";

export default function MessagesScreen() {
  const [searchText, setSearchText] = useState("");
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const filteredConversations = sampleConversations.filter((conversation) =>
    JSON.stringify(conversation)
      .toLowerCase()
      .includes(searchText.toLowerCase()),
  );

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
          <Text style={styles.subtitle}>Your recent conversations</Text>
        </View>

        <View style={styles.notificationButton}>
          <SymbolView
            name={{
              ios: "bell",
              android: "notifications",
              web: "notifications",
            }}
            size={25}
            tintColor={colors.text}
          />

          <View style={styles.notificationBadge}>
            <Text style={styles.notificationBadgeText}>3</Text>
          </View>
        </View>
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
            No conversations found.
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
      width: 19,
      height: 19,
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
