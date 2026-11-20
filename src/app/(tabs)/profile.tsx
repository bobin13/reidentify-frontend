import { useCallback, useMemo, useState } from "react";

import { useFocusEffect } from "expo-router";

import { SymbolView } from "expo-symbols";

import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import { AuthScreen } from "../../components/auth-screen";

import { areaLabel, resolveArea } from "../../lib/locations";

import { useAuth } from "../../context/auth-context";

import { useAppTheme } from "../../context/theme-context";

import { createStyles } from "../../components/profile/profile-styles";
import { ProfileAvatar } from "../../components/profile/profile-avatar";
import { Settings } from "../../components/profile/settings";
import { EditProfile } from "../../components/profile/edit-profile";
type Page =
  | "overview"
  | "login"
  | "register"
  | "edit"
  | "settings";

export default function ProfileScreen() {
  const { colors } = useAppTheme();

  const {
    user,
    signOut,
    deleteAccount,
    loading,
    authError,
    refreshProfile,
  } = useAuth();

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

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
    return (
      <EditProfile
        key={user.id}
        user={user}
        onClose={() => setPage("overview")}
      />
    );
  }

  if (page === "settings") {
    return (
      <Settings
        onClose={() => setPage("overview")}
      />
    );
  }

  return (
    <SafeAreaView
      style={styles.container}
      edges={["top"]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          user && styles.signedInContent,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={user ? styles.overviewHeader : styles.brandRow}
        >
          {user ? (
            <>
              <View
                style={styles.overviewBrandSlot}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View style={styles.overviewBrandMark}>
                  <Text style={styles.overviewBrandText}>R</Text>
                </View>
              </View>
              <Text
                accessibilityRole="header"
                style={styles.overviewTitle}
              >
                Profile
              </Text>
            </>
          ) : (
            <View style={styles.brandIdentity}>
              <View style={styles.logo}>
                <Text style={styles.logoText}>R</Text>
              </View>
              <Text style={styles.brandText}>ReIdentify</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={() => setPage("settings")}
            style={({ pressed }) => [
              user ? styles.overviewSettingsButton : styles.settingsButton,
              pressed && styles.pressed,
            ]}
          >
            <SymbolView
              name={{
                ios: "gearshape",
                android: "settings",
                web: "settings",
              }}
              size={20}
              tintColor={user ? colors.text : colors.accent}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            {!user && <Text style={styles.settingsText}>Settings</Text>}
          </Pressable>
        </View>

        {authError !== "" && (
          <View style={styles.section}>
            <Text
              accessibilityRole="alert"
              style={{
                color: colors.text,
                fontSize: 16,
              }}
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
            <View style={styles.overviewHero}>
              <View style={styles.overviewPortrait}>
                <ProfileAvatar profile={user} large />
                <View style={styles.overviewBadge}>
                  <Text style={styles.overviewVisibility}>
                    {user.profileVisibility === "public"
                      ? "Public profile"
                      : "Private profile"}
                  </Text>
                </View>
              </View>

              <View style={styles.overviewIdentity}>
                <Text style={styles.overviewName}>{user.fullName}</Text>
                <Text selectable style={styles.overviewEmail}>
                  {user.email}
                </Text>
                <Text style={styles.overviewMeta}>
                  {areaLabel(resolveArea(user.location)) ||
                    user.area ||
                    "Choose your area"}
                </Text>
                {(user.age != null || !!user.gender) && (
                  <Text style={styles.overviewMeta}>
                    {[
                      user.age != null ? `Age ${user.age}` : "",
                      user.gender,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                )}
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => setPage("edit")}
                style={({ pressed }) => [
                  styles.editProfileButton,
                  pressed && styles.pressed,
                ]}
              >
                <SymbolView
                  name={{
                    ios: "pencil",
                    android: "edit",
                    web: "edit",
                  }}
                  size={17}
                  tintColor={colors.text}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
                <Text style={styles.editProfileButtonText}>Edit profile</Text>
              </Pressable>
            </View>

            <View style={styles.overviewSection}>
              <Text
                accessibilityRole="header"
                style={styles.overviewSectionTitle}
              >
                About
              </Text>
              <View style={styles.overviewDetail}>
                <Text style={styles.overviewDescription}>
                  {user.aboutMe?.trim() ||
                    "Add a little about yourself in Edit profile."}
                </Text>
              </View>
            </View>

            <View style={styles.overviewSection}>
              <Text
                accessibilityRole="header"
                style={styles.overviewSectionTitle}
              >
                Interests
              </Text>
              <View style={styles.overviewDetail}>
                {user.interests.length > 0 ? (
                  <View style={styles.interestWrap}>
                    {user.interests.map((interest) => (
                      <View
                        key={interest}
                        style={[styles.interestChip, styles.overviewChip]}
                      >
                        <Text style={styles.interestText}>{interest}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.overviewDescription}>
                    Choose your interests in Search.
                  </Text>
                )}
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
                <View
                  style={[
                    styles.artAvatar,
                    styles.artLeft,
                  ]}
                >
                  <Text
                    style={styles.artAvatarText}
                  >
                    M
                  </Text>
                </View>

                <View
                  style={[
                    styles.artAvatar,
                    styles.artCenter,
                  ]}
                >
                  <Text
                    style={[
                      styles.artAvatarText,
                      {
                        color: colors.background,
                      },
                    ]}
                  >
                    R
                  </Text>
                </View>

                <View
                  style={[
                    styles.artAvatar,
                    styles.artRight,
                  ]}
                >
                  <Text
                    style={styles.artAvatarText}
                  >
                    J
                  </Text>
                </View>
              </View>

              <Text
                accessibilityRole="header"
                style={styles.welcomeTitle}
              >
                Good company starts here.
              </Text>

              <Text style={styles.welcomeSubtitle}>
                Meet people who share your interests.
                Find local activities and make new
                connections at your own pace.
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
                  <Text
                    style={styles.primaryButtonText}
                  >
                    Sign in
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("register")}
                  style={({ pressed }) => [
                    styles.outlineButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={styles.outlineButtonText}
                  >
                    Create account
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text
                accessibilityRole="header"
                style={styles.sectionTitle}
              >
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

        {user && (
          <View style={styles.accountFooter}>
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                const result = await signOut();

                if (result.ok) {
                  setPage("overview");
                } else {
                  Alert.alert(
                    "Sign out",
                    result.message,
                  );
                }
              }}
              style={({ pressed }) => [
                styles.signOutButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.signOutText}>
                Sign out
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityHint="Permanently deletes your account after you confirm"
              onPress={() =>
                Alert.alert(
                  "Delete your account?",
                  "This permanently deletes your profile, photo, interests, chats and group memberships. Groups you were the last member of will close. This cannot be undone.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete account",
                      style: "destructive",
                      onPress: async () => {
                        const result = await deleteAccount();
                        if (result.ok) {
                          setPage("overview");
                        } else {
                          Alert.alert("Delete account", result.message);
                        }
                      },
                    },
                  ],
                )
              }
              style={({ pressed }) => [
                styles.deleteAccountButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.deleteAccountText}>
                Delete account
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

