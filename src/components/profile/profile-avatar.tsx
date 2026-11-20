import { useEffect, useMemo, useState } from "react";

import {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { ModalSafeArea } from "../modal-safe-area";

import { areaLabel, resolveArea } from "../../lib/locations";

import { useAuth, type AppUser } from "../../context/auth-context";

import { useAppTheme } from "../../context/theme-context";
import { auth } from "../../lib/firebase";
import { apiRequest } from "../../lib/api";
import { createStyles } from "./profile-styles";

export type AvatarAsset = number | { uri: string };
type AvatarPreview = AvatarAsset | string;

export function ProfileAvatar({
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

export function ProfilePreview({
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
    <ModalSafeArea
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
    </ModalSafeArea>
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
