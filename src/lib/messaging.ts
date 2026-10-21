import { auth } from "./firebase";
import { apiRequest } from "./api";

export type Member = {
  id: string;
  name: string;
  area: string;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
};

export type Chat = {
  id: string;
  name: string;
  handle: string;
  preview: string;
  timestamp: string;
  unreadCount: number;
};

export type MessagePage = {
  unchanged: boolean;
  needsRead?: boolean;
  conversation?: Chat;
  messages?: ChatMessage[];
  nextCursor?: string | null;
  hasMoreNew?: boolean;
};

function account(uid: string) {
  const current = auth.currentUser;

  if (!current || current.uid !== uid) {
    throw new Error("Please sign in again.");
  }

  return current;
}

export const getMembers = (uid: string) =>
  apiRequest<{ people: Member[] }>(
    account(uid),
    "GET",
    undefined,
    "/api/people",
  );

export const getChats = (uid: string) =>
  apiRequest<{ conversations: Chat[] }>(
    account(uid),
    "GET",
    undefined,
    "/api/conversations",
  );

export const startChat = (uid: string, peerId: string) =>
  apiRequest<{ conversation: Chat }>(
    account(uid),
    "POST",
    { peerId },
    "/api/conversations",
  );

export function getMessages(
  uid: string,
  id: string,
  after?: string,
  before?: string,
) {
  const query = after
    ? `?after=${encodeURIComponent(after)}`
    : before
      ? `?before=${encodeURIComponent(before)}`
      : "";

  return apiRequest<MessagePage>(
    account(uid),
    "GET",
    undefined,
    `/api/conversations/${id}/messages${query}`,
  );
}

export const sendMessage = (
  uid: string,
  chatId: string,
  id: string,
  text: string,
) =>
  apiRequest<{ message: ChatMessage }>(
    account(uid),
    "POST",
    { id, text },
    `/api/conversations/${chatId}/messages`,
  );

export const markRead = (
  uid: string,
  id: string,
  messageId: string | null,
) =>
  apiRequest<{ read: boolean }>(
    account(uid),
    "POST",
    { messageId },
    `/api/conversations/${id}/read`,
  );

export function mergeMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
) {
  const byId = new Map(current.map((message) => [message.id, message]));

  incoming.forEach((message) => byId.set(message.id, message));

  return [...byId.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

export function fetchedCursor(
  messages: ChatMessage[],
  previous?: string,
) {
  return messages[messages.length - 1]?.id || previous || "none";
}

export function timeLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();

  return today
    ? date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
}

export const messageError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Messages could not load. Try again.";