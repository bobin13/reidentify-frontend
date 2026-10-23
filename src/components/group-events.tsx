import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import VenueMap from "./venue-map";
type Coordinates = { latitude: number; longitude: number };
import { useAppTheme } from "../context/theme-context";
import {
  dateLabel,
  groupError,
  groupPath,
  groupRequest,
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
        Any member can organize an event at a public venue. Events are also
        visible on the public activity map.
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
            label="Open venue in Maps"
            secondary
            onPress={() => {
              void Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`,
              ).catch(() => setError("Could not open Maps."));
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
                    "It will be removed from upcoming group events and the public map.",
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
  const { s, colors } = useGroupStyles(),
    { theme } = useAppTheme();
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
    coordinate || { latitude: 43.6532, longitude: -79.3832 },
  );
  const moved = useRef(mapCenter);
  const [finding, setFinding] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [choice, setChoice] = useState<
    "year" | "month" | "day" | "start" | "end" | null
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
  const times = Array.from({ length: 48 }, (_, n) => ({
    value: n * 30,
    label: timeLabel(n * 30),
  }));
  const choices =
    choice === "year"
      ? years.map((n) => ({ value: n, label: String(n) }))
      : choice === "month"
        ? months
        : choice === "day"
          ? Array.from({ length: days }, (_, n) => ({
              value: n + 1,
              label: String(n + 1),
            }))
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
    if (choice === "day") setDay(value);
    if (choice === "start") {
      setStart(value);
      if (end <= value) setEnd(Math.min(1410, value + 60));
    }
    if (choice === "end") setEnd(value);
    setChoice(null);
  }
  async function findAddress() {
    if (finding || !location.trim()) return;
    setFinding(true);
    setError("");
    try {
      if (Platform.OS === "android") {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted)
          throw new Error(
            "Address search needs location permission on Android. You can also move the map to the public venue and use its centre.",
          );
      }
      const results = await Location.geocodeAsync(location.trim());
      if (!results.length)
        throw new Error(
          "Address not found. Include the town and province, or move the map to the venue.",
        );
      if (alive.current) {
        const point = {
          latitude: results[0].latitude,
          longitude: results[0].longitude,
        };
        setMapCenter(point);
        moved.current = point;
        setCoordinate(point);
        setConfirmed(false);
      }
    } catch (e) {
      if (alive.current) setError(groupError(e));
    } finally {
      if (alive.current) setFinding(false);
    }
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
      if (alive.current) onSaved();
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
                label="Back to event"
                secondary
                onPress={() => setChoice(null)}
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
              {choices.map((item) => (
                <GroupButton
                  key={item.value}
                  label={item.label}
                  secondary
                  onPress={() => select(item.value)}
                />
              ))}
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
                Choose a public meeting place. The event and its location will
                appear on the public map.
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
              <Text style={s.label}>Date</Text>
              <View style={s.row}>
                <GroupButton
                  label={months[month].label}
                  secondary
                  disabled={saving}
                  onPress={() => setChoice("month")}
                />
                <GroupButton
                  label={`Day ${day}`}
                  secondary
                  disabled={saving}
                  onPress={() => setChoice("day")}
                />
                <GroupButton
                  label={String(year)}
                  secondary
                  disabled={saving}
                  onPress={() => setChoice("year")}
                />
              </View>
              <GroupButton
                label={`Starts: ${timeLabel(start)}`}
                secondary
                disabled={saving}
                onPress={() => setChoice("start")}
              />
              <GroupButton
                label={`Ends: ${timeLabel(end)}`}
                secondary
                disabled={saving}
                onPress={() => setChoice("end")}
              />
              <Text style={s.muted}>
                Times use your device's local time. Choose a date within the
                next year. This form schedules an event within one day.
              </Text>
              <Text style={s.label}>Public venue and full address</Text>
              <TextInput
                accessibilityLabel="Event venue and address"
                style={s.input}
                value={location}
                onChangeText={changeLocation}
                maxLength={200}
                editable={!saving}
                placeholder="For example, a library or community centre"
                placeholderTextColor={colors.muted}
              />
              <GroupButton
                label={finding ? "Finding address…" : "Find address on map"}
                secondary
                disabled={finding || saving || !location.trim()}
                onPress={() => void findAddress()}
              />
              <View
                style={{ height: 260, borderRadius: 16, overflow: "hidden" }}
              >
                <VenueMap
                  center={mapCenter}
                  pin={coordinate}
                  theme={theme}
                  onPick={(point) => {
                    setCoordinate(point);
                    setConfirmed(false);
                  }}
                  onMove={(point) => {
                    moved.current = point;
                  }}
                />
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    marginLeft: -14,
                    marginTop: -20,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 32 }}>＋</Text>
                </View>
              </View>
              <Text style={s.muted}>
                Tap the public venue to place the meeting pin. You can also move
                the map and use its centre.
              </Text>
              <GroupButton
                label="Use map centre as meeting point"
                secondary
                disabled={saving}
                onPress={() => {
                  setCoordinate({ ...moved.current });
                  setConfirmed(false);
                }}
              />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: confirmed, disabled: saving }}
                disabled={saving}
                onPress={() => setConfirmed(!confirmed)}
                style={s.check}
              >
                <Text style={s.body}>
                  {confirmed ? "☑" : "☐"} I checked the meeting point. This is a
                  public venue, not a private home.
                </Text>
              </Pressable>
              <Text style={s.label}>Description (optional)</Text>
              <TextInput
                accessibilityLabel="Event description"
                style={s.input}
                multiline
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