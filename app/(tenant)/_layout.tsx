import { Stack } from "expo-router";
import { TenantNavProvider } from "@/context/TenantNavContext";
import { TenantDrawer } from "@/components/tenant/TenantDrawer";

export default function TenantLayout() {
  return (
    <TenantNavProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <TenantDrawer />
    </TenantNavProvider>
  );
}
