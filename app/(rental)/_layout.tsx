import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { COLORS } from "@/constants/colors";

type TabBarIconProps = { color: string; size: number; focused: boolean };

export default function RentalLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#8B5CF6",
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopWidth: 0,
          elevation: 0,
          height: Platform.OS === "web" ? 84 : 82,
          paddingBottom: Platform.OS === "web" ? 34 : 28,
          paddingTop: 8,
          shadowColor: "#0B1628",
          shadowOpacity: 0.10,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: "Inter_600SemiBold",
          letterSpacing: 0.1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Logements",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="signalements"
        options={{
          title: "Signalements",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons name="alert-circle" size={size} color={color} />
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
        name="professionnels"
        options={{
          title: "Professionnels",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="quittances"
        options={{
          title: "Quittances",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons name="document-text" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="etats-des-lieux"
        options={{
          title: "États des lieux",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons name="clipboard" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
