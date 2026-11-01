import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  DeviceEventEmitter,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
type Coordinates = { latitude: number; longitude: number };
type VenueSuggestion = {
  id: string;
  name: string;
  address: string;
  location: string;
  coordinate: Coordinates;
};
import { useAuth } from "../context/auth-context";
import {
  dateLabel,
  groupError,
  groupPath,
  groupRequest,
  groupMapState,
  requestId,
  type GroupEvent,
} from "../lib/groups";
import { GroupButton, useGroupStyles } from "./group-ui";

export function GroupEvents({
  uid,
  groupId,
  onActivity,
}: {
  uid: string;
  groupId: string;
  onActivity: () => void;
}) {
  const { s, colors } = useGroupStyles();
  const [events, setEvents] = useState<GroupEvent[]>([]),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<GroupEvent | "new" | null>(null);
  const [reload, setReload] = useState(0);
  const lock = useRef(false),
    owner = useRef(`${uid}:${groupId}`);
  owner.current = `${uid}:${groupId}`;
  const key = `${uid}:${groupId}`;
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setBusy(true);
      void groupRequest<{ events: GroupEvent[] }>(
        uid,
        `${groupPath(groupId)}/events`,
      )
        .then((data) => {
          if (active) {
            setEvents(data.events);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(groupError(e));
        })
        .finally(() => {
          if (active) setBusy(false);
        });
      return () => {
        active = false;
      };
    }, [uid, groupId, reload]),
  );
  async function cancel(event: GroupEvent) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await groupRequest(
        uid,
        `${groupPath(groupId)}/events/${event.id}/cancel`,
        "POST",
      );
      if (owner.current === key) {
        setReload((v) => v + 1);
        onActivity();
      }
    } catch (e) {
      if (owner.current === key) setError(groupError(e));
    } finally {
      lock.current = false;
      if (owner.current === key) setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text accessibilityRole="header" style={s.heading}>
        Meet in person
      </Text>
      <Text style={s.body}>
        Any member can organize an event at a public venue. Only group members
        can see these events on the map.
      </Text>
      <GroupButton
        label="Organize an event"
        disabled={busy}
        onPress={() => setEditing("new")}
      />
      {busy && <ActivityIndicator color={colors.accent} />}
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
      {events.map((event) => (
        <View key={event.id} style={s.card}>
          <Text style={s.heading}>{event.title}</Text>
          <Text style={s.body}>
            {dateLabel(event.startsAt)} – {dateLabel(event.endsAt)}
          </Text>
          <Text style={s.body}>{event.location}</Text>
          {!!event.description && (
            <Text style={s.muted}>{event.description}</Text>
          )}
          <GroupButton
            label="Show on map"
            secondary
            onPress={() => {
              if (
                !Number.isFinite(event.latitude) ||
                !Number.isFinite(event.longitude)
              ) {
                setError("This event does not have a valid meeting location.");
                return;
              }
              groupMapState.pendingFocus = {
                uid,
                coordinate: {
                  latitude: event.latitude,
                  longitude: event.longitude,
                },
              };
              router.navigate("/(tabs)/map");
            }}
          />
          {event.creatorId === uid && (
            <>
              <GroupButton
                label="Edit my event"
                secondary
                disabled={busy}
                onPress={() => setEditing(event)}
              />
              <GroupButton
                label="Cancel my event"
                secondary
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    "Cancel this event?",
                    "It will no longer appear in group events or on members' maps.",
                    [
                      { text: "Keep event", style: "cancel" },
                      {
                        text: "Cancel event",
                        style: "destructive",
                        onPress: () => void cancel(event),
                      },
                    ],
                  )
                }
              />
            </>
          )}
        </View>
      ))}
      {!busy && !error && !events.length && (
        <Text style={s.muted}>No upcoming group events yet.</Text>
      )}
      {editing && (
        <EventForm
          uid={uid}
          groupId={groupId}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReload((v) => v + 1);
            onActivity();
          }}
        />
      )}
    </ScrollView>
  );
}

function EventForm({
  uid,
  groupId,
  initial,
  onClose,
  onSaved,
}: {
  uid: string;
  groupId: string;
  initial: GroupEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { s, colors } = useGroupStyles();
  const { user } = useAuth();
  const savedCenter = user?.location?.coordinate;
  const tomorrow = new Date(Date.now() + 86400000);
  const originalDate = initial ? new Date(initial.startsAt) : tomorrow;
  const [year, setYear] = useState(originalDate.getFullYear()),
    [month, setMonth] = useState(originalDate.getMonth()),
    [day, setDay] = useState(originalDate.getDate());
  const [start, setStart] = useState(
    initial
      ? new Date(initial.startsAt).getHours() * 60 +
          new Date(initial.startsAt).getMinutes()
      : 600,
  );
  const [end, setEnd] = useState(
    initial
      ? new Date(initial.endsAt).getHours() * 60 +
          new Date(initial.endsAt).getMinutes()
      : 720,
  );
  const [title, setTitle] = useState(initial?.title || ""),
    [location, setLocation] = useState(initial?.location || "");
  const [description, setDescription] = useState(initial?.description || ""),
    [confirmed, setConfirmed] = useState(false);
  const [coordinate, setCoordinate] = useState<Coordinates | null>(
    initial
      ? { latitude: initial.latitude, longitude: initial.longitude }
      : null,
  );
  const [mapCenter, setMapCenter] = useState<Coordinates>(
    coordinate || savedCenter || { latitude: 43.6532, longitude: -79.3832 },
  );
  const [finding, setFinding] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [choice, setChoice] = useState<
    "date" | "year" | "month" | "start" | "end" | null
  >(null);
  const id = useRef(initial?.requestId || requestId()),
    lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const changeLocation = (text: string) => {
    setLocation(text);
    setCoordinate(null);
    setConfirmed(false);
  };
  const timeLabel = (minutes: number) =>
    new Date(2000, 0, 1, 0, minutes).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  const days = new Date(year, month + 1, 0).getDate();
  const months = Array.from({ length: 12 }, (_, n) => ({
    value: n,
    label: new Date(2000, n, 1).toLocaleDateString(undefined, {
      month: "long",
    }),
  }));
  const years = [new Date().getFullYear(), new Date().getFullYear() + 1];
  const selectedDate = new Date(year, month, day).toLocaleDateString(
    undefined,
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  );
  const firstWeekday = new Date(year, month, 1).getDay();
  const weekdays = Array.from({ length: 7 }, (_, n) =>
    new Date(2026, 0, 4 + n).toLocaleDateString(undefined, {
      weekday: "short",
    }),
  );
  const times = Array.from({ length: 48 }, (_, n) => ({
    value: n * 30,
    label: timeLabel(n * 30),
  }));
  const choices =
    choice === "year"
      ? years.map((n) => ({ value: n, label: String(n) }))
      : choice === "month"
        ? months
        : times.filter((t) =>
            choice === "end" ? t.value > start : t.value < 1410,
          );
  function select(value: number) {
    if (choice === "year") {
      setYear(value);
      setDay(Math.min(day, new Date(value, month + 1, 0).getDate()));
    }
    if (choice === "month") {
      setMonth(value);
      setDay(Math.min(day, new Date(year, value + 1, 0).getDate()));
    }
    if (choice === "date") setDay(value);
    if (choice === "start") {
      setStart(value);
      if (end <= value) setEnd(Math.min(1410, value + 60));
    }
    if (choice === "end") setEnd(value);
    setChoice(choice === "year" || choice === "month" ? "date" : null);
  }
  async function save() {
    if (lock.current) return;
    const startDate = new Date(year, month, day, 0, start),
      endDate = new Date(year, month, day, 0, end);
    if (
      title.trim().length < 3 ||
      location.trim().length < 3 ||
      !coordinate ||
      !confirmed ||
      (startDate.getTime() <= Date.now() &&
        (!initial || startDate.getTime() !== Date.parse(initial.startsAt))) ||
      endDate.getTime() <= Date.now() ||
      startDate.getTime() > Date.now() + 366 * 86400000 ||
      endDate <= startDate ||
      startDate.getHours() * 60 + startDate.getMinutes() !== start ||
      endDate.getHours() * 60 + endDate.getMinutes() !== end
    ) {
      setError(
        "Enter the title and venue, choose a date within the next year, check the times, and confirm the public meeting point.",
      );
      return;
    }
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await groupRequest(uid, `${groupPath(groupId)}/events`, "POST", {
        id: id.current,
        title,
        location,
        description,
        startsAt: startDate.toISOString(),
        endsAt: endDate.toISOString(),
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        publicVenueConfirmed: confirmed,
      });
      if (alive.current) {
        groupMapState.pendingFocus = { uid, coordinate: { ...coordinate } };
        DeviceEventEmitter.emit("reidentify:group-event-published", {
          uid,
          coordinate: { ...coordinate },
        });
        onSaved();
      }
    } catch (e) {
      if (alive.current) setError(groupError(e));
    } finally {
      lock.current = false;
      if (alive.current) setSaving(false);
    }
  }
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!saving) onClose();
      }}
    >
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        {choice ? (
          <>
            <View style={s.content}>
              <GroupButton
                label={
                  choice === "month" || choice === "year"
                    ? "Back to calendar"
                    : "Back to event"
                }
                secondary
                onPress={() =>
                  setChoice(
                    choice === "month" || choice === "year" ? "date" : null,
                  )
                }
              />
              <Text style={s.heading}>
                Choose{" "}
                {choice === "start"
                  ? "start time"
                  : choice === "end"
                    ? "end time"
                    : choice}
              </Text>
            </View>
            <ScrollView contentContainerStyle={s.content}>
              {choice === "date" ? (
                <>
                  <View style={formStyles.row}>
                    <View style={formStyles.column}>
                      <GroupButton
                        label={months[month].label}
                        secondary
                        onPress={() => setChoice("month")}
                      />
                    </View>
                    <View style={formStyles.column}>
                      <GroupButton
                        label={String(year)}
                        secondary
                        onPress={() => setChoice("year")}
                      />
                    </View>
                  </View>
                  <View style={formStyles.calendar}>
                    {weekdays.map((label, n) => (
                      <View key={`weekday-${n}`} style={formStyles.weekday}>
                        <Text style={[s.muted, formStyles.centered]}>
                          {label}
                        </Text>
                      </View>
                    ))}
                    {Array.from({ length: firstWeekday }, (_, n) => (
                      <View key={`empty-${n}`} style={formStyles.dayCell} />
                    ))}
                    {Array.from({ length: days }, (_, n) => n + 1).map(
                      (value) => (
                        <Pressable
                          key={value}
                          accessibilityRole="radio"
                          accessibilityLabel={new Date(
                            year,
                            month,
                            value,
                          ).toLocaleDateString(undefined, {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                          accessibilityState={{ checked: day === value }}
                          onPress={() => select(value)}
                          style={({ pressed }) => [
                            formStyles.dayCell,
                            {
                              backgroundColor:
                                day === value ? colors.accent : colors.surface,
                            },
                            pressed && formStyles.pressed,
                          ]}
                        >
                          <Text
                            style={[
                              s.label,
                              {
                                color:
                                  day === value
                                    ? colors.background
                                    : colors.text,
                              },
                            ]}
                          >
                            {value}
                          </Text>
                        </Pressable>
                      ),
                    )}
                  </View>
                </>
              ) : (
                choices.map((item) => (
                  <GroupButton
                    key={item.value}
                    label={item.label}
                    secondary
                    onPress={() => select(item.value)}
                  />
                ))
              )}
            </ScrollView>
          </>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={s.content}
              keyboardShouldPersistTaps="handled"
            >
              <GroupButton
                label="Back to group events"
                secondary
                disabled={saving}
                onPress={onClose}
              />
              <Text accessibilityRole="header" style={s.title}>
                {initial ? "Edit your event" : "Organize an event"}
              </Text>
              <Text style={s.body}>
                Choose a public meeting place. Only group members can see this
                event.
              </Text>
              <Text style={s.label}>Event title</Text>
              <TextInput
                style={s.input}
                accessibilityLabel="Event title"
                maxLength={120}
                value={title}
                onChangeText={setTitle}
                editable={!saving}
              />
              <View style={formStyles.schedule}>
                <Text style={s.label}>Date and time</Text>
                <GroupButton
                  label={selectedDate}
                  secondary
                  disabled={saving}
                  onPress={() => setChoice("date")}
                />
                <View style={formStyles.row}>
                  {(["start", "end"] as const).map((kind) => (
                    <Pressable
                      key={kind}
                      accessibilityRole="button"
                      accessibilityLabel={`${kind === "start" ? "Starts" : "Ends"}: ${timeLabel(kind === "start" ? start : end)}. Change time.`}
                      accessibilityState={{ disabled: saving }}
                      disabled={saving}
                      onPress={() => setChoice(kind)}
                      style={({ pressed }) => [
                        formStyles.timeControl,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                        pressed && formStyles.pressed,
                      ]}
                    >
                      <Text style={s.muted}>
                        {kind === "start" ? "Starts" : "Ends"}
                      </Text>
                      <Text style={s.label}>
                        {timeLabel(kind === "start" ? start : end)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Text style={s.label}>Public meeting place</Text>
              <VenueSearch
                uid={uid}
                value={location}
                onChangeText={changeLocation}
                center={savedCenter || mapCenter}
                hasPoint={!!coordinate}
                disabled={saving}
                onBusyChange={setFinding}
                onSelect={(place) => {
                  setLocation(place.location);
                  setCoordinate(place.coordinate);
                  setMapCenter(place.coordinate);
                  setConfirmed(false);
                  setError("");
                }}
              />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: confirmed,
                  disabled: saving || finding || !coordinate,
                }}
                disabled={saving || finding || !coordinate}
                onPress={() => setConfirmed(!confirmed)}
                style={formStyles.publicCheck}
              >
                <Text style={[s.body, formStyles.publicCheckText]}>
                  {confirmed ? "☑" : "☐"} This is a public meeting place.
                </Text>
              </Pressable>
              <Text style={s.label}>Description (optional)</Text>
              <TextInput
                accessibilityLabel="Event description"
                style={[s.input, formStyles.descriptionInput]}
                multiline
                textAlignVertical="top"
                maxLength={2000}
                value={description}
                onChangeText={setDescription}
                editable={!saving}
              />
              {!!error && (
                <Text accessibilityRole="alert" style={s.body}>
                  {error}
                </Text>
              )}
            </ScrollView>
            <View style={s.footer}>
              <GroupButton
                label={saving ? "Saving…" : "Publish event"}
                disabled={saving || finding}
                onPress={() => void save()}
              />
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function VenueSearch({
  uid,
  value,
  center,
  hasPoint,
  disabled,
  onChangeText,
  onSelect,
  onBusyChange,
}: {
  uid: string;
  value: string;
  center: Coordinates;
  hasPoint: boolean;
  disabled: boolean;
  onChangeText: (value: string) => void;
  onSelect: (place: VenueSuggestion) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { s, colors } = useGroupStyles();
  const [result, setResult] = useState<{
    key: string;
    suggestions: VenueSuggestion[];
    message: string;
  }>({ key: "", suggestions: [], message: "" });
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const query = value.trim();
  const key = `${uid}|${query}|${center.latitude}|${center.longitude}`;
  const resultMatches = result.key === key;

  useEffect(() => {
    let active = true;
    setResult({ key: "", suggestions: [], message: "" });
    setLoading(false);
    onBusyChange(false);
    if (disabled || hasPoint || query.length < 3) return;
    setLoading(true);
    const timer = setTimeout(() => {
      onBusyChange(true);
      const params = new URLSearchParams({
        q: query,
        latitude: String(center.latitude),
        longitude: String(center.longitude),
      });
      void groupRequest<{ suggestions: VenueSuggestion[] }>(
        uid,
        `/api/places/suggestions?${params.toString()}`,
      )
        .then((data) => {
          if (!active) return;
          if (!Array.isArray(data.suggestions))
            throw new Error("Venue suggestions are temporarily unavailable.");
          setResult({
            key,
            suggestions: data.suggestions.slice(0, 5),
            message: data.suggestions.length
              ? ""
              : "No matching places. Add the city or full street address.",
          });
        })
        .catch((error) => {
          if (active)
            setResult({ key, suggestions: [], message: groupError(error) });
        })
        .finally(() => {
          if (active) {
            setLoading(false);
            onBusyChange(false);
          }
        });
    }, 650);
    return () => {
      active = false;
      clearTimeout(timer);
      onBusyChange(false);
    };
  }, [
    uid,
    query,
    center.latitude,
    center.longitude,
    disabled,
    hasPoint,
    retry,
    key,
    onBusyChange,
  ]);

  return (
    <View style={formStyles.venueSearch}>
      <View
        style={[
          formStyles.searchField,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <TextInput
          accessibilityLabel="Event venue and address"
          accessibilityHint="Type at least three characters, then choose an address or venue from the suggestions."
          style={[s.body, formStyles.searchInput]}
          value={value}
          onChangeText={onChangeText}
          maxLength={200}
          editable={!disabled}
          placeholder="Search a venue or street address"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => setRetry((number) => number + 1)}
        />
        {!!value && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear venue search"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onChangeText("")}
            style={formStyles.clearSearch}
          >
            <Text style={[s.label, { color: colors.muted }]}>×</Text>
          </Pressable>
        )}
      </View>
      {!hasPoint && query.length >= 3 && (
        <View
          style={[
            formStyles.suggestions,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {loading && (
            <View
              style={formStyles.searchStatus}
              accessibilityLiveRegion="polite"
            >
              <ActivityIndicator color={colors.accent} />
              <Text style={s.muted}>Searching places…</Text>
            </View>
          )}
          {resultMatches &&
            result.suggestions.map((place) => (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${place.name}. ${place.address}`}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => {
                  onBusyChange(false);
                  Keyboard.dismiss();
                  onSelect(place);
                }}
                style={({ pressed }) => [
                  formStyles.suggestion,
                  { borderBottomColor: colors.border },
                  pressed && formStyles.pressed,
                ]}
              >
                <Text style={s.label}>{place.name}</Text>
                <Text style={s.muted}>{place.address}</Text>
              </Pressable>
            ))}
          {resultMatches && !!result.message && (
            <View style={formStyles.venueSearch}>
              <Text
                style={[s.muted, formStyles.searchMessage]}
                accessibilityLiveRegion="polite"
              >
                {result.message}
              </Text>
              <GroupButton
                label="Search again"
                secondary
                disabled={disabled}
                onPress={() => setRetry((number) => number + 1)}
              />
            </View>
          )}
        </View>
      )}
      <Text style={[s.muted, formStyles.attribution]}>
        Search data:{" "}
        <Text
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(
              "https://www.openstreetmap.org/copyright",
            ).catch(() => {});
          }}
        >
          © OpenStreetMap contributors
        </Text>
        {" · "}
        <Text
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL("https://photon.komoot.io/").catch(() => {});
          }}
        >
          Photon
        </Text>
      </Text>
    </View>
  );
}

const formStyles = StyleSheet.create({
  venueSearch: { gap: 8 },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  clearSearch: {
    minWidth: 48,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestions: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  suggestion: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
    borderBottomWidth: 1,
  },
  searchStatus: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 10,
  },
  searchMessage: { padding: 14 },
  attribution: { fontSize: 13, lineHeight: 19 },
  schedule: { gap: 8 },
  row: { flexDirection: "row", gap: 10 },
  column: { flex: 1, minWidth: 0 },
  timeControl: {
    flex: 1,
    minWidth: 0,
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
    borderWidth: 1,
    borderRadius: 14,
    justifyContent: "center",
  },
  calendar: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.285714%", minHeight: 36, justifyContent: "center" },
  dayCell: {
    width: "14.285714%",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
  },
  centered: { textAlign: "center" },
  publicCheck: { minHeight: 44, paddingVertical: 4, justifyContent: "center" },
  publicCheckText: { fontSize: 14, lineHeight: 20 },
  descriptionInput: { minHeight: 160, paddingTop: 12 },
  pressed: { opacity: 0.72 },
});