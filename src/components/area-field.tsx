import { useMemo, useState } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { AppColors } from "../constants/app-colors";
import { gutter, radius, type } from "../constants/theme";
import { useAppTheme } from "../context/theme-context";
import {
  ONTARIO_CITIES,
  areaLabel,
  cityFor,
  matchesArea,
  resolveArea,
  type AreaSelection,
} from "../lib/locations";
import { ModalSafeArea } from "./modal-safe-area";

type Props = {
  value: AreaSelection | null;
  onChange: (value: AreaSelection) => void;
  disabled?: boolean;
  error?: string;
};
type Option = { id: string; name: string; detail?: string };

export function AreaField({ value, onChange, disabled = false, error }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"city" | "district">("city");
  const [draft, setDraft] = useState<AreaSelection | null>(null);
  const [query, setQuery] = useState("");
  const city = cityFor(draft?.cityId);
  const location = resolveArea(value);
  const draftLocation = resolveArea(draft);
  const hasDistricts = !!city?.districts.length;
  const options: Option[] = useMemo(() => {
    if (step === "city")
      return ONTARIO_CITIES.filter((item) =>
        matchesArea(
          query,
          [
            item.name,
            item.kind,
            item.region,
            ...item.districts.map((district) => district.name),
          ].join(" "),
        ),
      ).map((item) => ({
        id: item.id,
        name: item.name,
        detail: [item.kind, item.region || "Ontario"].join(" · "),
      }));
    return (city?.districts ?? []).filter((item) =>
      matchesArea(query, item.name),
    );
  }, [step, query, city]);

  function showPicker() {
    Keyboard.dismiss();
    setDraft(
      location
        ? { cityId: location.cityId, districtId: location.districtId }
        : null,
    );
    setQuery("");
    setStep(location ? "district" : "city");
    setOpen(true);
  }
  function close() {
    Keyboard.dismiss();
    setOpen(false);
  }
  function changeCity() {
    Keyboard.dismiss();
    setQuery("");
    setStep("city");
  }
  function choose(option: Option) {
    Keyboard.dismiss();
    if (step === "city") {
      // Always clear the previous district when choosing a city.
      setDraft({ cityId: option.id, districtId: null });
      setStep("district");
      setQuery("");
    } else if (city) setDraft({ cityId: city.id, districtId: option.id });
  }
  function confirm() {
    if (!draft || !draftLocation || disabled) return;
    onChange({ cityId: draft.cityId, districtId: draft.districtId });
    close();
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Your area</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Your area. ${areaLabel(location) || "Choose your city or town"}. ${location ? "Change" : "Choose"}`}
        accessibilityHint="Opens the Ontario city and optional district picker."
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={showPicker}
        style={({ pressed }) => [
          styles.trigger,
          !!error && styles.errorBorder,
          (pressed || disabled) && styles.dim,
        ]}
      >
        <View style={styles.copy}>
          <Text style={[styles.value, !location && styles.muted]}>
            {areaLabel(location) || "Choose your city or town"}
          </Text>
          <Text style={styles.hint}>Ontario</Text>
        </View>
        <Text style={styles.action}>{location ? "Change" : "Choose"}</Text>
      </Pressable>
      <Text style={styles.hint}>
        City required. District optional. No home address needed.
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => (step === "district" ? changeCity() : close())}
      >
        <ModalSafeArea edges={["top", "bottom"]} style={styles.screen}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={styles.panel} accessibilityViewIsModal>
              <View style={styles.topRow}>
                <Text accessibilityRole="header" style={styles.title}>
                  Your area
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel area selection"
                  onPress={close}
                  style={styles.textButton}
                >
                  <Text style={styles.action}>Cancel</Text>
                </Pressable>
              </View>
              <View style={styles.intro}>
                <Text style={styles.eyebrow}>
                  {step === "city" ? "ONTARIO" : city?.name}
                </Text>
                <Text accessibilityRole="header" style={styles.heading}>
                  {step === "city"
                    ? "Choose your city or town"
                    : hasDistricts
                      ? "Choose a district"
                      : "Confirm your area"}
                </Text>
                <Text style={styles.body}>
                  {step === "city"
                    ? "Search for your municipality."
                    : hasDistricts
                      ? "Choose an area, or use the city only."
                      : "Your city or town is enough for your profile."}
                </Text>
                {step === "district" && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={changeCity}
                    style={styles.changeCity}
                  >
                    <Text style={styles.action}>← Change city or town</Text>
                  </Pressable>
                )}
              </View>

              {(step === "city" || hasDistricts) && (
                <View style={styles.searchRow}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    accessibilityLabel={
                      step === "city"
                        ? "Search Ontario cities and towns"
                        : `Search districts in ${city?.name}`
                    }
                    placeholder={
                      step === "city"
                        ? "Search cities and towns"
                        : "Search districts"
                    }
                    placeholderTextColor={colors.muted}
                    selectionColor={colors.accent}
                    autoCorrect={false}
                    autoCapitalize="words"
                    returnKeyType="search"
                    onSubmitEditing={Keyboard.dismiss}
                    style={styles.search}
                  />
                  {!!query && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear area search"
                      onPress={() => setQuery("")}
                      style={styles.textButton}
                    >
                      <Text style={styles.action}>Clear</Text>
                    </Pressable>
                  )}
                </View>
              )}

              <FlatList
                key={step}
                style={styles.flex}
                data={options}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={styles.list}
                ListHeaderComponent={
                  step === "district" && city ? (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityLabel={`Use ${city.name} only`}
                      accessibilityState={{
                        checked: draft?.districtId === null,
                      }}
                      onPress={() =>
                        setDraft({ cityId: city.id, districtId: null })
                      }
                      style={[
                        styles.option,
                        draft?.districtId === null && styles.selected,
                      ]}
                    >
                      <View style={styles.copy}>
                        <Text style={styles.value}>{city.name} only</Text>
                        <Text style={styles.hint}>No district selected</Text>
                      </View>
                      {draft?.districtId === null && (
                        <Text style={styles.check} accessibilityElementsHidden>
                          ✓
                        </Text>
                      )}
                    </Pressable>
                  ) : null
                }
                ListEmptyComponent={
                  step === "city" || hasDistricts ? (
                    <Text accessibilityLiveRegion="polite" style={styles.empty}>
                      {step === "city"
                        ? "No matching municipality. Try a shorter name or the municipality your community belongs to."
                        : "No matching district. Try a shorter name, or use the city only."}
                    </Text>
                  ) : null
                }
                renderItem={({ item }) => {
                  const selected =
                    step === "city"
                      ? draft?.cityId === item.id
                      : draft?.districtId === item.id;
                  return (
                    <Pressable
                      accessibilityRole={step === "city" ? "button" : "radio"}
                      accessibilityLabel={`Select ${step === "city" ? "city" : "district"} ${item.name}${item.detail ? `, ${item.detail}` : ""}`}
                      accessibilityState={
                        step === "city" ? { selected } : { checked: selected }
                      }
                      onPress={() => choose(item)}
                      style={({ pressed }) => [
                        styles.option,
                        selected && styles.selected,
                        pressed && styles.dim,
                      ]}
                    >
                      <View style={styles.copy}>
                        <Text style={styles.value}>{item.name}</Text>
                        {!!item.detail && (
                          <Text style={styles.hint}>{item.detail}</Text>
                        )}
                      </View>
                      <Text style={styles.check} accessibilityElementsHidden>
                        {selected ? "✓" : step === "city" ? "›" : "○"}
                      </Text>
                    </Pressable>
                  );
                }}
              />
              {step === "district" && (
                <View style={styles.footer}>
                  <Text accessibilityLiveRegion="polite" style={styles.body}>
                    {areaLabel(draftLocation)}, Ontario
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: !draftLocation || disabled,
                    }}
                    disabled={!draftLocation || disabled}
                    onPress={confirm}
                    style={({ pressed }) => [
                      styles.primary,
                      (pressed || !draftLocation || disabled) && styles.dim,
                    ]}
                  >
                    <Text style={styles.primaryText}>Use this area</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </ModalSafeArea>
      </Modal>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    field: { gap: 8 },
    label: { ...type.label, color: colors.text },
    trigger: {
      minHeight: 68,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 16,
    },
    copy: { flex: 1, minWidth: 0, gap: 3 },
    value: { ...type.heading, color: colors.text },
    muted: { color: colors.muted },
    hint: { ...type.caption, fontSize: 14, lineHeight: 20, color: colors.muted },
    action: { ...type.label, color: colors.accent, fontWeight: "700" },
    dim: { opacity: 0.55 },
    errorBorder: { borderColor: colors.danger },
    error: { ...type.body, fontSize: 15, lineHeight: 22, color: colors.danger },
    screen: { flex: 1, backgroundColor: colors.background },
    panel: { flex: 1, width: "100%", maxWidth: 640, alignSelf: "center" },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: gutter,
      paddingTop: 8,
      gap: 12,
    },
    title: { ...type.heading, fontSize: 18, color: colors.text, fontWeight: "700" },
    textButton: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 8,
    },
    intro: {
      paddingHorizontal: gutter,
      paddingTop: 20,
      paddingBottom: 12,
      gap: 6,
    },
    eyebrow: { ...type.eyebrow, color: colors.accent },
    heading: { ...type.display, fontSize: 26, lineHeight: 32, color: colors.text },
    body: { ...type.body, color: colors.muted },
    changeCity: {
      minHeight: 44,
      justifyContent: "center",
      alignSelf: "flex-start",
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: gutter,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingRight: 8,
    },
    search: {
      flex: 1,
      minWidth: 0,
      minHeight: 52,
      color: colors.text,
      fontSize: 16,
      paddingHorizontal: 16,
      paddingVertical: 13,
    },
    list: { paddingHorizontal: gutter, paddingBottom: 20 },
    option: {
      minHeight: 60,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      marginBottom: 8,
    },
    selected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    check: { color: colors.accent, fontSize: 20, fontWeight: "700" },
    empty: { ...type.body, color: colors.muted, paddingVertical: 24 },
    footer: {
      padding: gutter,
      paddingTop: 14,
      gap: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    primary: {
      minHeight: 54,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: radius.pill,
      paddingHorizontal: 20,
      paddingVertical: 14,
      backgroundColor: colors.accent,
    },
    primaryText: {
      ...type.label,
      fontSize: 16,
      color: colors.background,
      fontWeight: "700",
      textAlign: "center",
    },
  });
}
