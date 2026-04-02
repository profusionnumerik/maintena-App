import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CoProProvider, useCoPro } from "@/context/CoProContext";
import { InterventionsProvider } from "@/context/InterventionsContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
      if (!inAuth) router.replace("/(auth)");
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
            <RootLayoutNav />
          </InterventionsProvider>
        </CoProProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}