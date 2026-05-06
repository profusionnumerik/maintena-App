import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CoProProvider, useCoPro } from "@/context/CoProContext";
import { InterventionsProvider } from "@/context/InterventionsContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function WebNavbar() {
  if (Platform.OS !== "web") return null;
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
      <View style={webNav.pill}>
        <View style={webNav.pillDot} />
        <Text style={webNav.pillText}>En ligne</Text>
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
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16,185,129,0.12)",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.25)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#10b981" },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6ee7b7" },
});

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

function RootLayoutNav() {
  const { user, isLoading: authLoading, isSuperAdmin } = useAuth();
  const { currentCopro, isLoading: coProLoading, isSubscribed } = useCoPro();
  const segments = useSegments();
  const router = useRouter();
  const segmentsSafe = [...segments] as string[];

  useEffect(() => {
    if (authLoading || coProLoading) return;

    const inAuth = segmentsSafe[0] === "(auth)";
    const inOnboarding = segmentsSafe[0] === "(onboarding)";
    const inBlocked = segmentsSafe[0] === "(blocked)";
    const inApp = segmentsSafe[0] === "(app)";
    const inSuperAdmin = segmentsSafe[0] === "(superadmin)";
    const inLegal = segmentsSafe[0] === "(legal)";
    const inModal = segmentsSafe[0] === "add" || segmentsSafe[0] === "intervention";
    const secondSegment = segmentsSafe[1];
    const inCreateCopro = inOnboarding && secondSegment === "create";

    if (!user) {
      if (!inAuth && !inLegal) router.replace("/(auth)");
      return;
    }

    if (isSuperAdmin) {
      if (!inSuperAdmin && !inApp && !inModal && !inLegal) {
        router.replace("/(superadmin)");
      }
      return;
    }

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
      <Stack.Screen name="add" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="intervention/[id]" options={{ headerShown: false }} />
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
  );
}