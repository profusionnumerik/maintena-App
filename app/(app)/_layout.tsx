import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform, View, useWindowDimensions } from "react-native";
import { ReadOnlyNotice } from "@/components/ReadOnlyBanner";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCoPro } from "@/context/CoProContext";
import { useInterventions } from "@/context/InterventionsContext";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import { Entretien, getEntretienStatut } from "@/shared/types";
import * as Notifications from "expo-notifications";

type TabBarIconProps = { color: string; size: number; focused: boolean }

async function triggerLocalNotif(title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null,
    });
  } catch {}
}

export default function AppLayout() {
  const { currentCopro, currentRole, signalements } = useCoPro();
  const { interventions } = useInterventions();
  const { user } = useAuth();
  const { width } = useWindowDimensions();

  // Sur web ≥ 768px la sidebar gère la navigation — on masque la tab bar du bas
  const hideTabBar = Platform.OS === "web" && width >= 768;

  const unacknowledgedCount = useMemo(
    () => signalements.filter((s) => !s.acknowledged).length,
    [signalements]
  );

  const isAdmin = currentRole === "admin" || currentRole === "co-admin";
  const isOwner = currentRole === "propriétaire";

  // Notifications locales lors de nouveaux événements (app ouverte)
  // soundReadyRef : ignore les données initiales Firestore au démarrage
  const soundReadyRef = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { soundReadyRef.current = true; }, 3500);
    return () => clearTimeout(t);
  }, []);

  const prevUnackRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevUnackRef.current === null) { prevUnackRef.current = unacknowledgedCount; return; }
    if (soundReadyRef.current && unacknowledgedCount > prevUnackRef.current) {
      const nb = unacknowledgedCount - prevUnackRef.current;
      triggerLocalNotif("📋 Nouveau signalement", `${nb} nouveau${nb > 1 ? "x" : ""} signalement${nb > 1 ? "s" : ""} à traiter`);
    }
    prevUnackRef.current = unacknowledgedCount;
  }, [unacknowledgedCount]);

  const [newInterventionCount, setNewInterventionCount] = useState(0);

  const prevInterventionIdsRef = useRef<Set<string> | null>(null);
  const prevInterventionStatusRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const ids = new Set(interventions.map((i) => i.id));
    const statusMap = new Map(interventions.map((i) => [i.id, i.status]));

    if (prevInterventionIdsRef.current === null) {
      prevInterventionIdsRef.current = ids;
      prevInterventionStatusRef.current = statusMap;
      return;
    }

    if (soundReadyRef.current) {
      // Nouvelles interventions créées par quelqu'un d'autre
      const newOnes = interventions.filter((i) => !prevInterventionIdsRef.current!.has(i.id) && i.createdBy !== user?.uid);
      if (newOnes.length > 0) {
        setNewInterventionCount((c) => c + newOnes.length);
        triggerLocalNotif("🔧 Nouvelle intervention", newOnes[0].title ?? "Une intervention a été ajoutée");
      }

      // Changements de statut — notifier l'admin quelle que soit l'origine (c'est le prestataire qui met à jour)
      if (isAdmin && prevInterventionStatusRef.current) {
        const STATUS_LABELS: Record<string, string> = {
          "planifié": "Planifiée",
          "en-cours": "En cours",
          "en cours": "En cours",
          "terminé": "Terminée",
          "termine": "Terminée",
          "planifie": "Planifiée",
        };
        for (const iv of interventions) {
          const prevStatus = prevInterventionStatusRef.current.get(iv.id);
          if (prevStatus && prevStatus !== iv.status) {
            triggerLocalNotif(
              "🔧 Intervention mise à jour",
              `${iv.assignedToName ?? "Prestataire"} · ${iv.title} → ${STATUS_LABELS[iv.status] ?? iv.status}`
            );
            break;
          }
        }
      }
    }

    prevInterventionIdsRef.current = ids;
    prevInterventionStatusRef.current = statusMap;
  }, [interventions]);

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
    <View style={{ flex: 1 }}>
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
        listeners={{
          tabPress: () => setNewInterventionCount(0),
        }}
        options={{
          title: "Interventions",
          tabBarIcon: ({ color, size }: TabBarIconProps) => (
            <Ionicons name="construct" size={size} color={color} />
          ),
          tabBarBadge: newInterventionCount > 0 ? newInterventionCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: COLORS.primary,
            color: "#fff",
            fontSize: 10,
            fontFamily: "Inter_700Bold",
            minWidth: 18,
          },
        }}
      />

      <Tabs.Screen
        name="alerts"
        options={{
          href: undefined,
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
      {/* Essai terminé : rappel permanent, juste au-dessus de la barre d'onglets */}
      <ReadOnlyNotice
        compact
        style={{ position: "absolute", left: 12, right: 12, bottom: hideTabBar ? 12 : 92 }}
      />
    </View>
  );
}