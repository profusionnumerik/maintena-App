import { useEffect, useMemo, useState } from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform, useWindowDimensions } from "react-native";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCoPro } from "@/context/CoProContext";
import { COLORS } from "@/constants/colors";
import { Entretien, getEntretienStatut } from "@/shared/types";

type TabBarIconProps = { color: string; size: number; focused: boolean }

export default function AppLayout() {
  const { currentCopro, currentRole, signalements } = useCoPro();
  const { width } = useWindowDimensions();

  // Sur web ≥ 768px la sidebar gère la navigation — on masque la tab bar du bas
  const hideTabBar = Platform.OS === "web" && width >= 768;

  const unacknowledgedCount = useMemo(
    () => signalements.filter((s) => !s.acknowledged).length,
    [signalements]
  );

  const isAdmin = currentRole === "admin" || currentRole === "co-admin";
  const isOwner = currentRole === "propriétaire";

  const [entretienAlertCount, setEntretienAlertCount] = useState(0);
  useEffect(() => {
    if (!currentCopro?.id || (!isAdmin && currentRole !== "conseil")) { setEntretienAlertCount(0); return; }
    const q = query(collection(db, "copros", currentCopro.id, "entretiens"), orderBy("nextVisitDate", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const count = snap.docs.filter((d) => getEntretienStatut({ nextVisitDate: d.data().nextVisitDate } as Entretien) === "retard").length;
      setEntretienAlertCount(count);
    }, () => setEntretienAlertCount(0));
    return unsub;
  }, [currentCopro?.id, currentRole]);
  const isPrestataire = currentRole === "prestataire";
  const isConseil = currentRole === "conseil";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: hideTabBar
          ? { display: "none" }
          : {
              backgroundColor: "#fff",
              borderTopWidth: 0,
              elevation: 0,
              height: 82,
              paddingBottom: 28,
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
        options={{ href: null }}
      />

      <Tabs.Screen
        name="conseil-finances"
        options={{ href: null }}
      />

      <Tabs.Screen
        name="invite-prestataire"
        options={{ href: null }}
      />

      <Tabs.Screen
        name="annuaire-prestataires"
        options={{ href: null }}
      />

      <Tabs.Screen
        name="demandes-devis"
        options={{ href: null }}
      />

      <Tabs.Screen
        name="entretien"
        options={{ href: null }}
      />

      <Tabs.Screen
        name="documents"
        options={{ href: null }}
      />

      <Tabs.Screen
        name="calendrier"
        options={{ href: null }}
      />

      <Tabs.Screen
        name="tantiemes"
        options={{ href: null }}
      />

      <Tabs.Screen
        name="admin"
        options={{
          title: "Menu",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons name="menu" size={size} color={color} />
          ),
          tabBarBadge: entretienAlertCount > 0 ? entretienAlertCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: "#EF4444",
            color: "#fff",
            fontSize: 10,
            fontFamily: "Inter_700Bold",
            minWidth: 18,
          },
        }}
      />
    </Tabs>
  );
}