
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  sampleConversations,
  type Conversation,
  type ConversationMessage,
} from "./sample-conversations";

const STORAGE_KEY = "reidentify_conversations_v1";

export type StoredConversation = Conversation & {
  updatedAt?: number;
};

function getDefaultConversations(): StoredConversation[] {
  return sampleConversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
    updatedAt: 0,
  }));
}

export async function getConversations(): Promise<StoredConversation[]> {
  const saved = await AsyncStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return getDefaultConversations();
  }

  const parsed: unknown = JSON.parse(saved);

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid saved conversations");
  }

  return parsed as StoredConversation[];
}

async function saveConversations(conversations: StoredConversation[]) {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(conversations),
  );
}

export async function markConversationRead(
  conversationId: string,
): Promise<StoredConversation | null> {
  const conversations = await getConversations();
  const conversation = conversations.find(
    (item) => item.id === conversationId,
  );

  if (!conversation) return null;

  if (conversation.unreadCount === 0) {
    return conversation;
  }

  const updated = { ...conversation, unreadCount: 0 };

  await saveConversations(
    conversations.map((item) =>
      item.id === conversationId ? updated : item,
    ),
  );

  return updated;
}

export async function sendConversationMessage(
  conversationId: string,
  text: string,
): Promise<StoredConversation> {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error("Message cannot be empty");
  }

  const conversations = await getConversations();
  const conversation = conversations.find(
    (item) => item.id === conversationId,
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const timestamp = new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const newMessage: ConversationMessage = {
    id: `${conversationId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sender: "you",
    text: trimmedText,
    timestamp,
  };

  const updated: StoredConversation = {
    ...conversation,
    messages: [...conversation.messages, newMessage],
    preview: trimmedText,
    timestamp,
    unreadCount: 0,
    updatedAt: Date.now(),
  };

  await saveConversations(
    conversations.map((item) =>
      item.id === conversationId ? updated : item,
    ),
  );

  return updated;
}
