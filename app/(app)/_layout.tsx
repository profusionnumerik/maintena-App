import { useMemo } from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { useCoPro } from "@/context/CoProContext";
import { COLORS } from "@/constants/colors";

type TabBarIconProps = { color: string; size: number; focused: boolean }

export default function AppLayout() {
  const { currentRole, signalements } = useCoPro();

  const unacknowledgedCount = useMemo(
    () => signalements.filter((s) => !s.acknowledged).length,
    [signalements]
  );

  const isAdmin = currentRole === "admin";
  const isOwner = currentRole === "propriétaire";
  const isPrestataire = currentRole === "prestataire";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: Platform.OS === "web" ? 84 : 82,
          paddingBottom: Platform.OS === "web" ? 34 : 28,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: "Inter_500Medium",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: isAdmin ? "Mes copros" : "Accueil",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons name={isAdmin ? "business" : "home"} size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="interventions"
        options={{
          title: "Interventions",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons name="construct" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="alerts"
        options={{
          href: isPrestataire ? null : undefined,
          title: "Messages",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons
              name={unacknowledgedCount > 0 ? "notifications" : "notifications-outline"}
              size={size}
              color={color}
            />
          ),
          tabBarBadge: unacknowledgedCount > 0 ? unacknowledgedCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: "#F59E0B",
            color: "#fff",
            fontSize: 10,
            fontFamily: "Inter_700Bold",
            minWidth: 18,
          },
        }}
      />

      <Tabs.Screen
        name="stats"
        options={{
          href: null,
        }}
      />

      <Tabs.Screen
        name="invite-prestataire"
        options={{
          href: null,
        }}
      />

      <Tabs.Screen
        name="admin"
        options={{
          title: isAdmin ? "Gestionnaire" : isOwner ? "Mon accès" : "Mon compte",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons
              name={isAdmin ? "settings" : isOwner ? "home-outline" : "person-circle"}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}