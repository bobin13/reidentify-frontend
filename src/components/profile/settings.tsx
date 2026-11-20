import { useMemo } from "react";

import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import { ChatFilterSetting } from "../chat-display";

import { useAppTheme } from "../../context/theme-context";
import { createStyles } from "./profile-styles";

export function Settings({
  onClose,
}: {
  onClose: () => void;
}) {
  const {
    colors,
    theme,
    toggleTheme,
  } = useAppTheme();

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  return (
    <SafeAreaView
      style={styles.container}
      edges={["top"]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
      >
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backButton}
        >
          <Text style={styles.accentText}>
            ← Back to profile
          </Text>
        </Pressable>

        <Text
          accessibilityRole="header"
          style={styles.pageTitle}
        >
          Settings
        </Text>

        <View style={styles.menu}>
          <ChatFilterSetting />

          <View style={styles.themeRow}>
            <View style={styles.menuCopy}>
              <Text style={styles.menuTitle}>
                Dark mode
              </Text>

              <Text style={styles.menuDetail}>
                {theme === "dark" ? "On" : "Off"}
              </Text>
            </View>

            <Switch
              accessibilityLabel="Dark mode"
              value={theme === "dark"}
              onValueChange={() => void toggleTheme()}
              trackColor={{
                false: colors.border,
                true: colors.accent,
              }}
              thumbColor={colors.surface}
              ios_backgroundColor={colors.border}
            />
          </View>

          <MenuRow
            title="Notification settings"
            detail="Not available yet"
            onPress={() =>
              Alert.alert(
                "Notifications",
                "Activity reminders and message notifications are not available yet.",
              )
            }
          />

          <MenuRow
            title="Privacy"
            onPress={() =>
              Alert.alert(
                "Privacy",
                "Your profile is saved in ReIdentify's database. Your area is a city and optional district in Ontario. We do not ask for a home address or postal code.",
              )
            }
          />

          <MenuRow
            title="Help & support"
            onPress={() =>
              Alert.alert(
                "Getting started",
                "Use Search to choose interests and find groups. Use Map to discover activities and Messages to chat. Edit profile changes your name and city or district.",
              )
            }
            last
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({
  title,
  detail,
  onPress,
  last = false,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useAppTheme();

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        !last && styles.menuBorder,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.menuCopy}>
        <Text style={styles.menuTitle}>
          {title}
        </Text>

        {detail && (
          <Text style={styles.menuDetail}>
            {detail}
          </Text>
        )}
      </View>

      <Text
        style={styles.chevron}
        accessibilityElementsHidden
      >
        ›
      </Text>
    </Pressable>
  );
}
