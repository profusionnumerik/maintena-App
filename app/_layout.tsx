import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import {
  Image, Platform, Pressable, StyleSheet, Text,
  useWindowDimensions, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CoProProvider, useCoPro } from "@/context/CoProContext";
import { InterventionsProvider } from "@/context/InterventionsContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

// ─── Types ────────────────────────────────────────────────────────────────────

type NavItem = {
  icon: string;
  label: string;
  route: string;
  segment: string;
};

// ─── Navigation par type d'utilisateur ───────────────────────────────────────

const LANDLORD_NAV: NavItem[] = [
  { icon: "home-outline",       label: "Tableau de bord", route: "/(rental)",                 segment: "(rental)" },
  { icon: "construct-outline",  label: "Interventions",   route: "/(rental)/interventions",   segment: "interventions" },
  { icon: "document-text-outline", label: "Quittances",   route: "/(rental)/quittances",      segment: "quittances" },
  { icon: "clipboard-outline",  label: "États des lieux", route: "/(rental)/etats-des-lieux", segment: "etats-des-lieux" },
  { icon: "people-outline",     label: "Professionnels",  route: "/(rental)/professionnels",  segment: "professionnels" },
];

const SYNDIC_NAV: NavItem[] = [
  { icon: "home-outline",       label: "Tableau de bord", route: "/(app)",                      segment: "(app)" },
  { icon: "construct-outline",  label: "Interventions",   route: "/(app)/interventions",         segment: "interventions" },
  { icon: "cash-outline",       label: "Finances",        route: "/(app)/conseil-finances",      segment: "conseil-finances" },
  { icon: "calendar-outline",   label: "Entretien",       route: "/(app)/entretien",             segment: "entretien" },
  { icon: "people-outline",     label: "Annuaire",        route: "/(app)/annuaire-prestataires", segment: "annuaire-prestataires" },
  { icon: "bar-chart-outline",  label: "Statistiques",    route: "/(app)/stats",                 segment: "stats" },
];

const TENANT_NAV: NavItem[] = [
  { icon: "home-outline",       label: "Accueil",         route: "/(tenant)",                  segment: "(tenant)" },
  { icon: "alert-circle-outline", label: "Signalements",  route: "/(tenant)/interventions",    segment: "interventions" },
  { icon: "document-outline",   label: "Documents",       route: "/(tenant)/documents",        segment: "documents" },
  { icon: "chatbubble-outline", label: "Messagerie",      route: "/(tenant)/messages",         segment: "messages" },
];

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function WebSidebar({ compact }: { compact: boolean }) {
  const { user, userType, isSuperAdmin } = useAuth();
  const router  = useRouter();
  const segments = useSegments();

  if (!user) return null;

  let items: NavItem[] = [];
  if (userType === "landlord") items = LANDLORD_NAV;
  else if (userType === "tenant") items = TENANT_NAV;
  else items = SYNDIC_NAV;

  const activeSegment = (segments as string[])[1] ?? (segments as string[])[0] ?? "";

  return (
    <View style={[sb.root, compact && sb.rootCompact]}>
      {/* Brand */}
      <View style={sb.brand}>
        <Image source={require("../assets/images/icon.png")} style={sb.logo} resizeMode="contain" />
        {!compact && <Text style={sb.brandText}>Maintena</Text>}
      </View>

      {/* Module badge */}
      {!compact && (
        <View style={sb.moduleBadge}>
          <Text style={sb.moduleText}>
            {userType === "landlord" ? "🏠 Gestion locative"
              : userType === "tenant" ? "🔑 Espace locataire"
              : "🏢 Copropriété"}
          </Text>
        </View>
      )}

      {/* Separator */}
      <View style={sb.sep} />

      {/* Nav items */}
      <View style={sb.nav}>
        {items.map((item) => {
          const active = activeSegment === item.segment ||
            (item.segment === "(rental)" && activeSegment === "(rental)") ||
            (item.segment === "(app)" && activeSegment === "(app)") ||
            (item.segment === "(tenant)" && activeSegment === "(tenant)");
          return (
            <Pressable
              key={item.route}
              style={[sb.navItem, compact && sb.navItemCompact, active && sb.navItemActive]}
              onPress={() => router.push(item.route as any)}
            >
              <Ionicons
                name={item.icon as any}
                size={compact ? 22 : 18}
                color={active ? "#8B5CF6" : "rgba(255,255,255,0.55)"}
              />
              {!compact && (
                <Text style={[sb.navLabel, active && sb.navLabelActive]}>{item.label}</Text>
              )}
              {active && <View style={sb.activeBar} />}
            </Pressable>
          );
        })}
      </View>

      {/* Bottom: user info */}
      <View style={sb.bottom}>
        <View style={sb.sep} />
        <View style={[sb.userRow, compact && sb.userRowCompact]}>
          <View style={sb.avatar}>
            <Text style={sb.avatarText}>
              {(user.email ?? "?")[0].toUpperCase()}
            </Text>
          </View>
          {!compact && (
            <View style={{ flex: 1 }}>
              <Text style={sb.userName} numberOfLines={1}>{user.email}</Text>
              <Text style={sb.userRole}>
                {isSuperAdmin ? "Super admin"
                  : userType === "landlord" ? "Bailleur"
                  : userType === "tenant" ? "Locataire"
                  : "Gestionnaire"}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const sb = StyleSheet.create({
  root: {
    width: 220,
    backgroundColor: "#0B1628",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.06)",
    flexDirection: "column",
    paddingBottom: 16,
  },
  rootCompact: { width: 64 },
  brand: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12,
  },
  logo: { width: 32, height: 32, borderRadius: 9 },
  brandText: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.3 },
  moduleBadge: {
    marginHorizontal: 12, marginBottom: 4,
    backgroundColor: "rgba(139,92,246,0.12)",
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(139,92,246,0.2)",
  },
  moduleText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "rgba(167,139,250,0.9)" },
  sep: { height: 1, backgroundColor: "rgba(255,255,255,0.06)", marginVertical: 8, marginHorizontal: 12 },
  nav: { flex: 1, paddingHorizontal: 8, gap: 2 },
  navItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10,
    position: "relative",
  },
  navItemCompact: { justifyContent: "center", paddingHorizontal: 0 },
  navItemActive: { backgroundColor: "rgba(139,92,246,0.13)" },
  navLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.55)", flex: 1 },
  navLabelActive: { color: "#C4B5FD", fontFamily: "Inter_600SemiBold" },
  activeBar: {
    position: "absolute", left: 0, top: 6, bottom: 6,
    width: 3, borderRadius: 2, backgroundColor: "#8B5CF6",
  },
  bottom: { paddingHorizontal: 8 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4, paddingVertical: 8 },
  userRowCompact: { justifyContent: "center" },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(139,92,246,0.25)", alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#C4B5FD" },
  userName: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)", flex: 1 },
  userRole: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.35)" },
});

// ─── Hub Layout (web seulement) ────────────────────────────────────────────

function WebHubLayout({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const { user }  = useAuth();

  const isDesktop = width >= 1024;
  const isTablet  = width >= 768 && width < 1024;
  const isMobile  = width < 768;

  // Mobile → UI normale plein écran (pas de hub)
  if (isMobile) return <View style={{ flex: 1 }}>{children}</View>;

  // Desktop / Tablette : toujours le hub (même pendant le chargement de l'auth)
  const sidebarW    = isTablet ? 64 : 220;
  const contentMaxW = isDesktop ? 560 : 480;

  return (
    <View style={hub.root}>
      {/* Top bar */}
      <View style={hub.topBar}>
        <View style={[hub.topBarLeft, { width: sidebarW }]} />
        <View style={hub.topBarCenter}>
          <Text style={hub.topBarTitle}>Maintena</Text>
          <Text style={hub.topBarSub}>Gestion immobilière</Text>
        </View>
        <View style={hub.topBarRight}>
          <View style={hub.topBarDot} />
          <Text style={hub.topBarStatus}>En ligne</Text>
        </View>
      </View>

      {/* Body */}
      <View style={hub.body}>
        {/* Sidebar — n'apparaît qu'une fois connecté */}
        {user ? <WebSidebar compact={isTablet} /> : <View style={{ width: sidebarW, backgroundColor: "#0B1628" }} />}

        {/* Zone de contenu centrée */}
        <View style={hub.contentZone}>
          <View style={[hub.contentCard, { maxWidth: contentMaxW }]}>
            {children}
          </View>
        </View>
      </View>
    </View>
  );
}

const HUB_TOP = 52;

const hub = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F1E33" },

  topBar: {
    height: HUB_TOP,
    backgroundColor: "#0B1628",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    flexDirection: "row",
    alignItems: "center",
  },
  topBarLeft:   { alignItems: "center", justifyContent: "center" },
  topBarCenter: { flex: 1, alignItems: "center" },
  topBarTitle:  { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.2 },
  topBarSub:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.35)" },
  topBarRight:  { flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 20 },
  topBarDot:    { width: 7, height: 7, borderRadius: 4, backgroundColor: "#22C55E" },
  topBarStatus: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)" },

  body: {
    flex: 1,
    flexDirection: "row",
  },

  contentZone: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#0F1E33",
    paddingVertical: 0,
  },

  contentCard: {
    flex: 1,
    width: "100%",
    backgroundColor: "#F7F8FC",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 40,
    // overflow: "hidden" retiré — il coupait la tab bar et ses labels sur web
  },
});

// ─── Router principal ─────────────────────────────────────────────────────────

function RootLayoutNav() {
  const { user, isLoading: authLoading, isSuperAdmin, userType, hasRentalSetup } = useAuth();
  const { currentCopro, isLoading: coProLoading, isSubscribed } = useCoPro();
  const segments = useSegments();
  const router = useRouter();
  const segmentsSafe = [...segments] as string[];

  const [isMaintenance, setIsMaintenance] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appConfig", "maintenance"), (snap) => {
      setIsMaintenance(snap.exists() && snap.data()?.active === true);
    });
    return unsub;
  }, []);

  useEffect(() => {
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

    if (isMaintenance && !isSuperAdmin) {
      if (!inMaintenance) router.replace("/maintenance");
      return;
    }
    if (!isMaintenance && inMaintenance) {
      router.replace(user ? "/(app)" : "/(auth)");
      return;
    }
    if (!user) {
      if (!inAuth && !inLegal) router.replace("/(auth)");
      return;
    }
    if (isSuperAdmin) {
      if (!inSuperAdmin && !inApp && !inModal && !inLegal) router.replace("/(superadmin)");
      return;
    }
    if (userType === "landlord") {
      if (!hasRentalSetup) {
        if (!inRentalOnboarding) router.replace("/(rental-onboarding)");
      } else {
        if (!inRental && !inRentalOnboarding && !inProperty && !inInventory) router.replace("/(rental)");
      }
      return;
    }
    if (userType === "tenant") {
      const inTenantDocuments = segmentsSafe[0] === "documents";
      if (!inTenant && !inInventory && !inTenantDocuments) router.replace("/(tenant)");
      return;
    }
    if (!currentCopro) {
      if (!inOnboarding) router.replace("/(onboarding)");
      return;
    }
    // Bloquer si l'essai est expiré et pas d'abonnement actif
    // Note : on NE vérifie plus currentCopro.status === "active" car ce champ
    // est toujours "active" à la création — isSubscribed couvre déjà trial + abonnement.
    if (!isSubscribed) {
      if (!inBlocked) router.replace("/(blocked)");
      return;
    }
    if (!inApp && !inModal && !inCreateCopro && !inLegal) {
      router.replace("/(app)");
    }
  }, [
    user, authLoading, coProLoading, currentCopro,
    isSuperAdmin, isSubscribed, isMaintenance, userType, hasRentalSetup, segments, router,
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
      <Stack.Screen name="(rental-onboarding)" />
      <Stack.Screen name="(rental)" />
      <Stack.Screen name="(tenant)" />
      <Stack.Screen name="add" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="intervention/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="property/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/create" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/rooms" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/room/[roomId]" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/meters" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/keys" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/equipment" options={{ headerShown: false }} />
      <Stack.Screen name="inventory/[id]/summary" options={{ headerShown: false }} />
      <Stack.Screen name="rental-upgrade" options={{ headerShown: false }} />
    </Stack>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

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

  if (Platform.OS === "web") {
    return (
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <CoProProvider>
              <InterventionsProvider>
                <WebHubLayout>
                  <RootLayoutNav />
                </WebHubLayout>
              </InterventionsProvider>
            </CoProProvider>
          </AuthProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    );
  }

  return (
    <KeyboardProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoProProvider>
            <InterventionsProvider>
              <RootLayoutNav />
            </InterventionsProvider>
          </CoProProvider>
        </AuthProvider>
      </QueryClientProvider>
    </KeyboardProvider>
  );
}
