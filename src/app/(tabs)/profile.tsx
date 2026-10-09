import { SymbolView } from "expo-symbols";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { AppColors } from "../../constants/app-colors";
import { useAppTheme } from "../../context/theme-context";

type AccountItem = {
  title: string;
  detail: string;
  icon: string;
  iosIcon: string;
  themeToggle?: boolean;
};

const accountItems: AccountItem[] = [
  {
    title: "My activities",
    detail: "2 upcoming",
    icon: "calendar_month",
    iosIcon: "calendar",
  },
  {
    title: "Saved for later",
    detail: "6 saved",
    icon: "favorite_border",
    iosIcon: "heart",
  },
  {
    title: "Notification settings",
    detail: "",
    icon: "notifications",
    iosIcon: "bell",
  },
  {
    title: "Dark mode",
    detail: "",
    icon: "dark_mode",
    iosIcon: "moon.fill",
    themeToggle: true,
  },
  {
    title: "Privacy and safety",
    detail: "",
    icon: "shield",
    iosIcon: "shield",
  },
  {
    title: "Help and support",
    detail: "",
    icon: "help_outline",
    iosIcon: "questionmark.circle",
  },
];

export default function ProfileScreen() {
  const { theme, colors, toggleTheme } = useAppTheme();

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>R</Text>
            </View>

            <Text style={styles.brandText}>ReIdentify</Text>
          </View>

          <View style={styles.notificationButton}>
            <SymbolView
              name={{
                ios: "bell",
                android: "notifications",
                web: "notifications",
              }}
              size={25}
              tintColor={colors.text}
            />

            <View style={styles.notificationBadge}>
              <Text style={styles.notificationBadgeText}>3</Text>
            </View>
          </View>
        </View>

        {/* PROFILE */}
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>MH</Text>
          </View>

          <View style={styles.profileInfo}>
            <Text style={styles.name}>Margaret Hughes</Text>

            <Text style={styles.memberText}>
              Oakfield · Member since June
            </Text>
          </View>

          <Pressable style={styles.settingsButton}>
            <SymbolView
              name={{
                ios: "gearshape",
                android: "settings",
                web: "settings",
              }}
              size={24}
              tintColor={colors.accent}
            />
          </Pressable>
        </View>

        {/* COMMUNITY STATS */}
        <View style={styles.communityCard}>
          <Text style={styles.communityLabel}>
            YOUR COMMUNITY
          </Text>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>4</Text>
              <Text style={styles.statLabel}>Groups joined</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.stat}>
              <Text style={styles.statNumber}>7</Text>
              <Text style={styles.statLabel}>Activities</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.stat}>
              <Text style={styles.statNumber}>3h</Text>
              <Text style={styles.statLabel}>Volunteered</Text>
            </View>
          </View>
        </View>

        {/* ACCOUNT */}
        <Text style={styles.sectionTitle}>Account</Text>

        <View style={styles.accountCard}>
          {accountItems.map((item, index) => (
            <View
              key={item.title}
              style={[
                styles.accountRow,
                index !== accountItems.length - 1 &&
                  styles.accountRowBorder,
              ]}
            >
              <View style={styles.accountIcon}>
                <SymbolView
                  name={{
                    ios: item.iosIcon,
                    android: item.icon,
                    web: item.icon,
                  }}
                  size={22}
                  tintColor={colors.accent}
                />
              </View>

              <Text style={styles.accountTitle}>
                {item.title}
              </Text>

              {item.themeToggle ? (
                <Switch
                  value={theme === "dark"}
                  onValueChange={toggleTheme}
                  trackColor={{
                    false: colors.border,
                    true: colors.accent,
                  }}
                  thumbColor={
                    theme === "dark"
                      ? colors.text
                      : "#FFFFFF"
                  }
                />
              ) : (
                <>
                  {item.detail !== "" && (
                    <Text style={styles.accountDetail}>
                      {item.detail}
                    </Text>
                  )}

                  <SymbolView
                    name={{
                      ios: "chevron.right",
                      android: "chevron_right",
                      web: "chevron_right",
                    }}
                    size={22}
                    tintColor={colors.muted}
                  />
                </>
              )}
            </View>
          ))}
        </View>

        {/* SIGN OUT */}
        <Pressable style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>
          ReIdentify · Version 1.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },

    container: {
      flex: 1,
      backgroundColor: colors.background,
    },

    content: {
      paddingHorizontal: 20,
      paddingBottom: 30,
    },

    header: {
      height: 72,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      marginBottom: 28,
    },

    brand: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    logo: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: "#1D7566",
      justifyContent: "center",
      alignItems: "center",
    },

    logoText: {
      color: "#FFFFFF",
      fontSize: 28,
      fontWeight: "700",
      fontFamily: "serif",
    },

    brandText: {
      color: colors.text,
      fontSize: 19,
      fontWeight: "700",
    },

    notificationButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },

    notificationBadge: {
      position: "absolute",
      top: 0,
      right: 0,
      width: 19,
      height: 19,
      borderRadius: 10,
      backgroundColor: "#E87561",
      alignItems: "center",
      justifyContent: "center",
    },

    notificationBadgeText: {
      color: "#FFFFFF",
      fontSize: 11,
      fontWeight: "800",
    },

    profileSection: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 25,
    },

    avatar: {
      width: 118,
      height: 72,
      borderRadius: 36,
      backgroundColor:
        colors.background === "#101214"
          ? "#37251F"
          : "#F7D8CB",
      alignItems: "center",
      justifyContent: "center",
    },

    avatarText: {
      color:
        colors.background === "#101214"
          ? "#F09A7B"
          : "#A3462D",
      fontSize: 20,
      fontWeight: "800",
    },

    profileInfo: {
      flex: 1,
      marginLeft: 16,
    },

    name: {
      color: colors.text,
      fontFamily: "serif",
      fontSize: 27,
      lineHeight: 31,
      fontWeight: "600",
    },

    memberText: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 6,
    },

    settingsButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },

    communityCard: {
      backgroundColor: "#16786A",
      borderRadius: 18,
      padding: 18,
      marginBottom: 28,
    },

    communityLabel: {
      color: "#FFE58F",
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 1,
      marginBottom: 18,
    },

    statsRow: {
      flexDirection: "row",
      alignItems: "center",
    },

    stat: {
      flex: 1,
      alignItems: "center",
    },

    statNumber: {
      color: "#FFFFFF",
      fontFamily: "serif",
      fontSize: 29,
      fontWeight: "700",
    },

    statLabel: {
      color: "#FFFFFF",
      fontSize: 10,
      marginTop: 4,
    },

    divider: {
      width: 1,
      height: 45,
      backgroundColor: "rgba(255,255,255,0.25)",
    },

    sectionTitle: {
      color: colors.text,
      fontFamily: "serif",
      fontSize: 27,
      fontWeight: "700",
      marginBottom: 14,
    },

    accountCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      overflow: "hidden",
      marginBottom: 22,
    },

    accountRow: {
      minHeight: 62,
      paddingHorizontal: 13,
      flexDirection: "row",
      alignItems: "center",
    },

    accountRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },

    accountIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor:
        colors.background === "#101214"
          ? "#173129"
          : "#E7F4F0",
      justifyContent: "center",
      alignItems: "center",
      marginRight: 12,
    },

    accountTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: "700",
    },

    accountDetail: {
      color: colors.muted,
      fontSize: 12,
      marginRight: 9,
    },

    signOutButton: {
      height: 50,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      marginTop: 2,
    },

    signOutText: {
      color: "#E87561",
      fontSize: 14,
      fontWeight: "700",
    },

    version: {
      color: colors.muted,
      fontSize: 11,
      textAlign: "center",
      marginTop: 9,
    },
  });
}