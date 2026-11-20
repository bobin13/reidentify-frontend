import { useCallback, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import { auth } from "./firebase";
import { groupError, groupRequest, type CommunityGroup } from "./groups";
import { getChats, messageError, type Chat } from "./messaging";

// One shared copy of the member's direct chats and groups. The tab bar's
// unread dot, the Messages list and the Groups list all read from it, so
// the two endpoints are polled once instead of once per screen.

export type Inbox = {
  owner: string;
  // null until the first response for `owner` arrives.
  chats: Chat[] | null;
  groups: CommunityGroup[] | null;
  chatsError: string;
  groupsError: string;
};

const POLL_MS = 10000;
const EMPTY: Inbox = {
  owner: "",
  chats: null,
  groups: null,
  chatsError: "",
  groupsError: "",
};

let inbox = EMPTY;
const listeners = new Set<() => void>();
let inFlight: { uid: string; promise: Promise<void> } | null = null;
let started = 0;
let published = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// `force` starts a new request even if a poll is already running, for
// moments that need fresh numbers (a screen opening, a chat just read).
// Responses that arrive out of order are dropped.
export function refreshInbox(uid: string, force = false): Promise<void> {
  if (!uid) return Promise.resolve();
  if (!force && inFlight?.uid === uid) return inFlight.promise;

  const ticket = ++started;
  const promise = (async () => {
    const [chats, groups] = await Promise.allSettled([
      getChats(uid),
      groupRequest<{ groups: CommunityGroup[] }>(uid, "/api/groups/mine"),
    ]);
    if (ticket < published || auth.currentUser?.uid !== uid) return;
    published = ticket;
    const base = inbox.owner === uid ? inbox : { ...EMPTY, owner: uid };
    inbox = {
      owner: uid,
      chats:
        chats.status === "fulfilled" ? chats.value.conversations : base.chats,
      chatsError:
        chats.status === "fulfilled" ? "" : messageError(chats.reason),
      groups:
        groups.status === "fulfilled" ? groups.value.groups : base.groups,
      groupsError:
        groups.status === "fulfilled" ? "" : groupError(groups.reason),
    };
    listeners.forEach((listener) => listener());
  })().finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { uid, promise };
  return promise;
}

export function useInbox(uid: string): Inbox {
  const current = useSyncExternalStore(subscribe, () => inbox);
  return current.owner === uid ? current : { ...EMPTY, owner: uid };
}

// The single poller, run by the tab layout. It pauses while a chat or group
// screen is pushed over the tabs (those poll their own thread) and while the
// app is in the background.
export function useInboxPolling(uid: string) {
  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      const poll = () => {
        if (!AppState.currentState || AppState.currentState === "active") {
          void refreshInbox(uid);
        }
      };
      void refreshInbox(uid, true);
      const timer = setInterval(poll, POLL_MS);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refreshInbox(uid, true);
      });
      return () => {
        clearInterval(timer);
        subscription.remove();
      };
    }, [uid]),
  );
}
