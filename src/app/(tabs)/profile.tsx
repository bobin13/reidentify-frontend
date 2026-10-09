import { useCallback, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ActivityIndicator } from "react-native";
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthScreen, FormField } from "../../components/auth-screen";
import type { AppColors } from "../../constants/app-colors";
import {
  DEMO_USER_ID,
  INTEREST_OPTIONS,
  useAuth,
  type AppUser,
} from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";

type Page = "overview" | "login" | "register" | "edit";

export default function ProfileScreen() {
  const { colors, theme, toggleTheme } = useAppTheme();
const {
  user,
  signOut,
  loading,
  authError,
  refreshProfile,
} = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [page, setPage] = useState<Page>("overview");

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (page === "overview") return false;
          setPage("overview");
          return true;
        },
      );
      return () => subscription.remove();
    }, [page]),
  );
if (page === "overview" && loading) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        backgroundColor: colors.background,
      }}
    >
      <ActivityIndicator
        size="large"
        color={colors.accent}
      />
      <Text style={{ color: colors.text }}>
        Loading your profile…
      </Text>
    </View>
  );
}
  if (page === "login" || page === "register") {
    return (
      <AuthScreen
        mode={page}
        onModeChange={setPage}
        onBack={() => setPage("overview")}
        onSuccess={() => setPage("overview")}
      />
    );
  }

  if (page === "edit" && user) {
    return <EditProfile user={user} onClose={() => setPage("overview")} />;
  }

  const isDemoUser = user?.id === DEMO_USER_ID;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>R</Text>
          </View>
          <Text style={styles.brandText}>ReIdentify</Text>
        </View>

        {authError !== "" && (
          <View style={styles.section}>
            <Text
              accessibilityRole="alert"
              style={{ color: colors.text, fontSize: 16 }}
            >
              {authError}
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={() => void refreshProfile()}
              style={styles.outlineButton}
            >
              <Text style={styles.outlineButtonText}>
                Try again
              </Text>
            </Pressable>
          </View>
        )}

        {user ? (
          <>
            <View style={styles.profileCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {getInitials(user.fullName)}
                </Text>
              </View>
              <Text accessibilityRole="header" style={styles.name}>
                {user.fullName}
              </Text>
              <Text style={styles.subtitle}>
                {user.area || "Add your neighbourhood"}
              </Text>
              <Text style={styles.email}>{user.email}</Text>
              <Text style={styles.memberSince}>
                Member since{" "}
                {new Date(user.joinedAt).toLocaleDateString("en-CA", {
                  month: "long",
                  year: "numeric",
                })}
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={() => setPage("edit")}
                style={({ pressed }) => [
                  styles.outlineButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.outlineButtonText}>Edit profile</Text>
              </Pressable>
            </View>

            <View style={styles.statsRow}>
              {[
                { label: "Groups joined", value: isDemoUser ? 5 : 0 },
                { label: "Upcoming", value: isDemoUser ? 2 : 0 },
                { label: "Connections", value: isDemoUser ? 12 : 0 },
              ].map((stat) => (
                <View key={stat.label} style={styles.stat}>
                  <Text style={styles.statValue}>{stat.value}</Text>
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Your interests
              </Text>
              {user.interests.length > 0 ? (
                <View style={styles.interestWrap}>
                  {user.interests.map((interest) => (
                    <View key={interest} style={styles.interestPill}>
                      <Text style={styles.interestText}>{interest}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("edit")}
                  style={styles.addInterests}
                >
                  <Text style={styles.accentText}>Choose your interests →</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Your account
              </Text>
              <View style={styles.menu}>
                <MenuRow
                  title="My activities"
                  detail={
                    isDemoUser ? "2 upcoming · sample" : "Explore activities"
                  }
                  onPress={() => router.push("/home")}
                />
                <MenuRow
                  title="Saved for later"
                  detail="View saved activities"
                  onPress={() =>
                    Alert.alert(
                      "Saved for later",
                      "Saved activities will be connected in a later update.",
                    )
                  }
                />
                <MenuRow
                  title="Notification settings"
                  detail="Activity and message reminders"
                  onPress={() =>
                    Alert.alert(
                      "Notifications",
                      "Activity reminders and message notifications will be connected in a later update.",
                    )
                  }
                />
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={styles.welcomeCard}>
              <View
                style={styles.communityArt}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View style={[styles.artAvatar, styles.artLeft]}>
                  <Text style={styles.artAvatarText}>M</Text>
                </View>
                <View style={[styles.artAvatar, styles.artCenter]}>
                  <Text
                    style={[styles.artAvatarText, { color: colors.background }]}
                  >
                    R
                  </Text>
                </View>
                <View style={[styles.artAvatar, styles.artRight]}>
                  <Text style={styles.artAvatarText}>J</Text>
                </View>
              </View>
              <Text accessibilityRole="header" style={styles.welcomeTitle}>
                Good company starts here.
              </Text>
              <Text style={styles.welcomeSubtitle}>
                Meet people who share your interests. Find local activities and
                make new connections at your own pace.
              </Text>
              <View style={styles.welcomeActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("login")}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Sign in</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("register")}
                  style={({ pressed }) => [
                    styles.outlineButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.outlineButtonText}>Create account</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                A little more connection
              </Text>
              <View style={styles.benefits}>
                <Text style={styles.benefit}>
                  Find groups around your interests
                </Text>
                <Text style={styles.benefit}>
                  Discover activities close to home
                </Text>
                <Text style={styles.benefit}>
                  Keep in touch with your community
                </Text>
              </View>
            </View>
          </>
        )}

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            {user ? "Preferences & support" : "Preferences"}
          </Text>
          <View style={styles.menu}>
            <View style={styles.themeRow}>
              <View style={styles.menuCopy}>
                <Text style={styles.menuTitle}>Dark mode</Text>
                <Text style={styles.menuDetail}>
                  {theme === "dark" ? "On" : "Off"}
                </Text>
              </View>
              <Switch
                accessibilityLabel="Dark mode"
                value={theme === "dark"}
                onValueChange={() => void toggleTheme()}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.surface}
                ios_backgroundColor={colors.border}
              />
            </View>
            <MenuRow
              title="Privacy"
              onPress={() =>
                Alert.alert(
                  "Privacy",
                  "Your profile is saved in ReIdentify's database. You can use a general neighbourhood or city for your location."
                )
              }
            />
            <MenuRow
              title="Help & support"
              onPress={() =>
                Alert.alert(
                  "Getting started",
                  "Create an account or sign in. Use Edit profile to change your name, neighbourhood and interests."
                )
              }
              last
            />
          </View>
        </View>

        {user && (
          <Pressable
            accessibilityRole="button"
            onPress={async () => {
              const result = await signOut();

              if (result.ok) {
                setPage("overview");
              } else {
                Alert.alert("Sign out", result.message);
              }
            }}
            style={({ pressed }) => [
              styles.signOutButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        )}
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
  const styles = useMemo(() => createStyles(colors), [colors]);
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
        <Text style={styles.menuTitle}>{title}</Text>
        {detail && <Text style={styles.menuDetail}>{detail}</Text>}
      </View>
      <Text style={styles.chevron} accessibilityElementsHidden>
        ›
      </Text>
    </Pressable>
  );
}

function EditProfile({
  user,
  onClose,
}: {
  user: AppUser;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { updateProfile } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [fullName, setFullName] = useState(user.fullName);
  const [area, setArea] = useState(user.area);
  const [interests, setInterests] = useState([...user.interests]);
  const [error, setError] = useState("");

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest],
    );
  }

async function save() {
  setError("");

  const result = await updateProfile({
    fullName,
    area,
    interests,
  });

  if (result.ok) {
    onClose();
  } else {
    setError(result.message);
  }
}

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.backButton}
          >
            <Text style={styles.accentText}>← Back to profile</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.editTitle}>
            Make it yours
          </Text>
          <Text style={styles.editSubtitle}>
            Tell us a little about yourself and what you enjoy.
          </Text>

          <View style={styles.editFields}>
            <FormField
              label="Full name"
              value={fullName}
              onChangeText={(value) => {
                setFullName(value);
                setError("");
              }}
              error={error || undefined}
              inputProps={{ autoCapitalize: "words", autoComplete: "name" }}
            />
            <FormField
              label="Neighbourhood or city"
              placeholder="For example, Etobicoke"
              value={area}
              onChangeText={setArea}
              inputProps={{ autoCapitalize: "words" }}
            />
            <Text style={styles.locationHint}>
              A general area is enough. You do not need to enter your home
              address.
            </Text>
          </View>

          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Your interests
          </Text>
          <Text style={styles.editSubtitle}>Choose as many as you like.</Text>
          <View style={styles.interestChoices}>
            {INTEREST_OPTIONS.map((interest) => {
              const selected = interests.includes(interest);
              return (
                <Pressable
                  key={interest}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggleInterest(interest)}
                  style={({ pressed }) => [
                    styles.interestChoice,
                    selected && styles.interestChoiceSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.interestChoiceText}>{interest}</Text>
                  <Text
                    style={styles.selectionMark}
                    accessibilityElementsHidden
                  >
                    {selected ? "✓" : "+"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={save}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>Save profile</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.cancelButton}
          >
            <Text style={styles.outlineButtonText}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = Array.from(parts[0] || "")[0] || "";
  const last =
    parts.length > 1 ? Array.from(parts[parts.length - 1]!)[0] || "" : "";
  return `${first}${last}`.toUpperCase();
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      width: "100%",
      maxWidth: 640,
      alignSelf: "center",
      padding: 20,
      paddingBottom: 36,
      gap: 24,
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 4,
    },
    logo: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    logoText: { color: colors.background, fontSize: 24, fontWeight: "800" },
    brandText: { color: colors.text, fontSize: 23, fontWeight: "700" },
    welcomeCard: {
      padding: 22,
      backgroundColor: colors.surface,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 18,
    },
    communityArt: {
      height: 96,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    artAvatar: {
      width: 64,
      height: 64,
      borderRadius: 24,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: 3,
      borderColor: colors.surface,
    },
    artLeft: {
      backgroundColor: colors.border,
      transform: [{ rotate: "-12deg" }],
      marginRight: -8,
    },
    artCenter: {
      backgroundColor: colors.accent,
      width: 78,
      height: 78,
      zIndex: 1,
    },
    artRight: {
      backgroundColor: colors.border,
      transform: [{ rotate: "12deg" }],
      marginLeft: -8,
    },
    artAvatarText: { color: colors.text, fontSize: 27, fontWeight: "700" },
    welcomeTitle: {
      color: colors.text,
      fontSize: 29,
      fontWeight: "700",
      textAlign: "center",
    },
    welcomeSubtitle: {
      color: colors.muted,
      fontSize: 17,
      lineHeight: 25,
      textAlign: "center",
    },
    welcomeActions: { gap: 12, marginTop: 8 },
    primaryButton: {
      minHeight: 58,
      borderRadius: 14,
      backgroundColor: colors.accent,
      justifyContent: "center",
      alignItems: "center",
      padding: 16,
    },
    primaryButtonText: {
      color: colors.background,
      fontSize: 18,
      fontWeight: "700",
      textAlign: "center",
    },
    outlineButton: {
      minHeight: 54,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
      alignItems: "center",
      padding: 14,
    },
    outlineButtonText: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "600",
      textAlign: "center",
    },
    section: { gap: 12 },
    sectionTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
    benefits: { gap: 14, paddingHorizontal: 2 },
    benefit: { color: colors.muted, fontSize: 16, lineHeight: 24 },
    profileCard: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      gap: 8,
    },
    avatar: {
      width: 90,
      height: 90,
      borderRadius: 45,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8,
    },
    avatarText: { color: colors.background, fontSize: 31, fontWeight: "700" },
    name: {
      color: colors.text,
      fontSize: 26,
      fontWeight: "700",
      textAlign: "center",
    },
    subtitle: { color: colors.muted, fontSize: 17, textAlign: "center" },
    email: { color: colors.muted, fontSize: 15, textAlign: "center" },
    memberSince: {
      color: colors.muted,
      fontSize: 14,
      textAlign: "center",
      marginBottom: 10,
    },
    statsRow: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 18,
    },
    stat: { flex: 1, alignItems: "center", gap: 6, paddingHorizontal: 4 },
    statValue: { color: colors.accent, fontSize: 24, fontWeight: "700" },
    statLabel: { color: colors.muted, fontSize: 13, textAlign: "center" },
    interestWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    interestPill: {
      borderRadius: 12,
      padding: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    interestText: { color: colors.text, fontSize: 15 },
    addInterests: { minHeight: 48, justifyContent: "center" },
    accentText: { color: colors.accent, fontSize: 17, fontWeight: "600" },
    menu: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    menuRow: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 16,
    },
    menuBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
    menuCopy: { flex: 1, gap: 4 },
    menuTitle: { color: colors.text, fontSize: 17, fontWeight: "600" },
    menuDetail: { color: colors.muted, fontSize: 14, lineHeight: 20 },
    chevron: { color: colors.muted, fontSize: 26 },
    themeRow: {
      minHeight: 76,
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    signOutButton: {
      minHeight: 56,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
      alignItems: "center",
      padding: 14,
    },
    signOutText: { color: colors.accent, fontSize: 17, fontWeight: "700" },
    previewNote: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
    },
    pressed: { opacity: 0.75 },
    backButton: {
      minHeight: 48,
      justifyContent: "center",
      alignSelf: "flex-start",
    },
    editTitle: { color: colors.text, fontSize: 30, fontWeight: "700" },
    editSubtitle: { color: colors.muted, fontSize: 17, lineHeight: 25 },
    editFields: { gap: 20 },
    locationHint: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: -10,
    },
    interestChoices: { gap: 10 },
    interestChoice: {
      minHeight: 58,
      padding: 16,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    interestChoiceSelected: { borderColor: colors.accent, borderWidth: 2 },
    interestChoiceText: { color: colors.text, fontSize: 17, flex: 1 },
    selectionMark: { color: colors.accent, fontSize: 22, fontWeight: "700" },
    cancelButton: {
      minHeight: 48,
      justifyContent: "center",
      alignItems: "center",
    },
  });
}
