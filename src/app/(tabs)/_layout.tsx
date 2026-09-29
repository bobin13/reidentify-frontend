import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import { colors } from "../../constants/app-colors";

export default function TabLayout() {
  return (
    <Tabs
      initialRouteName="feed"
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          height: 64,
          paddingTop: 8,
          paddingBottom: 8,
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
        name="feed"
        options={{
          title: "Feed",
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
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "bubble.left.and.bubble.right.fill",
                android: "chat",
                web: "chat",
              }}
              size={22}
              tintColor={color}
            />
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
