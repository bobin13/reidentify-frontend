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
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ModalSafeArea } from "../../components/modal-safe-area";

import {
  ChatBubble,
  useChatPhotos,
} from "../../components/chat-display";
import {
  ExpiryNotice,
  GroupButton,
  useGroupStyles,
} from "../../components/group-ui";
import { GroupEvents } from "../../components/group-events";
import { useAuth } from "../../context/auth-context";
import type { AppColors } from "../../constants/app-colors";
import { radius, shadow, type } from "../../constants/theme";
import { auth } from "../../lib/firebase";
import { ApiError } from "../../lib/api";
import { startChat } from "../../lib/messaging";
import {
  groupError,
  groupPath,
  groupRequest,
  mergeGroupMessages,
  requestId,
  type CommunityGroup,
  type GroupMember,
  type GroupMessage,
  type GroupMessagePage,
} from "../../lib/groups";
import { useLatest } from "../../lib/use-latest";

type State = {
  key: string;
  group: CommunityGroup | null;
  canDelete: boolean;
  messages: GroupMessage[];
  before: number | null;
  revision?: number;
};

const empty: State = {
  key: "",
  group: null,
  canDelete: false,
  messages: [],
  before: null,
};

type Dialog = "options" | "member" | "report" | null;

function sameDay(left: string, right: string) {
  return (
    new Date(left).toDateString() ===
    new Date(right).toDateString()
  );
}

function messageDay(value: string) {
  const date = new Date(value);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return "Today";
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear()
      ? { year: "numeric" as const }
      : {}),
  });
}

export default function GroupScreen() {
  const params = useLocalSearchParams<{
    id: string | string[];
  }>();

  const id = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const { user } = useAuth();

  const uid = user?.id || "";
  const key = `${uid}:${id}`;
  const path = groupPath(id || "");

  const { s, colors } = useGroupStyles();
  const insets = useSafeAreaInsets();

  const chat = useMemo(
    () => createChatStyles(colors),
    [colors],
  );

  const [state, setState] = useState<State>(empty);

  const current = useLatest(state);

  const identity = useLatest(key);

  const alive = useRef(true);
  const actionLock = useRef(false);
  const sendLock = useRef(false);

  const [panel, setPanel] = useState<
    "chat" | "members" | "events"
  >("chat");

  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);

  const [membersReload, setMembersReload] = useState(0);
  const [reload, setReload] = useState(0);

  const [dialog, setDialog] = useState<Dialog>(null);

  const [chosenMember, setChosenMember] =
    useState<GroupMember | null>(null);

  const [members, setMembers] = useState<{
    key: string;
    values: GroupMember[];
    cursor: string | null;
  }>({
    key: "",
    values: [],
    cursor: null,
  });

  const [report, setReport] = useState<{
    memberId?: string;
  }>({});

  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  const retry = useRef<{
    id: string;
    text: string;
  } | null>(null);

  const read = useRef(0);
  const list = useRef<FlatList<GroupMessage>>(null);
  const nearBottom = useRef(true);

  const group =
    state.key === key ? state.group : null;

  const photos = useChatPhotos(
    (state.key === key ? state.messages : [])
      .filter(
        (message) =>
          !group?.hiddenMembers.includes(message.senderId),
      )
      .map((message) => message.senderId),
  );

  const active = () =>
    alive.current && identity.current === key;

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setDraft("");
    setDialog(null);
    setChosenMember(null);
    setWorking(false);
    setSending(false);
    setOlderLoading(false);

    actionLock.current = false;
    sendLock.current = false;

    setError("");
    setNotice("");

    read.current = 0;
    retry.current = null;
    nearBottom.current = true;
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      if (!uid || !id) return;

      let focused = true;
      let busy = false;

      async function refresh() {
        if (
          !focused ||
          busy ||
          (AppState.currentState &&
            AppState.currentState !== "active")
        ) {
          return;
        }

        busy = true;

        try {
          const meta = await groupRequest<{
            group: CommunityGroup;
            canDelete: boolean;
          }>(uid, path);

          if (!focused) return;

          if (!meta.group.joined || panel !== "chat") {
            setState((old) => ({
              ...(old.key === key ? old : empty),
              key,
              group: meta.group,
              canDelete: meta.canDelete,
            }));

            setError("");
            return;
          }

          const old = current.current;

          const revision =
            old.key === key ? old.revision : undefined;

          const page = await groupRequest<GroupMessagePage>(
            uid,
            `${path}/messages${
              revision === undefined
                ? ""
                : `?revision=${revision}`
            }`,
          );

          if (!focused) return;

          setState((previous) => ({
            key,
            group: page.group,
            canDelete: meta.canDelete,
            messages:
              previous.key === key
                ? mergeGroupMessages(
                    previous.messages,
                    page.messages,
                  )
                : page.messages,
            before:
              previous.key === key &&
              previous.revision !== undefined
                ? previous.before
                : page.nextBefore,
            revision: page.revision,
          }));

          setError("");

          const delivered = Math.max(
            read.current,
            ...(old.key === key ? old.messages : []).map(
              (message) => message.sequence,
            ),
            ...page.messages.map(
              (message) => message.sequence,
            ),
            0,
          );

          if (
            delivered > read.current &&
            !page.moreChanges
          ) {
            await groupRequest(
              uid,
              `${path}/read`,
              "POST",
              { sequence: delivered },
            );

            if (focused) {
              read.current = delivered;
            }
          }
        } catch (failure) {
          if (focused) {
            setError(groupError(failure));

            if (
              failure instanceof ApiError &&
              [403, 404, 410].includes(failure.status)
            ) {
              setState(empty);
            }
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

      const listener = AppState.addEventListener(
        "change",
        (value) => {
          if (value === "active") {
            void refresh();
          }
        },
      );

      return () => {
        focused = false;
        clearInterval(timer);
        listener.remove();
      };
    }, [uid, id, key, path, panel, reload]),
  );

  async function act(
    action: () => Promise<unknown>,
    success?: () => void,
  ) {
    if (actionLock.current) return;

    actionLock.current = true;
    setWorking(true);
    setError("");
    setNotice("");

    try {
      await action();

      if (active()) {
        success?.();
        setReload((value) => value + 1);
      }
    } catch (failure) {
      if (active()) {
        setError(groupError(failure));
      }
    } finally {
      if (active()) {
        actionLock.current = false;
        setWorking(false);
      }
    }
  }

  async function send() {
    const text = draft.trim();

    if (
      !text ||
      !group?.joined ||
      sendLock.current
    ) {
      return;
    }

    sendLock.current = true;
    setSending(true);
    setError("");

    if (
      !retry.current ||
      retry.current.text !== text
    ) {
      retry.current = {
        id: requestId(),
        text,
      };
    }

    try {
      const data = await groupRequest<{
        message: GroupMessage;
      }>(
        uid,
        `${path}/messages`,
        "POST",
        retry.current,
      );

      if (active()) {
        setState((old) =>
          old.key === key
            ? {
                ...old,
                messages: mergeGroupMessages(
                  old.messages,
                  [data.message],
                ),
              }
            : old,
        );

        setDraft("");
        retry.current = null;
        nearBottom.current = true;
        setReload((value) => value + 1);
      }
    } catch (failure) {
      if (active()) {
        setError(groupError(failure));
      }
    } finally {
      if (active()) {
        sendLock.current = false;
        setSending(false);
      }
    }
  }

  async function older() {
    if (
      olderLoading ||
      state.key !== key ||
      state.before === null
    ) {
      return;
    }

    nearBottom.current = false;
    setOlderLoading(true);

    try {
      const page = await groupRequest<GroupMessagePage>(
        uid,
        `${path}/messages?before=${state.before}`,
      );

      if (active()) {
        setState((old) =>
          old.key === key
            ? {
                ...old,
                messages: mergeGroupMessages(
                  old.messages,
                  page.messages,
                ),
                before: page.nextBefore,
              }
            : old,
        );
      }
    } catch (failure) {
      if (active()) {
        setError(groupError(failure));
      }
    } finally {
      if (active()) {
        setOlderLoading(false);
      }
    }
  }

  async function loadMembers(cursor?: string) {
    await act(async () => {
      const data = await groupRequest<{
        members: GroupMember[];
        nextCursor: string | null;
      }>(
        uid,
        `${path}/members${
          cursor ? `?cursor=${cursor}` : ""
        }`,
      );

      if (active()) {
        setMembers((old) => ({
          key,
          values:
            cursor && old.key === key
              ? [...old.values, ...data.members]
              : data.members,
          cursor: data.nextCursor,
        }));
      }
    });
  }

  useEffect(() => {
    if (panel === "members" && group?.joined) {
      void loadMembers();
    }
  }, [
    panel,
    key,
    group?.joined,
    membersReload,
  ]);

  function confirmLeave() {
    Alert.alert(
      "Leave this group?",
      group?.memberCount === 1
        ? "You are the last member. Leaving closes the group and cancels its upcoming events. Its chat history remains subject to the inactivity deletion rule."
        : "You will stop receiving group messages. You can find and join this public group again later.",
      [
        {
          text: "Stay",
          style: "cancel",
        },
        {
          text: "Leave group",
          style: "destructive",
          onPress: () =>
            void act(
              () =>
                groupRequest(
                  uid,
                  `${path}/leave`,
                  "POST",
                ),
              () =>
                router.replace({
                  pathname: "/(tabs)/messages",
                  params: { section: "groups" },
                }),
            ),
        },
      ],
    );
  }

  function beginReport(target: { memberId: string }) {
    setReport(target);
    setReason("");
    setDetails("");
    setDialog("report");
  }

  function preferences(
    body: unknown,
    done?: () => void,
  ) {
    void act(
      () =>
        groupRequest(
          uid,
          `${path}/preferences`,
          "PUT",
          body,
        ),
      () => {
        setDialog(null);
        done?.();
      },
    );
  }

  if (!user) {
    return (
      <View style={[s.root, s.content]}>
        <Text style={s.body}>
          Sign in to view this group.
        </Text>

        <GroupButton
          label="Go to profile"
          onPress={() =>
            router.push("/(tabs)/profile")
          }
        />
      </View>
    );
  }

  if (!id) {
    return (
      <View style={[s.root, s.content]}>
        <Text style={s.body}>
          Group not found.
        </Text>

        <GroupButton
          label="Back to messages"
          onPress={() =>
            router.replace({
              pathname: "/(tabs)/messages",
              params: { section: "groups" },
            })
          }
        />
      </View>
    );
  }

  const visibleMessages = (
    state.key === key ? state.messages : []
  ).filter(
    (message) =>
      !group?.hiddenMembers.includes(message.senderId),
  );

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={
        Platform.OS === "ios" ? "padding" : "height"
      }
    >
      <View style={chat.header}>
        <View style={chat.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [
              chat.headerButton,
              pressed && s.disabled,
            ]}
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace({
                    pathname: "/(tabs)/messages",
                    params: { section: "groups" },
                  })
            }
          >
            <Text style={chat.headerButtonText}>
              ‹ Back
            </Text>
          </Pressable>

          {group?.joined && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: working,
              }}
              accessibilityLabel={
                group.muted
                  ? "Group options, alerts muted"
                  : "Group options"
              }
              style={({ pressed }) => [
                chat.headerButton,
                (working || pressed) && s.disabled,
              ]}
              disabled={working}
              onPress={() =>
                setDialog("options")
              }
            >
              <Text style={chat.headerButtonText}>
                Group options
              </Text>
            </Pressable>
          )}
        </View>

        <Text
          accessibilityRole="header"
          style={chat.title}
          numberOfLines={2}
        >
          {group?.name || "Community group"}
        </Text>

        {!!error && (
          <Text
            accessibilityRole="alert"
            style={s.body}
          >
            {error}
          </Text>
        )}

        {!!notice && (
          <Text
            accessibilityLiveRegion="polite"
            style={s.body}
          >
            {notice}
          </Text>
        )}
      </View>

      {!group ? (
        <View style={s.content}>
          {error ? (
            <GroupButton
              label="Try again"
              secondary
              onPress={() =>
                setReload((value) => value + 1)
              }
            />
          ) : (
            <ActivityIndicator
              color={colors.accent}
            />
          )}
        </View>
      ) : !group.joined ? (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.body}>
            {group.description ||
              "Meet people who enjoy similar activities."}
          </Text>

          <Text style={s.label}>
            {group.interests.join(" · ")}
          </Text>

          <Text style={s.body}>
            This is a public group. Join to read its
            conversation history and take part. All
            members have equal permissions.
          </Text>

          <ExpiryNotice group={group} />

          <GroupButton
            label={
              working ? "Joining…" : "Join group"
            }
            disabled={working}
            onPress={() =>
              void act(() =>
                groupRequest(
                  uid,
                  `${path}/join`,
                  "POST",
                ),
              )
            }
          />
        </ScrollView>
      ) : (
        <>
          <View style={chat.tabs}>
            {(
              ["chat", "members", "events"] as const
            ).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={
                  value === "members"
                    ? `Members, ${group.memberCount} ${
                        group.memberCount === 1
                          ? "member"
                          : "members"
                      }`
                    : value === "chat"
                      ? "Chat"
                      : "Events"
                }
                accessibilityState={{
                  selected: panel === value,
                }}
                style={[
                  chat.tab,
                  panel === value && chat.tabActive,
                ]}
                onPress={() => setPanel(value)}
              >
                <Text
                  style={[
                    chat.tabLabel,
                    panel === value && chat.tabLabelActive,
                  ]}
                >
                  {value === "chat"
                    ? "Chat"
                    : value === "members"
                      ? "Members"
                      : "Events"}
                </Text>

                {value === "members" && (
                  <Text
                    style={[
                      chat.memberCount,
                      panel === value && chat.tabLabelActive,
                    ]}
                  >
                    {group.memberCount}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>

          {panel === "chat" ? (
            <>
              {group.warning && (
                <View style={{ padding: 12 }}>
                  <ExpiryNotice group={group} />
                </View>
              )}

              <FlatList
                ref={list}
                style={{ flex: 1 }}
                data={visibleMessages}
                keyExtractor={(message) => message.id}
                contentContainerStyle={chat.timeline}
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
                  state.before !== null ? (
                    <GroupButton
                      label={
                        olderLoading
                          ? "Loading…"
                          : "Load older messages"
                      }
                      secondary
                      disabled={olderLoading}
                      onPress={() => void older()}
                    />
                  ) : null
                }
                ListEmptyComponent={
                  <Text style={s.muted}>
                    Say hello to your group. Hidden
                    members&apos; messages will not appear
                    here.
                  </Text>
                }
                renderItem={({ item, index }) => {
                  const previous =
                    visibleMessages[index - 1];

                  const newDay =
                    !previous ||
                    !sameDay(
                      previous.createdAt,
                      item.createdAt,
                    );

                  const continuing =
                    !!previous &&
                    previous.senderId === item.senderId;

                  const own =
                    item.senderId === uid ||
                    item.senderId === auth.currentUser?.uid;

                  return (
                    <View style={{ width: "100%" }}>
                      {newDay && (
                        <Text style={chat.day}>
                          {messageDay(item.createdAt)}
                        </Text>
                      )}

                      <ChatBubble
                        own={own}
                        name={
                          own
                            ? user.fullName
                            : item.senderName
                        }
                        photoUri={photos[item.senderId]}
                        text={
                          item.deleted
                            ? "Message removed"
                            : item.text
                        }
                        time={new Date(
                          item.createdAt,
                        ).toLocaleTimeString(
                          undefined,
                          {
                            hour: "numeric",
                            minute: "2-digit",
                          },
                        )}
                        createdAt={item.createdAt}
                        showSender={!continuing}
                        edited={
                          !!item.editedAt &&
                          !item.deleted
                        }
                        variant="group"
                      />
                    </View>
                  );
                }}
              />

              <View
                style={[
                  chat.composer,
                  {
                    paddingBottom: Math.max(
                      8,
                      insets.bottom,
                    ),
                  },
                ]}
              >
                <TextInput
                  accessibilityLabel="Group message"
                  style={chat.messageInput}
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
                  accessibilityLabel={
                    sending
                      ? "Sending message"
                      : "Send message"
                  }
                  accessibilityState={{
                    disabled:
                      sending || !draft.trim(),
                  }}
                  disabled={
                    sending || !draft.trim()
                  }
                  onPress={() => void send()}
                  style={({ pressed }) => [
                    chat.send,
                    (sending || !draft.trim()) &&
                      s.disabledButton,
                    pressed &&
                      !sending &&
                      !!draft.trim() &&
                      s.disabled,
                  ]}
                >
                  <Text
                    style={[
                      chat.sendText,
                      (sending || !draft.trim()) &&
                        s.disabledText,
                    ]}
                  >
                    {sending ? "Sending…" : "Send"}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : panel === "members" ? (
            <ScrollView
              contentContainerStyle={s.content}
            >
              <Text style={s.muted}>
                Everyone has equal membership. Nobody
                here can remove another member.
              </Text>

              {working && (
                <ActivityIndicator
                  color={colors.accent}
                />
              )}

              {(
                members.key === key
                  ? members.values
                  : []
              ).map((member) => (
                <View
                  key={member.id}
                  style={s.card}
                >
                  <Text style={s.heading}>
                    {member.name}
                    {member.id === uid ? " (you)" : ""}
                  </Text>

                  <Text style={s.muted}>
                    {member.area || "Community member"}
                  </Text>

                  {member.id !== uid && (
                    <GroupButton
                      label={`Options for ${member.name}`}
                      secondary
                      onPress={() => {
                        setChosenMember(member);
                        setDialog("member");
                      }}
                    />
                  )}
                </View>
              ))}

              {members.key === key &&
                members.cursor && (
                  <GroupButton
                    label="More members"
                    secondary
                    disabled={working}
                    onPress={() =>
                      void loadMembers(members.cursor!)
                    }
                  />
                )}
            </ScrollView>
          ) : (
            <GroupEvents
              uid={uid}
              groupId={group.id}
              onActivity={() =>
                setReload((value) => value + 1)
              }
            />
          )}
        </>
      )}

      <Modal
        visible={dialog !== null}
        animationType="slide"
        onRequestClose={() => {
          if (!working) {
            setDialog(null);
          }
        }}
      >
        <ModalSafeArea
          style={s.root}
          edges={["top", "bottom"]}
        >
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            <GroupButton
              label="Back to group"
              secondary
              disabled={working}
              onPress={() => setDialog(null)}
            />

            {!!error && (
              <Text
                accessibilityRole="alert"
                style={s.body}
              >
                {error}
              </Text>
            )}

            {dialog === "options" && group && (
              <>
                <Text
                  accessibilityRole="header"
                  style={s.title}
                >
                  Group options
                </Text>

                <Text style={s.body}>
                  {group.description}
                </Text>

                <Text style={s.muted}>
                  {group.interests.join(" · ")}
                </Text>

                <ExpiryNotice group={group} />

                <GroupButton
                  label={
                    group.muted
                      ? "Unmute group alerts"
                      : "Mute group alerts"
                  }
                  disabled={working}
                  onPress={() =>
                    preferences({
                      muted: !group.muted,
                    })
                  }
                />

                {!!group.hiddenMembers.length && (
                  <GroupButton
                    label="Show all hidden messages"
                    secondary
                    disabled={working}
                    onPress={() =>
                      preferences(
                        { clearHidden: true },
                        () =>
                          setMembersReload(
                            (value) => value + 1,
                          ),
                      )
                    }
                  />
                )}

                <Text style={s.muted}>
                  Muting suppresses this group&apos;s unread
                  alerts. You remain a member and can
                  read its messages.
                </Text>

                <Text style={s.muted}>
                  Groups and chat history are deleted
                  after 45 days without activity.
                  Scheduled events protect the group
                  until 45 days after their end.
                </Text>

                <GroupButton
                  label="Leave group"
                  secondary
                  disabled={working}
                  onPress={confirmLeave}
                />

                {state.canDelete && (
                  <GroupButton
                    label="Delete this group"
                    secondary
                    disabled={working}
                    onPress={() =>
                      Alert.alert(
                        "Delete this group?",
                        "You are its creator and only member. This permanently deletes the group, its messages and group events.",
                        [
                          {
                            text: "Keep group",
                            style: "cancel",
                          },
                          {
                            text: "Delete group",
                            style: "destructive",
                            onPress: () =>
                              void act(
                                () =>
                                  groupRequest(
                                    uid,
                                    `${path}/delete`,
                                    "POST",
                                  ),
                                () =>
                                  router.replace({
                                    pathname:
                                      "/(tabs)/messages",
                                    params: {
                                      section: "groups",
                                    },
                                  }),
                              ),
                          },
                        ],
                      )
                    }
                  />
                )}
              </>
            )}

            {dialog === "member" && chosenMember && (
              <>
                <Text
                  accessibilityRole="header"
                  style={s.title}
                >
                  {chosenMember.name}
                </Text>

                <GroupButton
                  label={
                    chosenMember.hidden
                      ? "Show their group messages"
                      : "Hide their group messages"
                  }
                  disabled={working}
                  onPress={() =>
                    preferences(
                      {
                        hiddenMemberId:
                          chosenMember.id,
                        hidden:
                          !chosenMember.hidden,
                      },
                      () =>
                        setMembersReload(
                          (value) => value + 1,
                        ),
                    )
                  }
                />

                <Text style={s.muted}>
                  This changes only what you see. It
                  does not remove this member or hide
                  messages from anyone else.
                </Text>

                <GroupButton
                  label={
                    chosenMember.blocked
                      ? "Allow direct contact"
                      : "Block direct contact"
                  }
                  secondary
                  disabled={working}
                  onPress={() =>
                    void act(
                      () =>
                        groupRequest(
                          uid,
                          "/api/contact-blocks",
                          "POST",
                          {
                            targetId:
                              chosenMember.id,
                            blocked:
                              !chosenMember.blocked,
                          },
                        ),
                      () => {
                        setDialog(null);
                        setMembersReload(
                          (value) => value + 1,
                        );
                      },
                    )
                  }
                />

                <Text style={s.muted}>
                  Blocking prevents private messages
                  between you. Shared-group messages
                  have a separate hide setting.
                </Text>

                {!chosenMember.blocked && (
                  <GroupButton
                    label="Message privately"
                    secondary
                    disabled={working}
                    onPress={() =>
                      void act(async () => {
                        const data = await startChat(
                          uid,
                          chosenMember.id,
                        );

                        if (active()) {
                          setDialog(null);

                          router.push({
                            pathname:
                              "/conversation/[id]",
                            params: {
                              id: data.conversation.id,
                            },
                          });
                        }
                      })
                    }
                  />
                )}

                <GroupButton
                  label="Report member"
                  secondary
                  onPress={() =>
                    beginReport({
                      memberId: chosenMember.id,
                    })
                  }
                />
              </>
            )}

            {dialog === "report" && (
              <>
                <Text
                  accessibilityRole="header"
                  style={s.title}
                >
                  Report a concern
                </Text>

                <Text style={s.body}>
                  Reports go to the app administrators
                  for review. Reporting does not
                  automatically remove anyone, and the
                  reported member does not see who
                  reported them.
                </Text>

                {[
                  "Harassment",
                  "Scam or spam",
                  "Private information",
                  "Other",
                ].map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: reason === value,
                    }}
                    style={[
                      s.check,
                      reason === value && s.selected,
                    ]}
                    onPress={() => setReason(value)}
                  >
                    <Text style={s.body}>
                      {reason === value ? "●" : "○"}{" "}
                      {value}
                    </Text>
                  </Pressable>
                ))}

                <TextInput
                  accessibilityLabel="Report details"
                  style={s.input}
                  placeholder="Anything else we should know? (optional)"
                  placeholderTextColor={colors.muted}
                  multiline
                  maxLength={1000}
                  value={details}
                  onChangeText={setDetails}
                  editable={!working}
                />

                <GroupButton
                  label={
                    working
                      ? "Sending…"
                      : "Send report"
                  }
                  disabled={working || !reason}
                  onPress={() =>
                    void act(
                      () =>
                        groupRequest(
                          uid,
                          `${path}/reports`,
                          "POST",
                          {
                            ...report,
                            reason,
                            details,
                          },
                        ),
                      () => {
                        setDialog(null);
                        setNotice(
                          "Your report has been sent for review.",
                        );
                      },
                    )
                  }
                />
              </>
            )}
          </ScrollView>
        </ModalSafeArea>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function createChatStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 8,
      gap: 2,
    },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    headerButton: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 8,
      borderRadius: radius.sm,
    },
    headerButtonText: { ...type.label, color: colors.accent },
    title: { ...type.title, color: colors.text },
    // Segmented control matching the Search and Messages tabs.
    tabs: {
      flexDirection: "row",
      gap: 4,
      marginHorizontal: 16,
      marginBottom: 8,
      padding: 4,
      borderRadius: radius.md + 2,
      backgroundColor: colors.surfaceAlt,
    },
    tab: {
      flex: 1,
      minHeight: 42,
      paddingHorizontal: 6,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 5,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: radius.md - 2,
    },
    tabActive: { backgroundColor: colors.accent, ...shadow(colors, "card") },
    tabLabel: { ...type.label, color: colors.muted },
    tabLabelActive: { color: colors.background, fontWeight: "700" },
    memberCount: { ...type.caption, color: colors.muted },
    timeline: {
      paddingHorizontal: 14,
      paddingTop: 2,
      paddingBottom: 12,
      flexGrow: 1,
      justifyContent: "flex-end",
    },
    day: {
      ...type.caption,
      color: colors.muted,
      textAlign: "center",
      marginVertical: 10,
    },
    messageRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
    },
    messageRowOwn: { flexDirection: "row-reverse" },
    message: {
      maxWidth: "82%",
      flexShrink: 1,
      minWidth: 88,
      paddingHorizontal: 14,
      paddingVertical: 8,
      gap: 2,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    sender: { ...type.caption, color: colors.accent, fontWeight: "600" },
    messageText: { ...type.body, color: colors.text },
    time: { ...type.caption, fontSize: 12, color: colors.muted, textAlign: "right" },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      paddingHorizontal: 12,
      paddingTop: 10,
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    messageInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 46,
      maxHeight: 120,
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
    },
    send: {
      minWidth: 68,
      minHeight: 46,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    sendText: { ...type.label, color: colors.background, fontWeight: "700" },
  });
}
