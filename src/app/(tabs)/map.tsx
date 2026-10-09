import { useMemo } from "react";
import { SymbolView } from "expo-symbols";
import {
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { AppColors } from "../../constants/app-colors";
import { useAppTheme } from "../../context/theme-context";

const closestActivity = {
  title: "Community Garden Morning",
  time: "Friday, 10:00 am",
  distance: "0.8 miles away",
  image: require("../../../assets/images/placeholder1.jpg"),
};

export default function MapScreen() {
  const { colors, theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(colors, theme === "dark"),
    [colors, theme],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>

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

        {/* MAP AREA */}
        <View style={styles.mapArea}>

          {/* decorative park */}
          <View style={styles.parkArea}>
            <Text style={styles.mapLabel}>Riverside Park</Text>
          </View>

          {/* decorative river */}
          <View style={styles.river} />

          {/* decorative road 1 */}
          <View style={[styles.road, styles.roadOne]} />

          {/* decorative road 2 */}
          <View style={[styles.road, styles.roadTwo]} />

          <Text style={styles.roadLabel}>
            Oakfield Road
          </Text>

          {/* SEARCH BAR */}
          <View style={styles.searchBar}>
            <SymbolView
              name={{
                ios: "magnifyingglass",
                android: "search",
                web: "search",
              }}
              size={22}
              tintColor={colors.text}
            />

            <Text style={styles.searchText}>
              Search this area
            </Text>

            <View style={styles.searchDivider} />

            <Pressable style={styles.filterButton}>
              <SymbolView
                name={{
                  ios: "line.3.horizontal.decrease",
                  android: "filter_list",
                  web: "filter_list",
                }}
                size={22}
                tintColor={colors.text}
              />
            </Pressable>
          </View>

          {/* MAP MARKER 1 */}
          <Pressable style={[styles.marker, styles.markerOne]}>
            <SymbolView
              name={{
                ios: "leaf.fill",
                android: "eco",
                web: "eco",
              }}
              size={20}
              tintColor="#FFFFFF"
            />
          </Pressable>

          {/* MAP MARKER 2 */}
          <Pressable style={[styles.marker, styles.markerTwo]}>
            <SymbolView
              name={{
                ios: "figure.walk",
                android: "directions_walk",
                web: "directions_walk",
              }}
              size={20}
              tintColor="#FFFFFF"
            />
          </Pressable>

          {/* MAP MARKER 3 */}
          <Pressable style={[styles.marker, styles.markerThree]}>
            <SymbolView
              name={{
                ios: "heart.fill",
                android: "favorite",
                web: "favorite",
              }}
              size={18}
              tintColor="#FFFFFF"
            />
          </Pressable>
        </View>

        {/* CLOSEST ACTIVITY PANEL */}
        <View style={styles.bottomSheet}>
          <View style={styles.handle} />

          <Text style={styles.closestLabel}>
            CLOSEST TO YOU
          </Text>

          <Pressable style={styles.activityRow}>
            <Image
              source={closestActivity.image}
              style={styles.activityImage}
            />

            <View style={styles.activityInfo}>
              <Text style={styles.activityTitle}>
                {closestActivity.title}
              </Text>

              <Text style={styles.activityTime}>
                {closestActivity.time}
              </Text>

              <View style={styles.distanceRow}>
                <SymbolView
                  name={{
                    ios: "location",
                    android: "location_on",
                    web: "location_on",
                  }}
                  size={16}
                  tintColor={colors.accent}
                />

                <Text style={styles.distanceText}>
                  {closestActivity.distance}
                </Text>
              </View>
            </View>

            <SymbolView
              name={{
                ios: "chevron.right",
                android: "chevron_right",
                web: "chevron_right",
              }}
              size={24}
              tintColor={colors.text}
            />
          </Pressable>
        </View>
      </View>
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

    /* HEADER */

    header: {
      height: 72,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      zIndex: 10,
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
      fontFamily: "serif",
      fontSize: 28,
      fontWeight: "700",
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
      justifyContent: "center",
      alignItems: "center",
    },

    notificationBadgeText: {
      color: "#FFFFFF",
      fontSize: 11,
      fontWeight: "800",
    },

    /* MAP */

    mapArea: {
      flex: 1,
      overflow: "hidden",
      backgroundColor: isDark ? "#161A1D" : "#F0F2EC",
    },

    parkArea: {
      position: "absolute",
      width: 180,
      height: 170,
      left: -30,
      top: 105,
      borderRadius: 90,
      backgroundColor: isDark ? "#18322C" : "#DCEBD9",
      paddingTop: 35,
      paddingLeft: 60,
    },

    mapLabel: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
    },

    river: {
      position: "absolute",
      width: 100,
      height: 600,
      backgroundColor: isDark ? "#17303A" : "#C5E2EF",
      transform: [{ rotate: "18deg" }],
      left: 205,
      top: -70,
    },

    road: {
      position: "absolute",
      height: 18,
      width: 520,
      backgroundColor: isDark ? "#30373D" : "#FFFFFF",
      borderWidth: 2,
      borderColor: isDark ? "#414A50" : "#CDD3CD",
    },

    roadOne: {
      top: 205,
      left: -60,
      transform: [{ rotate: "-16deg" }],
    },

    roadTwo: {
      top: 310,
      left: -70,
      transform: [{ rotate: "25deg" }],
    },

    roadLabel: {
      position: "absolute",
      right: 32,
      top: 210,
      color: colors.muted,
      fontSize: 11,
      transform: [{ rotate: "-16deg" }],
    },

    /* SEARCH */

    searchBar: {
      position: "absolute",
      top: 18,
      left: 18,
      right: 18,
      height: 56,
      borderRadius: 15,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      zIndex: 5,
    },

    searchText: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
      marginLeft: 12,
    },

    searchDivider: {
      height: 30,
      width: 1,
      backgroundColor: colors.border,
    },

    filterButton: {
      width: 45,
      height: 45,
      justifyContent: "center",
      alignItems: "center",
    },

    /* MARKERS */

    marker: {
      position: "absolute",
      width: 50,
      height: 50,
      borderRadius: 25,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: 4,
      borderColor: colors.text,
      elevation: 5,
    },

    markerOne: {
      left: 125,
      top: 175,
      backgroundColor: "#117C6C",
    },

    markerTwo: {
      left: 215,
      top: 275,
      backgroundColor: "#497B91",
    },

    markerThree: {
      right: 55,
      top: 145,
      backgroundColor: "#E87561",
    },

    /* BOTTOM SHEET */

    bottomSheet: {
      minHeight: 220,
      backgroundColor: colors.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 22,
      borderTopWidth: 1,
      borderColor: colors.border,
    },

    handle: {
      width: 42,
      height: 4,
      borderRadius: 3,
      alignSelf: "center",
      backgroundColor: colors.border,
      marginBottom: 18,
    },

    closestLabel: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 1,
      marginBottom: 13,
    },

    activityRow: {
      flexDirection: "row",
      alignItems: "center",
    },

    activityImage: {
      width: 82,
      height: 82,
      borderRadius: 13,
      resizeMode: "cover",
    },

    activityInfo: {
      flex: 1,
      marginLeft: 13,
    },

    activityTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
      marginBottom: 6,
    },

    activityTime: {
      color: colors.muted,
      fontSize: 13,
      marginBottom: 5,
    },

    distanceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },

    distanceText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: "700",
    },
  });
}
