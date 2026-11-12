import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useFocusEffect } from "expo-router";
import { Image as ExpoImage } from "expo-image";
import { SymbolView } from "expo-symbols";

import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import {
  ImageManipulator,
  SaveFormat,
} from "expo-image-manipulator";

import { ChatFilterSetting } from "../../components/chat-display";
import { AuthScreen, FormField } from "../../components/auth-screen";
import { AreaField } from "../../components/area-field";

import {
  areaLabel,
  resolveArea,
  selectionForProfile,
} from "../../lib/locations";

import type { AppColors } from "../../constants/app-colors";

import {
  useAuth,
  type AppUser,
  type ProfilePhotoChange,
} from "../../context/auth-context";

import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import { apiRequest } from "../../lib/api";

type Page =
  | "overview"
  | "login"
  | "register"
  | "edit"
  | "settings";

const AGE_OPTIONS = Array.from(
  { length: 120 },
  (_, index) => String(index + 1),
);

const GENDER_OPTIONS = [
  "Woman",
  "Man",
  "Non-binary",
] as const;

type AvatarAsset = number | { uri: string };
type AvatarPreview = AvatarAsset | string;

const PROFILE_AVATARS: ReadonlyArray<{
  id: string;
  label: string;
  source: AvatarAsset;
}> = [
  {
    id: "mint",
    label: "Silver hair on a mint background",
    source: require("../../../assets/images/profile-avatars/mint.jpg"),
  },
  {
    id: "amber",
    label: "Glasses and gray beard on an amber background",
    source: require("../../../assets/images/profile-avatars/amber.jpg"),
  },
  {
    id: "periwinkle",
    label: "Dark hair with a silver streak on a periwinkle background",
    source: require("../../../assets/images/profile-avatars/periwinkle.jpg"),
  },
  {
    id: "rose",
    label: "Curly gray hair and glasses on a rose background",
    source: require("../../../assets/images/profile-avatars/rose.jpg"),
  },
];

type PhotoSelection =
  | { kind: "upload"; jpeg: string }
  | { kind: "preset"; source: AvatarAsset };

type PhotoDraft = (PhotoSelection & { requestId: string }) | { kind: "remove" };

export default function ProfileScreen() {
  const { colors } = useAppTheme();

  const {
    user,
    signOut,
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
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileAvatar({
  profile,
  preview,
  large = false,
}: {
  profile: Pick<
    AppUser,
    "id" | "fullName" | "photoVersion"
  >;
  preview?: AvatarPreview;
  large?: boolean;
}) {
  const { colors } = useAppTheme();
  const { user } = useAuth();

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  const viewer = user?.id || "";
  const key =
    `${viewer}:${profile.id}:${profile.photoVersion || ""}`;

  const [image, setImage] = useState({
    key: "",
    uri: "",
  });

  const [failedSource, setFailedSource] = useState<AvatarPreview>("");

  useEffect(() => {
    let active = true;
    const account = auth.currentUser;

    if (
      preview !== undefined ||
      !profile.photoVersion ||
      !account ||
      account.uid !== viewer
    ) {
      return;
    }

    void apiRequest<{ jpeg: string }>(
      account,
      "GET",
      undefined,
      `/api/profiles/${encodeURIComponent(profile.id)}/photo?version=${encodeURIComponent(profile.photoVersion)}`,
      { timeoutMs: 25000 },
    )
      .then((data) => {
        if (
          active &&
          auth.currentUser?.uid === viewer
        ) {
          setImage({
            key,
            uri: `data:image/jpeg;base64,${data.jpeg}`,
          });
        }
      })
      .catch(() => {
        if (active) {
          setImage({ key, uri: "" });
        }
      });

    return () => {
      active = false;
    };
  }, [
    key,
    viewer,
    profile.id,
    profile.photoVersion,
    preview,
  ]);

  const candidate =
    preview !== undefined
      ? preview
      : image.key === key
        ? image.uri
        : "";

  const source =
    candidate === failedSource ? "" : candidate;

  return (
    <View style={[styles.avatar, large && styles.overviewAvatar]}>
      {source ? (
        <Image
          source={typeof source === "string" ? { uri: source } : source}
          style={[
            styles.avatarImage,
            large && styles.overviewAvatarImage,
          ]}
          accessibilityLabel={`${profile.fullName}'s profile photo`}
          onError={() => setFailedSource(candidate)}
        />
      ) : (
        <Text
          style={[styles.avatarText, large && styles.overviewAvatarText]}
        >
          {getInitials(profile.fullName)}
        </Text>
      )}
    </View>
  );
}

function ProfilePreview({
  user,
  onClose,
  backLabel = "← Back to profile",
}: {
  user: AppUser;
  onClose: () => void;
  backLabel?: string;
}) {
  const { colors } = useAppTheme();

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
            {backLabel}
          </Text>
        </Pressable>

        <Text
          accessibilityRole="header"
          style={styles.pageTitle}
        >
          Shared profile preview
        </Text>

        <Text style={styles.description}>
          {user.profileVisibility === "public"
            ? "This is what other signed-in members can see."
            : "Your profile is private. This preview is visible only to you."}
        </Text>

        <View style={styles.detailCard}>
          <View style={styles.profileIdentity}>
            <ProfileAvatar profile={user} />

            <View style={styles.profileCopy}>
              <Text style={styles.name}>
                {user.fullName}
              </Text>

              <Text style={styles.subtitle}>
                {areaLabel(
                  resolveArea(user.location),
                ) || user.area}
              </Text>

              {user.age != null && (
                <Text style={styles.subtitle}>
                  Age {user.age}
                </Text>
              )}

              {!!user.gender && (
                <Text style={styles.subtitle}>
                  {user.gender}
                </Text>
              )}
            </View>
          </View>

          {!!user.aboutMe && (
            <>
              <Text style={styles.sectionTitle}>
                About
              </Text>

              <Text style={styles.description}>
                {user.aboutMe}
              </Text>
            </>
          )}

          {user.interests.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>
                Interests
              </Text>

              <View style={styles.interestWrap}>
                {user.interests.map((interest) => (
                  <View
                    key={interest}
                    style={styles.interestChip}
                  >
                    <Text
                      style={styles.interestText}
                    >
                      {interest}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Settings({
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

function AgeDropdown({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { colors } = useAppTheme();
  const { fontScale } = useWindowDimensions();

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  const [open, setOpen] = useState(false);
  const list = useRef<ScrollView>(null);

  const rowHeight = Math.max(
    56,
    Math.ceil(24 * fontScale + 24),
  );

  const close = () => setOpen(false);

  function option(age: string) {
    const selected = value === age;

    return (
      <Pressable
        key={age || "not-set"}
        accessibilityRole="radio"
        accessibilityLabel={
          age ? `Age ${age}` : "Age not set"
        }
        accessibilityState={{
          checked: selected,
        }}
        onPress={() => {
          onChange(age);
          close();
        }}
        style={({ pressed }) => [
          styles.ageOption,
          { minHeight: rowHeight },
          selected && styles.ageOptionSelected,
          pressed && styles.pressed,
        ]}
      >
        <Text
          style={[
            styles.ageOptionText,
            selected && styles.ageSelectedText,
          ]}
        >
          {age || "Not set"}
        </Text>

        {selected && (
          <Text
            style={styles.ageSelectedText}
            importantForAccessibility="no"
          >
            ✓
          </Text>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.menuTitle}>
        Age (optional)
      </Text>

      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel="Age (optional)"
        accessibilityValue={{
          text: value || "Not set",
        }}
        accessibilityHint="Opens a list of ages. Choose Not set to leave your age blank."
        accessibilityState={{
          expanded: open,
          disabled,
        }}
        disabled={disabled}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.ageDropdown,
          (pressed || disabled) && styles.pressed,
        ]}
      >
        <Text
          style={[
            value
              ? styles.ageOptionText
              : styles.agePlaceholder,
            { flex: 1, flexShrink: 1 },
          ]}
        >
          {value || "Not set"}
        </Text>

        <SymbolView
          name={{
            ios: "chevron.down",
            android: "expand_more",
            web: "expand_more",
          }}
          size={22}
          tintColor={colors.muted}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </Pressable>

      {open && (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={close}
          onShow={() =>
            list.current?.scrollTo({
              y: Math.max(
                0,
                (Number(value || 1) - 3) *
                  rowHeight,
              ),
              animated: false,
            })
          }
        >
          <View style={styles.ageOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              accessible={false}
              importantForAccessibility="no"
              onPress={close}
            />

            <View
              style={styles.ageMenu}
              accessibilityViewIsModal
              onAccessibilityEscape={close}
            >
              <View style={styles.ageMenuHeader}>
                <Text
                  accessibilityRole="header"
                  style={styles.ageMenuTitle}
                >
                  Choose age
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close age list"
                  onPress={close}
                  style={styles.ageCloseButton}
                >
                  <Text style={styles.accentText}>
                    Close
                  </Text>
                </Pressable>
              </View>

              {option("")}

              <ScrollView
                ref={list}
                style={styles.ageList}
                keyboardShouldPersistTaps="handled"
              >
                {AGE_OPTIONS.map(option)}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function GenderDropdown({
  value,
  onChange,
  disabled,
}: {
  value: AppUser["gender"];
  onChange: (
    value: AppUser["gender"],
  ) => void;
  disabled: boolean;
}) {
  const { colors } = useAppTheme();

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <View style={styles.section}>
      <Text style={styles.menuTitle}>
        Gender (optional)
      </Text>

      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel="Gender (optional)"
        accessibilityValue={{
          text: value || "Not set",
        }}
        accessibilityState={{
          expanded: open,
          disabled,
        }}
        disabled={disabled}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.ageDropdown,
          (pressed || disabled) && styles.pressed,
        ]}
      >
        <Text
          style={[
            value
              ? styles.ageOptionText
              : styles.agePlaceholder,
            { flex: 1, flexShrink: 1 },
          ]}
        >
          {value || "Not set"}
        </Text>

        <SymbolView
          name={{
            ios: "chevron.down",
            android: "expand_more",
            web: "expand_more",
          }}
          size={22}
          tintColor={colors.muted}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </Pressable>

      {open && (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={close}
        >
          <View style={styles.ageOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              accessible={false}
              importantForAccessibility="no"
              onPress={close}
            />

            <View
              style={styles.ageMenu}
              accessibilityViewIsModal
              onAccessibilityEscape={close}
            >
              <View style={styles.ageMenuHeader}>
                <Text
                  accessibilityRole="header"
                  style={styles.ageMenuTitle}
                >
                  Choose gender
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close gender list"
                  onPress={close}
                  style={styles.ageCloseButton}
                >
                  <Text style={styles.accentText}>
                    Close
                  </Text>
                </Pressable>
              </View>

              <ScrollView
                style={styles.ageList}
                keyboardShouldPersistTaps="handled"
              >
                {[null, ...GENDER_OPTIONS].map(
                  (gender) => {
                    const selected =
                      (value ?? null) === gender;

                    return (
                      <Pressable
                        key={gender || "not-set"}
                        accessibilityRole="radio"
                        accessibilityLabel={
                          gender ||
                          "Gender not set"
                        }
                        accessibilityState={{
                          checked: selected,
                        }}
                        onPress={() => {
                          onChange(gender);
                          close();
                        }}
                        style={({ pressed }) => [
                          styles.ageOption,
                          { minHeight: 56 },
                          selected &&
                            styles.ageOptionSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.ageOptionText,
                            selected &&
                              styles.ageSelectedText,
                          ]}
                        >
                          {gender || "Not set"}
                        </Text>

                        {selected && (
                          <Text
                            style={
                              styles.ageSelectedText
                            }
                            importantForAccessibility="no"
                          >
                            ✓
                          </Text>
                        )}
                      </Pressable>
                    );
                  },
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
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

  const {
    updateProfile,
    changeProfilePhoto,
  } = useAuth();

  const styles = useMemo(
    () => createStyles(colors),
    [colors],
  );

  const [fullName, setFullName] =
    useState(user.fullName);

  const [location, setLocation] = useState(() =>
    selectionForProfile(user),
  );

  const [locationError, setLocationError] =
    useState("");

  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);

  const [error, setError] = useState("");

  const [aboutMe, setAboutMe] =
    useState(user.aboutMe || "");

  const [age, setAge] = useState(
    user.age == null ? "" : String(user.age),
  );

  const [gender, setGender] =
    useState<AppUser["gender"]>(
      user.gender ?? null,
    );

  const [isPublic, setIsPublic] = useState(
    user.profileVisibility === "public",
  );

  const [previewing, setPreviewing] =
    useState(false);

  const [photo, setPhoto] =
    useState<PhotoDraft | null>(null);

  const [choosing, setChoosing] =
    useState(false);

  const alive = useRef(true);
  const picking = useRef(false);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  function stagePhoto(selection: PhotoSelection) {
    setError("");
    setPhoto({
      ...selection,
      requestId:
        `photo-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
    });
  }

  async function choosePhoto() {
    if (picking.current || saving) return;

    picking.current = true;
    setChoosing(true);
    setError("");

    try {
      const result =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 1,
          exif: false,
        });

      if (
        result.canceled ||
        !alive.current ||
        auth.currentUser?.uid !== user.id
      ) {
        return;
      }

      const asset = result.assets[0];

      if (!asset?.width || !asset.height) {
        throw Error(
          "Please choose a different photo.",
        );
      }

      const side = Math.min(
        asset.width,
        asset.height,
      );

      const context =
        ImageManipulator.manipulate(asset.uri);

      context.crop({
        originX: Math.floor(
          (asset.width - side) / 2,
        ),
        originY: Math.floor(
          (asset.height - side) / 2,
        ),
        width: side,
        height: side,
      });

      context.resize({
        width: 512,
        height: 512,
      });

      const rendered =
        await context.renderAsync();

      let image = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.65,
        base64: true,
      });

      if (
        (image.base64?.length || 0) > 273068
      ) {
        image = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress: 0.4,
          base64: true,
        });
      }

      if (
        !image.base64 ||
        image.base64.length > 273068
      ) {
        throw Error(
          "This photo is too large. Please choose another.",
        );
      }

      if (
        alive.current &&
        auth.currentUser?.uid === user.id
      ) {
        stagePhoto({ kind: "upload", jpeg: image.base64 });
      }
    } catch (error) {
      if (alive.current) {
        setError(
          error instanceof Error
            ? error.message
            : "Could not open your photos. Please try again.",
        );
      }
    } finally {
      picking.current = false;

      if (alive.current) {
        setChoosing(false);
      }
    }
  }

  async function save() {
    if (saveLock.current || choosing) return;

    setError("");

    if (
      fullName.trim().length < 2 ||
      fullName.trim().length > 80
    ) {
      setError(
        "Use a name between 2 and 80 characters.",
      );
      return;
    }

    const resolved = resolveArea(location);

    if (!resolved || !location) {
      setLocationError(
        "Choose your city or town to continue.",
      );
      return;
    }

    const ageValue =
      age.trim() === "" ? null : Number(age);

    if (
      ageValue !== null &&
      (
        !/^\d{1,3}$/.test(age.trim()) ||
        !Number.isInteger(ageValue) ||
        ageValue < 1 ||
        ageValue > 120
      )
    ) {
      setError(
        "Choose an age from 1 to 120, or choose Not set.",
      );
      return;
    }

    if (
      auth.currentUser?.uid !== user.id
    ) {
      setError(
        "Your account changed. Please open your profile again.",
      );
      return;
    }

    saveLock.current = true;
    setSaving(true);

    try {
      let photoChange: ProfilePhotoChange | null;
      if (photo?.kind === "preset") {
        const source = await ExpoImage.loadAsync(photo.source);
        const rendered = await ImageManipulator.manipulate(source).renderAsync();
        const image = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress: 0.8,
          base64: true,
        });
        if (!image.base64) throw new Error("Could not prepare the avatar.");
        photoChange = {
          kind: "upload",
          jpeg: image.base64,
          requestId: photo.requestId,
        };
      } else {
        photoChange = photo;
      }

      if (!alive.current || auth.currentUser?.uid !== user.id) return;

      const result = await updateProfile({
        fullName,
        area: [
          resolved.district,
          resolved.city,
        ].filter(Boolean).join(", "),
        interests: user.interests,
        location,
        aboutMe,
        age: ageValue,
        gender: gender ?? null,
        profileVisibility:
          isPublic ? "public" : "private",
      });

      if (!alive.current) return;

      if (!result.ok) {
        setError(result.message);
        return;
      }

      if (photoChange) {
        const changed =
          await changeProfilePhoto(photoChange);

        if (!alive.current) return;

        if (!changed.ok) {
          setError(
            `Your profile details were saved, but the photo change did not finish. ${changed.message}`,
          );
          return;
        }
      }

      if (alive.current) {
        onClose();
      }
    } catch {
      if (alive.current) {
        setError(
          "Could not finish saving your profile. Please try again.",
        );
      }
    } finally {
      saveLock.current = false;

      if (alive.current) {
        setSaving(false);
      }
    }
  }

  return (
    <SafeAreaView
      style={styles.container}
      edges={["top"]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : "height"
        }
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            disabled={saving || choosing}
            style={styles.backButton}
          >
            <Text style={styles.accentText}>
              ← Back to profile
            </Text>
          </Pressable>

          <Text
            accessibilityRole="header"
            style={styles.editTitle}
          >
            Edit profile
          </Text>

          <Text style={styles.editSubtitle}>
            Make your profile feel like you.
          </Text>

          <View style={styles.photoEditor}>
            <ProfileAvatar
              profile={user}
              preview={
                photo?.kind === "preset"
                  ? photo.source
                  : photo?.kind === "upload"
                    ? `data:image/jpeg;base64,${photo.jpeg}`
                    : photo?.kind === "remove"
                      ? ""
                      : undefined
              }
            />

            <Text accessibilityRole="header" style={styles.menuTitle}>
              Choose an avatar
            </Text>
            <View style={styles.avatarChoices}>
              {PROFILE_AVATARS.map((avatar) => {
                const selected =
                  photo?.kind === "preset" && photo.source === avatar.source;

                return (
                  <Pressable
                    key={avatar.id}
                    accessibilityRole="radio"
                    accessibilityLabel={avatar.label}
                    accessibilityState={{ checked: selected, disabled: saving || choosing }}
                    disabled={saving || choosing}
                    onPress={() => stagePhoto({ kind: "preset", source: avatar.source })}
                    style={({ pressed }) => [
                      styles.avatarChoice,
                      selected && styles.avatarChoiceSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Image
                      source={avatar.source}
                      style={styles.avatarChoiceImage}
                    />
                    {selected && (
                      <View style={styles.avatarCheck} importantForAccessibility="no">
                        <Text style={styles.avatarCheckText}>✓</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.photoActions}>
              <Pressable
                accessibilityRole="button"
                disabled={saving || choosing}
                onPress={() => void choosePhoto()}
                style={({ pressed }) => [styles.photoAction, pressed && styles.pressed]}
              >
                <Text style={styles.photoActionText}>
                  {choosing ? "Preparing photo…" : "Choose photo from phone"}
                </Text>
              </Pressable>

              {(user.photoVersion || photo?.kind === "upload" || photo?.kind === "preset") &&
                photo?.kind !== "remove" && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || choosing}
                    onPress={() => setPhoto({ kind: "remove" })}
                    style={({ pressed }) => [styles.photoAction, pressed && styles.pressed]}
                  >
                    <Text style={styles.photoActionText}>Remove photo</Text>
                  </Pressable>
                )}
            </View>
          </View>

          <View style={styles.editFields}>
            <FormField
              label="Full name"
              value={fullName}
              onChangeText={(value) => {
                setFullName(value);
                setError("");
              }}
              disabled={saving}
              inputProps={{
                autoCapitalize: "words",
                autoComplete: "name",
              }}
            />

            <AreaField
              value={location}
              error={locationError}
              disabled={saving}
              onChange={(value) => {
                setLocation(value);
                setLocationError("");
                setError("");
              }}
            />

            <View
              style={{
                flexDirection: "row",
                gap: 12,
              }}
            >
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <AgeDropdown
                  value={age}
                  onChange={(value) => {
                    setAge(value);
                    setError("");
                  }}
                  disabled={saving}
                />
              </View>

              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <GenderDropdown
                  value={gender}
                  onChange={(value) => {
                    setGender(value);
                    setError("");
                  }}
                  disabled={saving}
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.menuTitle}>
                About
              </Text>

              <TextInput
                accessibilityLabel="About"
                multiline
                textAlignVertical="top"
                maxLength={1000}
                value={aboutMe}
                onChangeText={setAboutMe}
                editable={!saving}
                placeholder="A little about yourself and the company you enjoy…"
                placeholderTextColor={colors.muted}
                style={styles.aboutInput}
              />
            </View>

            <View style={styles.detailCard}>
              <View
                style={styles.visibilityHeading}
              >
                <Text
                  style={styles.menuTitle}
                >
                  Public profile
                </Text>

                <Switch
                  accessibilityLabel="Public profile"
                  value={isPublic}
                  disabled={saving}
                  onValueChange={setIsPublic}
                  trackColor={{
                    false: colors.border,
                    true: colors.accent,
                  }}
                  thumbColor={colors.surface}
                  ios_backgroundColor={colors.border}
                />
              </View>

              <Text style={styles.description}>
                {isPublic
                  ? "Other signed-in members can see your photo, bio, interests, age, gender and area. Your email stays private."
                  : "Only you can open your full profile. Your name and general area can still appear in member lists and chats."}
              </Text>

              <Pressable
                accessibilityRole="button"
                disabled={saving || choosing}
                onPress={() =>
                  setPreviewing(true)
                }
                style={({ pressed }) => [
                  styles.outlineButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={styles.outlineButtonText}
                >
                  Preview saved profile
                </Text>
              </Pressable>
            </View>
          </View>

          {!!error && (
            <Text
              accessibilityRole="alert"
              style={{
                color: colors.text,
                fontSize: 16,
                lineHeight: 24,
              }}
            >
              {error}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={save}
            accessibilityState={{
              disabled: saving || choosing,
              busy: saving,
            }}
            disabled={saving || choosing}
            style={({ pressed }) => [
              styles.primaryButton,
              saving && styles.pressed,
              pressed && styles.pressed,
            ]}
          >
            {saving ? (
              <ActivityIndicator
                color={colors.background}
              />
            ) : (
              <Text
                style={styles.primaryButtonText}
              >
                Save profile
              </Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            disabled={saving || choosing}
            style={styles.cancelButton}
          >
            <Text
              style={styles.outlineButtonText}
            >
              Cancel
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={previewing}
        animationType="slide"
        onRequestClose={() =>
          setPreviewing(false)
        }
      >
        <ProfilePreview
          user={user}
          onClose={() =>
            setPreviewing(false)
          }
          backLabel="← Back to Edit profile"
        />
      </Modal>
    </SafeAreaView>
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);

  const first =
    Array.from(parts[0] || "")[0] || "";

  const last =
    parts.length > 1
      ? Array.from(
          parts[parts.length - 1]!,
        )[0] || ""
      : "";

  return `${first}${last}`.toUpperCase();
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      width: "100%",
      maxWidth: 640,
      alignSelf: "center",
      padding: 20,
      paddingBottom: 36,
      gap: 20,
    },
    signedInContent: { flexGrow: 1, paddingTop: 10, paddingBottom: 24, gap: 18 },
    overviewHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
    overviewBrandSlot: { width: 48, alignItems: "center" },
    overviewBrandMark: {
      width: 34,
      height: 34,
      borderRadius: 12,
      backgroundColor: colors.surface,
      justifyContent: "center",
      alignItems: "center",
    },
    overviewBrandText: { color: colors.accent, fontSize: 17, fontWeight: "700" },
    overviewTitle: {
      flex: 1,
      minWidth: 0,
      color: colors.text,
      fontSize: 18,
      fontWeight: "600",
      textAlign: "center",
    },
    overviewSettingsButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      justifyContent: "center",
      alignItems: "center",
    },
    pageTitle: {
      color: colors.text,
      fontSize: 28,
      fontWeight: "700",
    },
    brandRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 4,
    },
    brandIdentity: {
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 1,
      gap: 10,
    },
    logo: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    logoText: {
      color: colors.background,
      fontSize: 24,
      fontWeight: "800",
    },
    brandText: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "700",
      flexShrink: 1,
    },
    settingsButton: {
      minHeight: 48,
      paddingHorizontal: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 12,
    },
    settingsText: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: "600",
    },
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
    artAvatarText: {
      color: colors.text,
      fontSize: 27,
      fontWeight: "700",
    },
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
    welcomeActions: {
      gap: 12,
      marginTop: 8,
    },
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
    section: {
      gap: 12,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
    },
    benefits: {
      gap: 14,
      paddingHorizontal: 2,
    },
    benefit: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 24,
    },
    overviewHero: { alignItems: "center", gap: 12, paddingBottom: 4 },
    overviewPortrait: { alignItems: "center", maxWidth: "100%" },
    overviewAvatar: {
      width: 86,
      height: 86,
      borderRadius: 43,
      borderWidth: 2,
      borderColor: colors.accent,
      overflow: "hidden",
    },
    overviewAvatarImage: { borderRadius: 41 },
    overviewAvatarText: { fontSize: 30 },
    overviewBadge: {
      marginTop: -7,
      maxWidth: "100%",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    overviewVisibility: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: "600",
      textAlign: "center",
    },
    overviewIdentity: { width: "100%", alignItems: "stretch", gap: 4 },
    overviewName: {
      color: colors.text,
      fontSize: 26,
      fontWeight: "600",
      letterSpacing: -0.4,
      textAlign: "center",
    },
    overviewEmail: { color: colors.muted, fontSize: 15, textAlign: "center" },
    overviewMeta: { color: colors.muted, fontSize: 15, textAlign: "center" },
    editProfileButton: {
      minHeight: 48,
      maxWidth: "100%",
      paddingHorizontal: 18,
      paddingVertical: 8,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    editProfileButtonText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
      flexShrink: 1,
    },
    overviewSection: { gap: 8 },
    overviewSectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "600",
      paddingHorizontal: 2,
    },
    overviewDetail: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    overviewDescription: { color: colors.muted, fontSize: 16, lineHeight: 23 },
    overviewChip: { maxWidth: "100%", paddingHorizontal: 10, paddingVertical: 5 },
    profileIdentity: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
    },
    profileCopy: {
      flex: 1,
      gap: 6,
    },
    interestWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    interestChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    interestText: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 21,
    },
    email: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 23,
    },
    detailCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 20,
      padding: 20,
      gap: 14,
    },
    description: {
      color: colors.muted,
      fontSize: 17,
      lineHeight: 25,
    },
    visibilityHeading: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    ageDropdown: {
      minHeight: 58,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    agePlaceholder: {
      color: colors.muted,
      fontSize: 17,
      lineHeight: 24,
    },
    ageOverlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.6)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    ageMenu: {
      width: "100%",
      maxWidth: 420,
      maxHeight: "85%",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      backgroundColor: colors.surface,
      padding: 16,
      gap: 12,
    },
    ageMenuHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    ageMenuTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 22,
      fontWeight: "700",
    },
    ageCloseButton: {
      minHeight: 48,
      minWidth: 48,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 8,
    },
    ageList: {
      maxHeight: 320,
      flexShrink: 1,
    },
    ageOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
    },
    ageOptionSelected: {
      backgroundColor: colors.accent,
    },
    ageOptionText: {
      color: colors.text,
      fontSize: 18,
      lineHeight: 24,
    },
    ageSelectedText: {
      color: colors.background,
      fontSize: 18,
      fontWeight: "700",
      lineHeight: 24,
    },
    avatarImage: {
      width: "100%",
      height: "100%",
      borderRadius: 32,
    },
    photoEditor: {
      alignItems: "center",
      gap: 12,
    },
    avatarChoices: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 10,
    },
    avatarChoice: {
      width: 60,
      height: 60,
      borderRadius: 30,
      borderWidth: 2,
      borderColor: colors.border,
      padding: 2,
    },
    avatarChoiceSelected: { borderColor: colors.accent },
    avatarChoiceImage: { width: "100%", height: "100%", borderRadius: 26 },
    avatarCheck: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarCheckText: {
      color: colors.background,
      fontSize: 12,
      fontWeight: "700",
      includeFontPadding: false,
    },
    photoActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      columnGap: 12,
    },
    photoAction: {
      maxWidth: "100%",
      minHeight: 48,
      justifyContent: "center",
      paddingHorizontal: 4,
      paddingVertical: 8,
    },
    photoActionText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: "600",
      textAlign: "center",
    },
    aboutInput: {
      minHeight: 150,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 17,
      lineHeight: 25,
      padding: 16,
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      color: colors.background,
      fontSize: 26,
      fontWeight: "700",
    },
    name: {
      color: colors.text,
      fontSize: 24,
      fontWeight: "700",
    },
    subtitle: {
      color: colors.muted,
      fontSize: 17,
      lineHeight: 24,
    },
    accentText: {
      color: colors.accent,
      fontSize: 17,
      fontWeight: "600",
    },
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
    menuBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    menuCopy: {
      flex: 1,
      gap: 4,
    },
    menuTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "600",
    },
    menuDetail: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 20,
    },
    chevron: {
      color: colors.muted,
      fontSize: 26,
    },
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
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    signOutText: { color: colors.accent, fontSize: 15, fontWeight: "600" },
    accountFooter: { paddingTop: 2 },
    pressed: {
      opacity: 0.75,
    },
    backButton: {
      minHeight: 48,
      justifyContent: "center",
      alignSelf: "flex-start",
    },
    editTitle: {
      color: colors.text,
      fontSize: 30,
      fontWeight: "700",
    },
    editSubtitle: {
      color: colors.muted,
      fontSize: 17,
      lineHeight: 25,
    },
    editFields: {
      gap: 20,
    },
    cancelButton: {
      minHeight: 48,
      justifyContent: "center",
      alignItems: "center",
    },
  });
}
