import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useInterventions } from "@/context/InterventionsContext";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { stats } = useInterventions();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const handleLogout = () => {
    Alert.alert("Déconnexion", "Voulez-vous vous déconnecter ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Se déconnecter",
        style: "destructive",
        onPress: async () => {
          setIsLoggingOut(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await logout();
          router.dismissAll();
        },
      },
    ]);
  };

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0].toUpperCase() ?? "?";

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[COLORS.dark, COLORS.darkMid]}
        style={[styles.hero, { paddingTop: topPadding + 16 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.heroHeader}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.closeBtn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        </View>

        <Text style={styles.heroName}>
          {user?.displayName ?? "Utilisateur"}
        </Text>
        <Text style={styles.heroEmail}>{user?.email}</Text>

        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatVal}>{stats.total}</Text>
            <Text style={styles.heroStatLabel}>Interventions</Text>
          </View>
          <View style={styles.heroStatDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatVal}>{stats.done}</Text>
            <Text style={styles.heroStatLabel}>Terminées</Text>
          </View>
          <View style={styles.heroStatDivider} />
          <View style={styles.heroStat}>
            <Text style={[styles.heroStatVal, { color: "#F59E0B" }]}>
              {stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}
            </Text>
            <Text style={styles.heroStatLabel}>Note moy.</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={[styles.content, { paddingBottom: bottomPadding + 16 }]}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compte</Text>

          <View style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                <Ionicons name="person-outline" size={18} color={COLORS.primary} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Nom</Text>
                <Text style={styles.rowValue}>
                  {user?.displayName ?? "Non renseigné"}
                </Text>
              </View>
            </View>

            <View style={styles.separator} />

            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                <Ionicons name="mail-outline" size={18} color={COLORS.success} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Email</Text>
                <Text style={styles.rowValue}>{user?.email}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Application</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: "#F5F3FF" }]}>
                <Ionicons name="shield-checkmark-outline" size={18} color={"#2563EB"} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Stockage</Text>
                <Text style={styles.rowValue}>Firebase Firestore</Text>
              </View>
            </View>

            <View style={styles.separator} />

            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: "#FFF7ED" }]}>
                <Ionicons name="server-outline" size={18} color={COLORS.warning} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Version</Text>
                <Text style={styles.rowValue}>Maintena 1.0</Text>
              </View>
            </View>
          </View>
        </View>

        <Pressable
          onPress={handleLogout}
          disabled={isLoggingOut}
          style={({ pressed }) => [
            styles.logoutBtn,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    alignItems: "center",
  },
  heroHeader: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 16,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarWrap: {
    marginBottom: 14,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: COLORS.teal,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.2)",
  },
  avatarText: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  heroName: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    marginBottom: 4,
  },
  heroEmail: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
    marginBottom: 20,
  },
  heroStats: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
    width: "100%",
    justifyContent: "center",
    gap: 0,
  },
  heroStat: {
    flex: 1,
    alignItems: "center",
  },
  heroStatVal: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  heroStatLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.45)",
    marginTop: 2,
  },
  heroStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  content: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  rowValue: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: COLORS.text,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginLeft: 62,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    backgroundColor: "#FEF2F2",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FECACA",
    marginTop: 4,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.danger,
  },
});
