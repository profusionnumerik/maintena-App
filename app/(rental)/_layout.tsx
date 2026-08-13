import { Stack } from "expo-router";
import { RentalNavProvider } from "@/context/RentalNavContext";
import { RentalDrawer } from "@/components/rental/RentalDrawer";

export default function RentalLayout() {
  return (
    <RentalNavProvider>
      {/* Stack navigation — toutes les pages rental */}
      <Stack screenOptions={{ headerShown: false, animation: "none" }} />

      {/* Drawer superposé au-dessus de toutes les pages */}
      <RentalDrawer />
    </RentalNavProvider>
  );
}
