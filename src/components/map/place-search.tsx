import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";

import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import { apiRequest } from "../../lib/api";

import { ONTARIO_CITIES, matchesArea, searchText } from "../../lib/locations";
import { type Coordinates } from "../../lib/map-events";

import { useLatest } from "../../lib/use-latest";
import { createStyles } from "./map-styles";

type SearchPlace = {
  id: string;
  name: string;
  address: string;
  coordinate: Coordinates;
  radiusKm?: number;
};
// Reuse the same offline Ontario catalogue as registration. City searches do
// not need GPS, a geocoding request, or a Firestore read.
const SEARCH_AREAS: SearchPlace[] = ONTARIO_CITIES.flatMap((city) => [
  {
    id: `city:${city.id}`,
    name: city.name,
    address: city.region || "Ontario",
    coordinate: city.coordinate,
    radiusKm: 10,
  },
  ...city.districts.map((district) => ({
    id: `district:${city.id}:${district.id}`,
    name: district.name,
    address: `${city.name}, Ontario`,
    coordinate: district.coordinate,
    radiusKm: 2,
  })),
]);

export function MapPlaceSearch({
  uid,
  center,
  onChoose,
}: {
  uid: string;
  center: Coordinates;
  onChoose: (coordinate: Coordinates, radiusKm?: number) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { height } = useWindowDimensions();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<{
    query: string;
    places: SearchPlace[];
    attribution: string;
  }>({ query: "", places: [], attribution: "" });
  const [retry, setRetry] = useState(0);
  const bias = useLatest(center);
  const query = text.trim().replace(/\s+/g, " ");
  const local = useMemo(
    () =>
      query.length < 2
        ? []
        : SEARCH_AREAS.filter((place) =>
            matchesArea(query, `${place.name} ${place.address}`),
          )
            .sort(
              (a, b) =>
                Number(searchText(b.name).startsWith(searchText(query))) -
                Number(searchText(a.name).startsWith(searchText(query))),
            )
            .slice(0, 5),
    [query],
  );
  const remote = results.query === query ? results.places : [];
  const choices = local.length ? local : remote;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError("");
      setBusy(false);
      if (!open || query.length < 3 || local.length || !uid) return;
      setBusy(true);
      const timer = setTimeout(() => {
        const account = auth.currentUser;
        if (!account || account.uid !== uid) {
          setBusy(false);
          setError("Sign in to search venues and addresses.");
          return;
        }
        const parameters = new URLSearchParams({
          q: query,
          latitude: String(bias.current.latitude),
          longitude: String(bias.current.longitude),
        });
        void apiRequest<{ suggestions: SearchPlace[]; attribution: string }>(
          account,
          "GET",
          undefined,
          "/api/places/suggestions?" + parameters.toString(),
        )
          .then((response) => {
            if (!active || auth.currentUser?.uid !== uid) return;
            if (!Array.isArray(response.suggestions))
              throw new Error("Could not load places. Try again.");
            const places = response.suggestions.filter(
              (place) =>
                place &&
                typeof place.name === "string" &&
                Number.isFinite(place.coordinate?.latitude) &&
                Number.isFinite(place.coordinate?.longitude),
            );
            setResults({
              query,
              places: places.slice(0, 5),
              attribution:
                response.attribution ||
                "© OpenStreetMap contributors · Photon",
            });
          })
          .catch((issue) => {
            if (active)
              setError(
                issue instanceof Error
                  ? issue.message
                  : "Could not load places. Try again.",
              );
          })
          .finally(() => {
            if (active) setBusy(false);
          });
      }, 650);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [uid, query, open, local, retry]),
  );

  function choose(place: SearchPlace) {
    setOpen(false);
    setText(place.name);
    Keyboard.dismiss();
    onChoose(place.coordinate, place.radiusKm ?? 0.5);
  }
  return (
    <View style={styles.searchBox}>
      <View style={styles.searchInputRow}>
        <SymbolView
          name={{ ios: "magnifyingglass", android: "search", web: "search" }}
          size={21}
          tintColor={colors.muted}
        />
        <TextInput
          accessibilityLabel="Search a city, venue or address"
          placeholder="City, venue or address"
          placeholderTextColor={colors.muted}
          value={text}
          onChangeText={(value) => {
            setText(value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          style={styles.searchInput}
          maxLength={120}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
          selectionColor={colors.accent}
        />
        {!!text && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear place search"
            style={styles.clearSearch}
            onPress={() => {
              setText("");
              setOpen(false);
            }}
          >
            <Text style={styles.link}>×</Text>
          </Pressable>
        )}
      </View>
      {open && (
        <View
          style={[
            styles.suggestions,
            { maxHeight: Math.max(160, Math.min(320, height * 0.45)) },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            {query.length < 2 && (
              <View style={styles.suggestionFooter}>
                <Text style={styles.body}>
                  Enter a city, district, venue or address.
                </Text>
              </View>
            )}
            {choices.map((place) => (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                accessibilityLabel={`Go to ${place.name}, ${place.address}`}
                style={styles.suggestion}
                onPress={() => choose(place)}
              >
                <Text style={styles.eventTitle}>{place.name}</Text>
                <Text style={styles.help}>{place.address}</Text>
              </Pressable>
            ))}
            {busy && (
              <View style={styles.suggestionFooter}>
                <ActivityIndicator
                  accessibilityLabel="Searching places"
                  color={colors.accent}
                />
              </View>
            )}
            {!!error && (
              <View style={styles.suggestionFooter}>
                <Text accessibilityRole="alert" style={styles.body}>
                  {error}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.textButton}
                  onPress={() => setRetry((n) => n + 1)}
                >
                  <Text style={styles.link}>Try again</Text>
                </Pressable>
              </View>
            )}
            {!busy && !error && query.length >= 2 && !choices.length && (
              <View style={styles.suggestionFooter}>
                <Text style={styles.body}>
                  {!uid
                    ? "Sign in to search venues and addresses. City search is available here."
                    : query.length < 3
                      ? "Enter at least three letters for venue or address search."
                      : "No matching places. Try adding the city name."}
                </Text>
              </View>
            )}
            {!!remote.length && !local.length && (
              <View style={styles.suggestionFooter}>
                <Text style={styles.help}>
                  Search data: {results.attribution}
                </Text>
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              style={styles.suggestion}
              onPress={() => {
                setOpen(false);
                Keyboard.dismiss();
              }}
            >
              <Text style={styles.link}>Close search</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}
    </View>
  );
}
