import { useMemo } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { AppColors } from "../../constants/app-colors";
import { useAppTheme } from "../../context/theme-context";
import { sampleConversations } from "../../data/sample-conversations";

export default function ConversationScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { id } = useLocalSearchParams<{ id: string }>();
  const conversation = sampleConversations.find(
    (item) => item.id === id
  );

  const screenOptions = {
    title: conversation?.name ?? "Conversation",
    headerShown: true,
    headerStyle: {
      backgroundColor: colors.surface,
    },
    headerTintColor: colors.text,
  };

  if (!conversation) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={screenOptions} />
        <Text style={styles.notFound}>
          Conversation not found.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={screenOptions} />

      <View style={styles.contact}>
        <Text style={styles.handle}>
          {conversation.handle}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.messages}
        showsVerticalScrollIndicator={false}
      >
        {conversation.messages.map((message) => {
          const isOwnMessage = message.sender === "you";

          return (
            <View
              key={message.id}
              style={[
                styles.messageGroup,
                isOwnMessage
                  ? styles.ownMessageGroup
                  : styles.theirMessageGroup,
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  isOwnMessage
                    ? styles.ownBubble
                    : styles.theirBubble,
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    isOwnMessage && styles.ownMessageText,
                  ]}
                >
                  {message.text}
                </Text>
              </View>

              <Text style={styles.messageTimestamp}>
                {message.timestamp}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    contact: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    handle: {
      color: colors.muted,
      fontSize: 13,
    },
    messages: {
      flexGrow: 1,
      justifyContent: "flex-end",
      gap: 16,
      padding: 20,
    },
    messageGroup: {
      maxWidth: "82%",
      gap: 5,
    },
    ownMessageGroup: {
      alignSelf: "flex-end",
      alignItems: "flex-end",
    },
    theirMessageGroup: {
      alignSelf: "flex-start",
      alignItems: "flex-start",
    },
    bubble: {
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 8,
    },
    ownBubble: {
      backgroundColor: colors.accent,
    },
    theirBubble: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    messageText: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 21,
    },
    ownMessageText: {
      color: colors.background,
    },
    messageTimestamp: {
      color: colors.muted,
      fontSize: 11,
    },
    notFound: {
      padding: 20,
      color: colors.muted,
      fontSize: 15,
    },
  });
}