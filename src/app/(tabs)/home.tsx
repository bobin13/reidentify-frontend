import { useMemo } from "react";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { AppColors } from "../../constants/app-colors";
import { useAppTheme } from "../../context/theme-context";

/*
  Temporary data.
  Later this can come from your backend/API instead.
*/
const featuredActivity = {
  id: "1",
  title: "Community Garden Morning",
  category: "VOLUNTEERING",
  date: "18",
  month: "OCT",
  time: "Friday, 10:00 am",
  location: "Oakfield Garden",
  distance: "0.8 miles",
  image: require("../../../assets/images/placeholder1.jpg"),
};

const nearbyGroups = [
  {
    id: "1",
    title: "Riverside Walkers",
    details: "42 members · 1.2 miles",
    image: require("../../../assets/images/placeholder2.jpg"),
  },
  {
    id: "2",
    title: "Green Fingers Club",
    details: "28 members · 0.8 miles",
    image: require("../../../assets/images/placeholder3.jpg"),
  },
];

export default function HomeScreen() {
  const { colors, theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(colors, theme === "dark"),
    [colors, theme],
  );

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

          <Pressable style={styles.notificationButton}>
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
          </Pressable>
        </View>

        {/* GREETING */}
        <Text style={styles.date}>MONDAY, 14 OCTOBER</Text>

        <Text style={styles.greeting}>
          Good morning,{"\n"}Margaret
        </Text>

        <Text style={styles.subtitle}>
          There are friendly faces and new things to try nearby.
        </Text>

        {/* SEARCH */}
        <Pressable
          style={styles.searchBox}
          onPress={() => router.push("/search")}
        >
          <SymbolView
            name={{
              ios: "magnifyingglass",
              android: "search",
              web: "search",
            }}
            size={22}
            tintColor={colors.muted}
          />

          <Text style={styles.searchText}>
            What would you like to do?
          </Text>
        </Pressable>

        {/* NEARBY / ACTIVITIES */}
        <View style={styles.quickRow}>
          <Pressable
            style={[styles.quickCard, styles.nearbyCard]}
            onPress={() => router.push("/map")}
          >
            <View style={styles.quickIcon}>
              <SymbolView
                name={{
                  ios: "location.circle",
                  android: "location_on",
                  web: "location_on",
                }}
                size={24}
                tintColor={colors.accent}
              />
            </View>

            <Text style={styles.quickTitle}>Nearby</Text>
            <Text style={styles.quickDescription}>
              Explore the area
            </Text>
          </Pressable>

          <Pressable
            style={[styles.quickCard, styles.activityCard]}
          >
            <View style={styles.quickIcon}>
              <SymbolView
                name={{
                  ios: "calendar",
                  android: "calendar_month",
                  web: "calendar_month",
                }}
                size={24}
                tintColor={colors.accent}
              />
            </View>

            <Text style={styles.quickTitle}>
              My activities
            </Text>

            <Text style={styles.quickDescription}>
              See your plans
            </Text>
          </Pressable>
        </View>

        {/* HAPPENING SOON */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Happening soon
          </Text>

          <Pressable>
            <Text style={styles.sectionLink}>
              See all
            </Text>
          </Pressable>
        </View>

        <Pressable style={styles.featuredCard}>
          <Image
            source={featuredActivity.image}
            style={styles.featuredImage}
          />

          <View style={styles.dateBadge}>
            <Text style={styles.dateNumber}>
              {featuredActivity.date}
            </Text>

            <Text style={styles.dateMonth}>
              {featuredActivity.month}
            </Text>
          </View>

          <View style={styles.featuredBody}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>
                {featuredActivity.category}
              </Text>
            </View>

            <Text style={styles.featuredTitle}>
              {featuredActivity.title}
            </Text>

            <View style={styles.infoRow}>
              <SymbolView
                name={{
                  ios: "clock",
                  android: "schedule",
                  web: "schedule",
                }}
                size={17}
                tintColor={colors.muted}
              />

              <Text style={styles.infoText}>
                {featuredActivity.time}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <SymbolView
                name={{
                  ios: "location",
                  android: "location_on",
                  web: "location_on",
                }}
                size={17}
                tintColor={colors.muted}
              />

              <Text style={styles.infoText}>
                {featuredActivity.location} ·{" "}
                {featuredActivity.distance}
              </Text>
            </View>
          </View>
        </Pressable>

        {/* GROUPS NEAR YOU */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Groups near you
          </Text>

          <Pressable onPress={() => router.push("/map")}>
            <Text style={styles.sectionLink}>
              View map
            </Text>
          </Pressable>
        </View>

        <View style={styles.groupsRow}>
          {nearbyGroups.map((group) => (
            <Pressable
              key={group.id}
              style={styles.groupCard}
            >
              <Image
                source={group.image}
                style={styles.groupImage}
              />

              <View style={styles.groupBody}>
                <Text style={styles.groupTitle}>
                  {group.title}
                </Text>

                <Text style={styles.groupDetails}>
                  {group.details}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* COMMUNITY MESSAGE */}
        <View style={styles.messageCard}>
          <SymbolView
            name={{
              ios: "heart",
              android: "favorite_border",
              web: "favorite_border",
            }}
            size={27}
            tintColor={colors.accent}
          />

          <View style={styles.messageContent}>
            <Text style={styles.messageTitle}>
              A little hello goes a long way
            </Text>

            <Text style={styles.messageText}>
              Join a group and meet someone new this week.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors, isDark: boolean) {
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
      alignItems: "center",
      justifyContent: "center",
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
      width: 45,
      height: 45,
      alignItems: "center",
      justifyContent: "center",
    },

    notificationBadge: {
      position: "absolute",
      top: 1,
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
      fontWeight: "800",
      fontSize: 11,
    },

    date: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 1,
      marginBottom: 8,
    },

    greeting: {
      color: colors.text,
      fontSize: 34,
      lineHeight: 39,
      fontWeight: "700",
      fontFamily: "serif",
    },

    subtitle: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 23,
      marginTop: 10,
      marginBottom: 22,
    },

    searchBox: {
      height: 56,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 15,
      backgroundColor: colors.surface,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      gap: 12,
      marginBottom: 18,
    },

    searchText: {
      color: colors.muted,
      fontSize: 15,
      fontWeight: "600",
    },

    quickRow: {
      flexDirection: "row",
      gap: 12,
      marginBottom: 28,
    },

    quickCard: {
      flex: 1,
      minHeight: 122,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
    },

    nearbyCard: {
      backgroundColor: isDark ? "#162923" : "#EAF5EF",
      borderColor: isDark ? "#23453A" : "#C8E2D4",
    },

    activityCard: {
      backgroundColor: isDark ? "#29201D" : "#FFF1E9",
      borderColor: isDark ? "#49332B" : "#ECD7CA",
    },

    quickIcon: {
      width: 39,
      height: 39,
      borderRadius: 12,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
    },

    quickTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
    },

    quickDescription: {
      color: colors.muted,
      fontSize: 13,
      marginTop: 5,
    },

    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },

    sectionTitle: {
      color: colors.text,
      fontSize: 25,
      fontWeight: "700",
      fontFamily: "serif",
    },

    sectionLink: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: "700",
    },

    featuredCard: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      marginBottom: 28,
    },

    featuredImage: {
      width: "100%",
      height: 190,
      resizeMode: "cover",
    },

    dateBadge: {
      position: "absolute",
      top: 155,
      left: 15,
      width: 58,
      height: 58,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      elevation: 4,
    },

    dateNumber: {
      color: colors.text,
      fontSize: 21,
      fontWeight: "800",
    },

    dateMonth: {
      color: isDark ? "#E87561" : "#AD4D3C",
      fontSize: 10,
      fontWeight: "800",
    },

    featuredBody: {
      paddingHorizontal: 18,
      paddingTop: 25,
      paddingBottom: 18,
    },

    categoryBadge: {
      alignSelf: "flex-start",
      backgroundColor: isDark ? "#173129" : "#E5F3EB",
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      marginBottom: 8,
    },

    categoryText: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.6,
    },

    featuredTitle: {
      color: colors.text,
      fontSize: 23,
      lineHeight: 27,
      fontWeight: "700",
      fontFamily: "serif",
      marginBottom: 14,
    },

    infoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      marginTop: 6,
    },

    infoText: {
      color: colors.muted,
      fontSize: 13,
    },

    groupsRow: {
      flexDirection: "row",
      gap: 12,
      marginBottom: 22,
    },

    groupCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },

    groupImage: {
      width: "100%",
      height: 105,
      resizeMode: "cover",
    },

    groupBody: {
      padding: 11,
    },

    groupTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },

    groupDetails: {
      color: colors.muted,
      fontSize: 11,
      marginTop: 5,
    },

    messageCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: isDark ? "#29261B" : "#FFF6D9",
      borderWidth: 1,
      borderColor: isDark ? "#403A25" : "#E8DCAD",
      borderRadius: 16,
      padding: 18,
      gap: 15,
      marginBottom: 20,
    },

    messageContent: {
      flex: 1,
    },

    messageTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },

    messageText: {
      color: colors.muted,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 4,
    },
  });
}
