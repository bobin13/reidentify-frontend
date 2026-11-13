import { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import { AppState, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";
import { groupRequest, type CommunityGroup } from "../../lib/groups";
import { getChats } from "../../lib/messaging";
import {
  InterestsOnboarding,
  needsInterestOnboarding,
} from "../../components/interests-onboarding";

export default function TabLayout() {
  const { colors } = useAppTheme();
  const { user } = useAuth();
  const uid = user?.id || "";
  const insets = useSafeAreaInsets();
  const [unread, setUnread] = useState({ owner: "", value: false });
  const hasUnread = unread.owner === uid && unread.value;

  useEffect(() => {
    if (!uid) return;

    let active = true;
    let busy = false;

    async function refreshUnread() {
      if (
        !active ||
        busy ||
        (AppState.currentState && AppState.currentState !== "active")
      ) {
        return;
      }

      busy = true;
      try {
        const [chats, groups] = await Promise.all([
          getChats(uid),
          groupRequest<{ groups: CommunityGroup[] }>(uid, "/api/groups/mine"),
        ]);
        if (active) {
          setUnread({
            owner: uid,
            value:
              chats.conversations.some((chat) => chat.unreadCount > 0) ||
              groups.groups.some((group) => group.unreadCount > 0),
          });
        }
      } catch (error) {
        if (active) {
          console.warn("Unable to refresh unread message indicator.", error);
        }
      } finally {
        busy = false;
      }
    }

    void refreshUnread();
    const timer = setInterval(() => void refreshUnread(), 10000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshUnread();
    });

    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [uid]);

  // New accounts choose their first interests before seeing the tabs.
  if (needsInterestOnboarding(user)) {
    return <InterestsOnboarding key={user.id} user={user} />;
  }

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          height: 64 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 8 + insets.bottom,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <SymbolView
              name={{
                ios: focused ? "house.fill" : "house",
                android: "home",
                web: "home",
              }}
              size={22}
              tintColor={color}
              weight={focused ? "semibold" : "regular"}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "magnifyingglass",
                android: "search",
                web: "search",
              }}
              size={22}
              tintColor={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "map.fill",
                android: "map",
                web: "map",
              }}
              size={22}
              tintColor={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarAccessibilityLabel: hasUnread
            ? "Messages, unread messages"
            : "Messages",
          tabBarIcon: ({ color }) => (
            <View style={{ position: "relative" }}>
              <SymbolView
                name={{
                  ios: "bubble.left.and.bubble.right.fill",
                  android: "chat",
                  web: "chat",
                }}
                size={22}
                tintColor={color}
              />
              {hasUnread && (
                <View
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -4,
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    borderWidth: 2,
                    borderColor: colors.surface,
                    backgroundColor: "#E53935",
                  }}
                />
              )}
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "person.crop.circle.fill",
                android: "account_circle",
                web: "account_circle",
              }}
              size={22}
              tintColor={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}