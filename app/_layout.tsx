import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CoProProvider, useCoPro } from "@/context/CoProContext";
import { InterventionsProvider } from "@/context/InterventionsContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function WebNavbar() {
  if (Platform.OS !== "web") return null;
  const { user } = useAuth();
  if (!user) return null;
  return (
    <View style={webNav.bar}>
      <View style={webNav.left}>
        <Image
          source={require("../assets/images/icon.png")}
          style={webNav.logo}
          resizeMode="contain"
        />
        <Text style={webNav.brand}>Maintena</Text>
      </View>
    </View>
  );
}

const webNav = StyleSheet.create({
  bar: {
    position: "fixed" as any,
    top: 0,
    left: 0,
    right: 0,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    backgroundColor: "rgba(11,22,40,0.96)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
    zIndex: 1000,
    backdropFilter: "blur(12px)" as any,
  },
  left: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 30, height: 30, borderRadius: 8 },
  brand: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    letterSpacing: -0.3,
  },
});

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

function RootLayoutNav() {
  const { user, isLoading: authLoading, isSuperAdmin, userType, hasRentalSetup } = useAuth();
  const { currentCopro, isLoading: coProLoading, isSubscribed } = useCoPro();
  const segments = useSegments();
  const router = useRouter();
  const segmentsSafe = [...segments] as string[];

  // ── Maintenance mode ────────────────────────────────────────────────────
  const [isMaintenance, setIsMaintenance] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appConfig", "maintenance"), (snap) => {
      setIsMaintenance(snap.exists() && snap.data()?.active === true);
    });
    return unsub;
  }, []);
  // ────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // authLoading inclut désormais le chargement userType depuis Firestore
    if (authLoading || coProLoading) return;

    const inAuth             = segmentsSafe[0] === "(auth)";
    const inOnboarding       = segmentsSafe[0] === "(onboarding)";
    const inBlocked          = segmentsSafe[0] === "(blocked)";
    const inApp              = segmentsSafe[0] === "(app)";
    const inSuperAdmin       = segmentsSafe[0] === "(superadmin)";
    const inLegal            = segmentsSafe[0] === "(legal)";
    const inMaintenance      = segmentsSafe[0] === "maintenance";
    const inModal            = segmentsSafe[0] === "add" || segmentsSafe[0] === "intervention";
    const inRentalOnboarding = segmentsSafe[0] === "(rental-onboarding)";
    const inRental           = segmentsSafe[0] === "(rental)";
    const inTenant           = segmentsSafe[0] === "(tenant)";
    const inProperty         = segmentsSafe[0] === "property";
    const inInventory        = segmentsSafe[0] === "inventory";
    const secondSegment      = segmentsSafe[1];
    const inCreateCopro      = inOnboarding && secondSegment === "create";

    // Maintenance : redirige tout le monde sauf le superadmin
    if (isMaintenance && !isSuperAdmin) {
      if (!inMaintenance) router.replace("/maintenance");
      return;
    }
    // Si la maintenance est levée et qu'on est sur l'écran maintenance → sortir
    if (!isMaintenance && inMaintenance) {
      router.replace(user ? "/(app)" : "/(auth)");
      return;
    }

    // Non authentifié
    if (!user) {
      if (!inAuth && !inLegal) router.replace("/(auth)");
      return;
    }

    // Super admin
    if (isSuperAdmin) {
      if (!inSuperAdmin && !inApp && !inModal && !inLegal) {
        router.replace("/(superadmin)");
      }
      return;
    }

    // ── MODULE LOCATION — Bailleur ─────────────────────────────────────────
    if (userType === "landlord") {
      if (!hasRentalSetup) {
        // Premier lancement : créer son premier logement
        if (!inRentalOnboarding) router.replace("/(rental-onboarding)");
      } else {
        // Dashboard bailleur (+ détail logement + état des lieux)
        if (!inRental && !inRentalOnboarding && !inProperty && !inInventory) router.replace("/(rental)");
      }
      return;
    }

    // ── MODULE LOCATION — Locataire ────────────────────────────────────────
    if (userType === "tenant") {
      // Autorise les routes inventory (états des lieux) et documents locataire
      const inTenantDocuments = segmentsSafe[0] === "documents";
      if (!inTenant && !inInventory && !inTenantDocuments) router.replace("/(tenant)");
      return;
    }

    // ── MODULE COPROPRIÉTÉ — flux existant (copro / undefined / both) ──────
    if (!currentCopro) {
      if (!inOnboarding) router.replace("/(onboarding)");
      return;
    }

    const coProActive = currentCopro.status === "active";
    if (!isSubscribed && !coProActive) {
      if (!inBlocked) router.replace("/(blocked)");
      return;
    }

    if (!inApp && !inModal && !inCreateCopro && !inLegal) {
      router.replace("/(app)");
    }
  }, [
    user,
    authLoading,
    coProLoading,
    currentCopro,
    isSuperAdmin,
    isSubscribed,
    isMaintenance,
    userType,
    hasRentalSetup,
    segments,
    router,
  ]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(onboarding)" />
      <Stack.Screen name="(blocked)" />
      <Stack.Screen name="(app)" />
      <Stack.Screen name="(superadmin)" />
      <Stack.Screen name="(legal)" />
      <Stack.Screen name="maintenance" />
      {/* ── Module Location ── */}
      <Stack.Screen name="(rental-onboarding)" />
      <Stack.Screen name="(rental)" />
      <Stack.Screen name="(tenant)" />
      {/* ── Modals partagés ── */}
      <Stack.Screen name="add" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="intervention/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="property/[id]" options={{ headerShown: false }} />
      {/* ── Module État des lieux ── */}
      <Stack.Screen name="inventory/create" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/rooms" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/room/[roomId]" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/meters" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/keys" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/equipment" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/summary" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <KeyboardProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoProProvider>
            <InterventionsProvider>
              <WebNavbar />
              <RootLayoutNav />
            </InterventionsProvider>
          </CoProProvider>
        </AuthProvider>
      </QueryClientProvider>
    </KeyboardProvider>
  );
}
