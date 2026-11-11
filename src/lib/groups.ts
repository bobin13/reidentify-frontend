import { auth } from "./firebase";
import { apiRequest } from "./api";
import { DeviceEventEmitter } from "react-native";

export const groupMapState: {
  pendingFocus: {
    uid: string;
    coordinate: { latitude: number; longitude: number };
  } | null;
} = { pendingFocus: null };

export type CommunityGroup = {
  id: string;
  name: string;
  area: string;
  description: string;
  interests: string[];
  memberCount: number;
  createdAt: string;
  lastActivityAt: string;
  deleteAfter: string;
  warning: boolean;
  preview: string;
  revision: number;
  sequence: number;
  joined: boolean;
  muted: boolean;
  hiddenMembers: string[];
  unreadCount: number;
};
export type GroupMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  sequence: number;
  revision: number;
};
export type GroupMember = {
  id: string;
  name: string;
  area: string;
  hidden: boolean;
  blocked: boolean;
};
export type GroupEvent = {
  id: string;
  requestId: string;
  creatorId: string;
  title: string;
  location: string;
  description: string;
  startsAt: string;
  endsAt: string;
  latitude: number;
  longitude: number;
};
export type GroupMessagePage = {
  group: CommunityGroup;
  messages: GroupMessage[];
  revision: number;
  moreChanges: boolean;
  nextBefore: number | null;
};

export async function groupRequest<T>(
  uid: string,
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: unknown,
): Promise<T> {
  const account = auth.currentUser;
  if (!account || account.uid !== uid) throw new Error("Please sign in again.");
  const result = await apiRequest<T>(account, method, body, path);
  if (auth.currentUser?.uid !== uid)
    throw new Error("Your account changed. Please try again.");
if (
  method === "POST" &&
  /^\/api\/groups\/[^/?]+\/(?:join|leave|delete|events(?:\/[^/?]+\/cancel)?)$/.test(
    path.split("?")[0],
  )
) {
  DeviceEventEmitter.emit("reidentify:group-map-changed", uid);
}  return result;
}
export const groupPath = (id: string) =>
  `/api/groups/${encodeURIComponent(id)}`;
export const requestId = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
export const groupError = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";
export const dateLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
export function mergeGroupMessages(old: GroupMessage[], fresh: GroupMessage[]) {
  const map = new Map(old.map((item) => [item.id, item]));
  for (const item of fresh) {
    if (!map.has(item.id) || map.get(item.id)!.revision <= item.revision)
      map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => a.sequence - b.sequence);
}