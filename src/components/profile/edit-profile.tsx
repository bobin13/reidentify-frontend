import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Image as ExpoImage } from "expo-image";
import { SymbolView } from "expo-symbols";

import {
  ActivityIndicator,
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

import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { FormField } from "../auth-screen";
import { AreaField } from "../area-field";

import { resolveArea, selectionForProfile } from "../../lib/locations";

import { useAuth, type AppUser, type ProfilePhotoChange } from "../../context/auth-context";

import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import { createStyles } from "./profile-styles";
import { ProfileAvatar, ProfilePreview, type AvatarAsset } from "./profile-avatar";

// A unique id per staged photo, so a retried upload is not applied twice.
const photoRequestId = () =>
  `photo-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

const AGE_OPTIONS = Array.from(
  { length: 120 },
  (_, index) => String(index + 1),
);

const GENDER_OPTIONS = [
  "Woman",
  "Man",
  "Non-binary",
] as const;

const PROFILE_AVATARS: readonly {
  id: string;
  label: string;
  source: AvatarAsset;
}[] = [
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

export function EditProfile({
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
      requestId: photoRequestId(),
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
