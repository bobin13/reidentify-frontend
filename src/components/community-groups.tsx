import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { ModalSafeArea } from "./modal-safe-area";
import { useAuth } from "../context/auth-context";
import { INTEREST_CATEGORIES } from "../constants/interests";
import { resolveArea, selectionForProfile } from "../lib/locations";
import {
  groupError,
  groupRequest,
  requestId,
  type CommunityGroup,
} from "../lib/groups";
import { GroupButton, GroupCard, useGroupStyles } from "./group-ui";
import { refreshInbox, useInbox } from "../lib/inbox";
import { useLatest } from "../lib/use-latest";

const openGroup = (id: string) =>
  router.push({ pathname: "/group/[id]", params: { id } });

export function GroupInbox() {
  const { user } = useAuth();
  const uid = user?.id || "";
  const { s, colors } = useGroupStyles();
  const inbox = useInbox(uid);
  const [query, setQuery] = useState(""),
    [unread, setUnread] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  // Groups come from the shared inbox, which the tab layout keeps polling.
  // Opening this list asks for fresh numbers right away.
  useFocusEffect(
    useCallback(() => {
      if (uid) void refreshInbox(uid, true);
    }, [uid]),
  );
  const error = inbox.groupsError;
  const loading = !!uid && inbox.groups === null && !error;
  if (!user)
    return (
      <View style={s.content}>
        <Text style={s.body}>Sign in to join group conversations.</Text>
        <GroupButton
          label="Go to profile"
          onPress={() => router.push("/(tabs)/profile")}
        />
      </View>
    );
  const groups = (inbox.groups ?? []).filter(
    (g) =>
      (!unread || g.unreadCount > 0) &&
      `${g.name} ${g.area} ${g.preview}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <ScrollView
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" style={s.title}>
        Group conversations
      </Text>
      <GroupButton
        label="Find or create a group"
        onPress={() =>
          router.push({
            pathname: "/(tabs)/search",
            params: { section: "groups" },
          })
        }
      />
      <GroupButton
        label="Blocked contacts"
        secondary
        onPress={() => setShowBlocked(true)}
      />
      <TextInput
        style={s.input}
        accessibilityLabel="Search your groups"
        placeholder="Search your groups"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
      />
      <View style={s.row}>
        {[false, true].map((v) => (
          <GroupButton
            key={String(v)}
            label={v ? "Unread" : "All groups"}
            secondary={unread !== v}
            onPress={() => setUnread(v)}
          />
        ))}
      </View>
      {loading && <ActivityIndicator color={colors.accent} />}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={s.body}>
            {error}
          </Text>
          <GroupButton
            label="Try again"
            onPress={() => void refreshInbox(uid, true)}
            secondary
          />
        </>
      )}
      {groups.map((g) => (
        <GroupCard key={g.id} group={g} onPress={() => openGroup(g.id)} />
      ))}
      {!loading && !error && !groups.length && (
        <Text style={s.muted}>
          {unread
            ? "No unread group conversations."
            : "No groups to show. Find a community group or create one."}
        </Text>
      )}
      {showBlocked && (
        <BlockedContacts
          key={uid}
          uid={uid}
          onClose={() => setShowBlocked(false)}
        />
      )}
    </ScrollView>
  );
}

function BlockedContacts({
  uid,
  onClose,
}: {
  uid: string;
  onClose: () => void;
}) {
  const { s } = useGroupStyles();
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void groupRequest<{ people: { id: string; name: string }[] }>(
      uid,
      "/api/contact-blocks",
    )
      .then((data) => {
        if (alive.current) setPeople(data.people);
      })
      .catch((e) => {
        if (alive.current) setError(groupError(e));
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
    return () => {
      alive.current = false;
    };
  }, [uid]);
  async function unblock(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await groupRequest(uid, "/api/contact-blocks", "POST", {
        targetId: id,
        blocked: false,
      });
      if (alive.current) {
        setPeople((old) => old.filter((p) => p.id !== id));
        setError("");
      }
    } catch (e) {
      if (alive.current) setError(groupError(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ModalSafeArea style={s.root} edges={["top", "bottom"]}>
        <ScrollView contentContainerStyle={s.content}>
          <GroupButton
            label="Back to group conversations"
            secondary
            onPress={onClose}
          />
          <Text accessibilityRole="header" style={s.title}>
            Blocked contacts
          </Text>
          <Text style={s.muted}>
            Blocking stops private messages between you and that member. It does
            not remove either person from a public group.
          </Text>
          {!!error && (
            <Text accessibilityRole="alert" style={s.body}>
              {error}
            </Text>
          )}
          {people.map((p) => (
            <View key={p.id} style={s.card}>
              <Text style={s.heading}>{p.name}</Text>
              <GroupButton
                label={`Allow contact with ${p.name}`}
                secondary
                disabled={busy}
                onPress={() => void unblock(p.id)}
              />
            </View>
          ))}
          {!busy && !error && !people.length && (
            <Text style={s.body}>No blocked contacts.</Text>
          )}
        </ScrollView>
      </ModalSafeArea>
    </Modal>
  );
}

export function GroupDirectory({ search }: { search: string }) {
  const { user } = useAuth();
  const uid = user?.id || "";
  const { s, colors } = useGroupStyles();
  const [interestsOnly, setInterestsOnly] = useState(false);
  const [creating, setCreating] = useState(false),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    groups: CommunityGroup[];
    cursor: string | null;
  }>({ key: "", groups: [], cursor: null });
  const matchInterests = interestsOnly && !!user?.interests.length;
  const key = JSON.stringify([uid, search, matchInterests, user?.interests]);
  const identity = useLatest(key);
  const paging = useRef(false);
  const tagQuery = matchInterests ? user!.interests.join("|") : "";
  const url = `/api/groups?search=${encodeURIComponent(search)}${
    tagQuery ? `&interests=${encodeURIComponent(tagQuery)}` : ""
  }`;
  useEffect(() => {
    setCreating(false);
    setInterestsOnly(false);
  }, [uid]);
  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      let active = true;
      setLoading(true);
      setError("");
      const timer = setTimeout(() => {
        void groupRequest<{
          groups: CommunityGroup[];
          nextCursor: string | null;
        }>(uid, url)
          .then((data) => {
            if (active)
              setResult({ key, groups: data.groups, cursor: data.nextCursor });
          })
          .catch((e) => {
            if (active) setError(groupError(e));
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      }, 250);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [uid, key, url, reload]),
  );
  async function more() {
    if (paging.current || !result.cursor || result.key !== key) return;
    paging.current = true;
    setLoading(true);
    try {
      const data = await groupRequest<{
        groups: CommunityGroup[];
        nextCursor: string | null;
      }>(uid, `${url}&cursor=${encodeURIComponent(result.cursor)}`);
      if (identity.current === key)
        setResult((old) => ({
          key,
          groups: [
            ...new Map(
              [...old.groups, ...data.groups].map((g) => [g.id, g]),
            ).values(),
          ],
          cursor: data.nextCursor,
        }));
    } catch (e) {
      if (identity.current === key) setError(groupError(e));
    } finally {
      paging.current = false;
      if (identity.current === key) setLoading(false);
    }
  }
  if (!user)
    return (
      <View style={s.card}>
        <Text style={s.body}>Sign in to find and join community groups.</Text>
        <GroupButton
          label="Go to profile"
          onPress={() => router.push("/(tabs)/profile")}
        />
      </View>
    );
  const groups = result.key === key ? result.groups : [];
  return (
    <View style={{ gap: 14 }}>
      <GroupButton
        label="Create a community group"
        onPress={() => setCreating(true)}
      />
      <Text style={s.muted}>
        All groups are public. Anyone using ReIdentify can find and join them.
      </Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: matchInterests,
          disabled: !user.interests.length,
        }}
        disabled={!user.interests.length}
        onPress={() => setInterestsOnly(!interestsOnly)}
        style={s.check}
      >
        <Text style={s.body}>
          {matchInterests ? "☑" : "☐"} Match my saved interests
        </Text>
      </Pressable>
      {!user.interests.length && (
        <Text style={s.muted}>
          Save interests in the Interests tab to use this optional filter.
        </Text>
      )}
      {loading && <ActivityIndicator color={colors.accent} />}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={s.body}>
            {error}
          </Text>
          <GroupButton
            label="Try again"
            secondary
            onPress={() => setReload((v) => v + 1)}
          />
        </>
      )}
      {groups.map((g) => (
        <GroupCard key={g.id} group={g} onPress={() => openGroup(g.id)} />
      ))}
      {result.key === key && result.cursor && (
        <GroupButton
          label="Find more groups"
          secondary
          disabled={loading}
          onPress={() => void more()}
        />
      )}
      {!loading && !error && result.key === key && !groups.length && (
        <Text style={s.muted}>
          {result.key === key && result.cursor
            ? "More groups are available to explore. Try Find more groups or adjust your filters."
            : matchInterests
              ? "No matching groups found. Try a shorter search or turn off Match my saved interests."
              : "No matching groups found. Try part of a group name or an activity, or create a group."}
        </Text>
      )}
      {creating && (
        <CreateGroup
          key={uid}
          uid={uid}
          initialCity={
            resolveArea(selectionForProfile(user))?.city || "Ontario"
          }
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setReload((v) => v + 1);
            openGroup(id);
          }}
        />
      )}
    </View>
  );
}

function CreateGroup({
  uid,
  initialCity,
  onClose,
  onCreated,
}: {
  uid: string;
  initialCity: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { s, colors } = useGroupStyles();
  const [customName, setCustomName] = useState<string | null>(null);
  const [interest, setInterest] = useState("");
  const [category, setCategory] = useState("");
  const [choosing, setChoosing] = useState(true);
  const [number] = useState(() => Math.floor(100000 + Math.random() * 900000));
  const [similar, setSimilar] = useState<CommunityGroup[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const id = useRef(requestId()),
    lock = useRef(false),
    alive = useRef(true);
  const city = (initialCity.trim() || "Ontario").replace(/\s+/g, "");
  const ending = `-${interest.replace(/\s+/g, "")}-${number}`;
  const suggestion = interest
    ? `${city.slice(0, Math.max(1, 80 - ending.length))}${ending}`
    : "";
  const name = customName ?? suggestion;
  const canCreate =
    !busy && !!interest && name.trim().length >= 3 && name.trim().length <= 80;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!interest) {
      setSimilar([]);
      return;
    }
    setSimilar([]);
    const timer = setTimeout(() => {
      const query = `interests=${encodeURIComponent(interest)}`;
      void groupRequest<{ groups: CommunityGroup[] }>(
        uid,
        `/api/groups?${query}`,
      )
        .then((data) => {
          if (active) setSimilar(data.groups.slice(0, 3));
        })
        .catch(() => {
          if (active) setSimilar([]);
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [uid, interest]);
  async function create() {
    if (lock.current || !canCreate) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await groupRequest<{ group: CommunityGroup }>(
        uid,
        "/api/groups",
        "POST",
        { id: id.current, name: name.trim(), interests: [interest] },
      );
      if (alive.current) onCreated(data.group.id);
    } catch (e) {
      if (alive.current) setError(groupError(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <ModalSafeArea style={s.root} edges={["top", "bottom"]}>
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          <GroupButton
            label="Back to groups"
            secondary
            disabled={busy}
            onPress={onClose}
          />
          <Text accessibilityRole="header" style={s.title}>
            Create a community group
          </Text>
          <Text accessibilityRole="header" style={s.heading}>
            1. Choose one activity
          </Text>
          {!!interest && (
            <View style={s.notice} accessibilityLiveRegion="polite">
              <Text style={s.label}>Selected activity: {interest}</Text>
              {!choosing && (
                <GroupButton
                  label="Change activity"
                  secondary
                  disabled={busy}
                  onPress={() => setChoosing(true)}
                />
              )}
            </View>
          )}
          {choosing &&
            INTEREST_CATEGORIES.map((item) => (
              <View key={item.id} style={{ gap: 8 }}>
                <GroupButton
                  label={`${item.icon} ${item.title}`}
                  secondary
                  disabled={busy}
                  onPress={() =>
                    setCategory(category === item.id ? "" : item.id)
                  }
                />
                {category === item.id &&
                  item.activities.map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="radio"
                      disabled={busy}
                      accessibilityState={{
                        checked: interest === value,
                        disabled: busy,
                      }}
                      accessibilityLabel={value}
                      style={[s.check, interest === value && s.selected]}
                      onPress={() => {
                        setInterest(value);
                        setChoosing(false);
                        setCategory("");
                        setError("");
                      }}
                    >
                      <Text style={s.body}>
                        {interest === value ? "◉" : "○"} {value}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            ))}
          <Text style={s.label}>2. Group name</Text>
          <TextInput
            accessibilityLabel="Group name"
            style={s.input}
            value={name}
            onChangeText={(value) => {
              setCustomName(value);
              setError("");
            }}
            maxLength={80}
            editable={!busy}
            placeholder="Choose an activity for a suggested name"
            placeholderTextColor={colors.muted}
          />
          {!!suggestion && customName !== null && name !== suggestion && (
            <GroupButton
              label="Use suggested name"
              secondary
              disabled={busy}
              onPress={() => setCustomName(null)}
            />
          )}
          {!!similar.length && (
            <View style={s.card}>
              <Text style={s.heading}>Existing groups to consider</Text>
              <Text style={s.muted}>
                You may prefer joining one of these groups.
              </Text>
              {similar.map((g) => (
                <GroupButton
                  key={g.id}
                  secondary
                  disabled={busy}
                  label={`View ${g.name}`}
                  onPress={() => onCreated(g.id)}
                />
              ))}
            </View>
          )}
          <Text style={s.muted}>
            Groups and chat history are deleted after 45 days without activity,
            with a seven-day warning.
          </Text>
          {!!error && (
            <Text accessibilityRole="alert" style={s.body}>
              {error}
            </Text>
          )}
        </ScrollView>
        <View style={s.footer}>
          {!busy && !canCreate && (
            <Text style={s.muted} accessibilityLiveRegion="polite">
              {!interest
                ? "Choose one activity to continue."
                : "Enter a group name of 3–80 characters to continue."}
            </Text>
          )}
          <GroupButton
            label={busy ? "Creating…" : "Create group"}
            disabled={!canCreate}
            onPress={() => void create()}
          />
        </View>
      </ModalSafeArea>
    </Modal>
  );
}