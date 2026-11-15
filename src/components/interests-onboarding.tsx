import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { SafeAreaView } from "react-native-safe-area-context";

import type { AppColors } from "../constants/app-colors";
import { card, gutter, radius, type } from "../constants/theme";
import {
  INTEREST_CATEGORIES,
  MIN_INTERESTS,
  recognizedInterests,
} from "../constants/interests";
import { useAuth, type AppUser } from "../context/auth-context";
import { useAppTheme } from "../context/theme-context";
import {
  getGuestInterestDraft,
  setGuestInterestDraft,
} from "../lib/guest-interests";

export { MIN_INTERESTS };

// Shown once: a signed-in account with fewer than three catalogue interests
// cannot use the tabs until it has chosen them. Saved interests end the gate.
export function needsInterestOnboarding(user: AppUser | null): user is AppUser {
  return (
    !!user && recognizedInterests(user.interests).length < MIN_INTERESTS
  );
}

export function InterestsOnboarding({ user }: { user: AppUser }) {
  const { colors } = useAppTheme();
  const { updateProfile, loading } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Start from saved interests plus anything ticked as a guest before sign-in.
  const [selected, setSelected] = useState<string[]>(() =>
    recognizedInterests([...user.interests, ...getGuestInterestDraft()]),
  );
  const [open, setOpen] = useState<string | null>(
    INTEREST_CATEGORIES[0].id,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  const remaining = Math.max(0, MIN_INTERESTS - selected.length);
  const ready = remaining === 0;
  const busy = saving || loading;
  const firstName = user.fullName.trim().split(/\s+/)[0] || "there";

  function toggle(interest: string) {
    if (busy) return;
    setError("");
    setSelected((current) =>
      current.includes(interest)
        ? current.filter((value) => value !== interest)
        : recognizedInterests([...current, interest]),
    );
  }

  async function finish() {
    if (!ready || busy || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await updateProfile({
        fullName: user.fullName,
        area: user.area,
        interests: selected,
      });
      // On success the refreshed profile closes this screen from the layout.
      if (!result.ok) setError(result.message);
      else setGuestInterestDraft([]);
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "Could not save your interests. Please try again.",
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  const progress = ready
    ? `${selected.length} selected. You can add more or continue.`
    : `${selected.length} of ${MIN_INTERESTS} selected. Choose ${remaining} more.`;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={styles.title}>
          Welcome, {firstName}
        </Text>
        <Text style={styles.subtitle}>
          Pick at least {MIN_INTERESTS} interests to get started.
        </Text>
        <Text style={styles.body}>
          We use these to suggest groups, events and news near you. You can
          change them any time from the Search tab.
        </Text>

        {selected.length > 0 && (
          <View style={styles.selectedWrap} accessibilityRole="list">
            {selected.map((interest) => (
              <Pressable
                key={interest}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${interest}`}
                disabled={busy}
                onPress={() => toggle(interest)}
                style={({ pressed }) => [
                  styles.selectedChip,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.selectedChipText}>{interest} ✕</Text>
              </Pressable>
            ))}
          </View>
        )}

        {INTEREST_CATEGORIES.map((category) => {
          const count = category.activities.filter((value) =>
            selected.includes(value),
          ).length;
          const expanded = open === category.id;
          return (
            <View key={category.id} style={styles.category}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${category.title}, ${count} selected`}
                onPress={() => setOpen(expanded ? null : category.id)}
                style={({ pressed }) => [
                  styles.categoryHeader,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.categoryIcon}>
                  <SymbolView
                    name={category.symbol}
                    size={22}
                    tintColor={colors.accent}
                  />
                </View>
                <View style={styles.categoryCopy}>
                  <Text style={styles.categoryTitle}>{category.title}</Text>
                  <Text style={styles.categoryMeta}>
                    {count > 0
                      ? `${count} selected`
                      : category.description}
                  </Text>
                </View>
                <Text style={styles.chevron} accessible={false}>
                  {expanded ? "▴" : "▾"}
                </Text>
              </Pressable>

              {expanded && (
                <View style={styles.chipWrap}>
                  {category.activities.map((interest) => {
                    const checked = selected.includes(interest);
                    return (
                      <Pressable
                        key={interest}
                        accessibilityRole="checkbox"
                        accessibilityLabel={interest}
                        accessibilityState={{ checked, disabled: busy }}
                        disabled={busy}
                        onPress={() => toggle(interest)}
                        style={({ pressed }) => [
                          styles.chip,
                          checked && styles.chipChecked,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            checked && styles.chipTextChecked,
                          ]}
                        >
                          {checked ? "✓ " : ""}
                          {interest}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        {!!error && (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={styles.error}
          >
            {error}
          </Text>
        )}
        <Text style={styles.progress} accessibilityLiveRegion="polite">
          {progress}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || busy, busy: saving }}
          disabled={!ready || busy}
          onPress={() => void finish()}
          style={({ pressed }) => [
            styles.button,
            (!ready || busy) && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
        >
          {saving && <ActivityIndicator color={colors.background} />}
          <Text style={styles.buttonText}>
            {saving ? "Saving…" : "Continue"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    content: { padding: gutter, paddingBottom: 24, gap: 12 },
    title: { ...type.display, color: colors.text },
    subtitle: { ...type.heading, fontSize: 18, color: colors.text },
    body: { ...type.body, fontSize: 15, lineHeight: 22, color: colors.muted },
    selectedWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4,
    },
    selectedChip: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    selectedChipText: {
      ...type.label,
      fontSize: 14,
      color: colors.background,
    },
    category: { ...card(colors), overflow: "hidden" },
    categoryHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 68,
      padding: 14,
    },
    categoryIcon: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    categoryCopy: { flex: 1, gap: 2 },
    categoryTitle: { ...type.heading, color: colors.text },
    categoryMeta: { ...type.caption, color: colors.muted },
    chevron: { color: colors.muted, fontSize: 18 },
    chipWrap: {
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      padding: 14,
    },
    chip: {
      borderColor: colors.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      backgroundColor: colors.surfaceAlt,
      minHeight: 40,
      justifyContent: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    chipChecked: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    chipText: { ...type.label, fontWeight: "500", color: colors.text },
    chipTextChecked: { color: colors.background, fontWeight: "700" },
    footer: {
      backgroundColor: colors.surface,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 8,
      padding: 16,
    },
    error: { ...type.caption, fontSize: 14, color: colors.danger },
    progress: { ...type.caption, fontSize: 14, color: colors.muted },
    button: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
      minHeight: 52,
      paddingHorizontal: 20,
    },
    buttonDisabled: { opacity: 0.45 },
    buttonText: {
      ...type.label,
      fontSize: 16,
      color: colors.background,
      fontWeight: "700",
    },
    pressed: { opacity: 0.8 },
  });
}
