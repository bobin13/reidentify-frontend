import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../context/auth-context";
import { useAppTheme } from "../../context/theme-context";
import { useInbox, useInboxPolling } from "../../lib/inbox";
import {
  InterestsOnboarding,
  needsInterestOnboarding,
} from "../../components/interests-onboarding";

export default function TabLayout() {
  const { colors } = useAppTheme();
  const { user } = useAuth();
  const uid = user?.id || "";
  const insets = useSafeAreaInsets();
  // The only poller for chats and groups; Messages reads the same data.
  useInboxPolling(uid);
  const inbox = useInbox(uid);
  const hasUnread =
    !!uid &&
    (!!inbox.chats?.some((chat) => chat.unreadCount > 0) ||
      !!inbox.groups?.some((group) => group.unreadCount > 0));

  // New accounts choose their first interests before seeing the tabs.
  if (needsInterestOnboarding(user)) {
    return <InterestsOnboarding key={user.id} user={user} />;
  }

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        // Slide-and-fade toward the tapped tab so the order reads clearly.
        animation: "shift",
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          height: 60 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 6 + insets.bottom,
          backgroundColor: colors.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: 0.1,
          marginTop: 2,
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
                    backgroundColor: colors.danger,
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