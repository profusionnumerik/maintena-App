/**
 * Drawer navigation latéral pour le module Locataire.
 * S'affiche au-dessus de toutes les pages (positionné dans le layout).
 */
import {
  Animated, Pressable, StyleSheet, Text, View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useTenantNav } from "@/context/TenantNavContext";
import { COLORS } from "@/constants/colors";
import { wConfirm } from "@/shared/dialogs";

// ─── Entrées du menu ───────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { route: "/(tenant)",               label: "Accueil",       icon: "home-outline",          segment: "(tenant)" },
  { route: "/(tenant)/interventions", label: "Interventions", icon: "construct-outline",     segment: "interventions" },
  { route: "/(tenant)/messages",      label: "Messagerie",    icon: "chatbubbles-outline",   segment: "messages" },
  { route: "/(tenant)/documents",     label: "Mes documents", icon: "document-text-outline", segment: "documents" },
] as const;

// ─── Composant ─────────────────────────────────────────────────────────────────

export function TenantDrawer() {
  const { isOpen, close } = useTenantNav();
  const { user, logout, deleteAccount, resetUserType } = useAuth();
  const router   = useRouter();
  const pathname = usePathname();
  const insets   = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const DRAWER_WIDTH = Math.min(width * 0.78, 300);

  const translateX      = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.spring(translateX, { toValue: 0, damping: 22, stiffness: 200, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: -DRAWER_WIDTH, duration: 200, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [isOpen, DRAWER_WIDTH]);

  if (!isOpen && (translateX as any)._value === -DRAWER_WIDTH) return null;

  const navigateTo = (route: string) => {
    close();
    router.push(route as any);
  };

  const isActive = (segment: string) => {
    if (segment === "(tenant)") {
      return pathname === "/" || pathname === "/index" || pathname === "/(tenant)" || pathname === "/(tenant)/index";
    }
    return pathname.includes(segment);
  };

  const initials = user?.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "L";
  const displayName = user?.displayName ?? "Locataire";

  const handleDeleteAccount = () => {
    wConfirm(
      "Supprimer mon compte",
      "Cette action est irréversible. Votre compte et toutes vos données seront définitivement supprimés.",
      () => wConfirm(
        "Confirmer la suppression",
        `Supprimer définitivement le compte ${user?.email} ? Impossible d'annuler.`,
        async () => {
          close();
          try { await deleteAccount(); } catch {}
        },
        "Supprimer définitivement",
      ),
      "Continuer",
    );
  };

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents={isOpen ? "auto" : "none"}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={close} />
      </Animated.View>

      {/* Drawer panel */}
      <Animated.View
        style={[
          styles.drawer,
          {
            width: DRAWER_WIDTH,
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 20,
            transform: [{ translateX }],
          },
        ]}
      >
        {/* Profil locataire */}
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.profileRole}>Locataire</Text>
          </View>
          <Pressable onPress={close} hitSlop={12}>
            <Ionicons name="close" size={22} color={COLORS.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.divider} />

        {/* Navigation */}
        <View style={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.segment);
            return (
              <Pressable
                key={item.route}
                style={[styles.navItem, active && styles.navItemActive]}
                onPress={() => navigateTo(item.route)}
              >
                <View style={[styles.navIcon, active && styles.navIconActive]}>
                  <Ionicons
                    name={item.icon as any}
                    size={20}
                    color={active ? COLORS.teal : COLORS.textSecondary}
                  />
                </View>
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                  {item.label}
                </Text>
                {active && <View style={styles.activeDot} />}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        {/* Changer de profil */}
        <Pressable
          style={styles.navItem}
          onPress={() => wConfirm(
            "Changer de profil",
            "Vous allez retourner à l'écran de sélection de profil. Vos données restent intactes.",
            async () => { close(); await resetUserType(); },
            "Changer",
          )}
        >
          <View style={styles.navIcon}>
            <Ionicons name="swap-horizontal-outline" size={20} color={COLORS.textSecondary} />
          </View>
          <Text style={styles.navLabel}>Changer de profil</Text>
        </Pressable>

        {/* Paramètres → profil */}
        <Pressable
          style={styles.navItem}
          onPress={() => { close(); router.push("/profile" as any); }}
        >
          <View style={styles.navIcon}>
            <Ionicons name="settings-outline" size={20} color={COLORS.textSecondary} />
          </View>
          <Text style={styles.navLabel}>Paramètres</Text>
        </Pressable>

        {/* Déconnexion */}
        <Pressable
          style={styles.navItem}
          onPress={() => wConfirm(
            "Se déconnecter",
            "Voulez-vous vraiment vous déconnecter ?",
            () => { close(); logout(); },
            "Se déconnecter",
          )}
        >
          <View style={[styles.navIcon, styles.logoutIcon]}>
            <Ionicons name="log-out-outline" size={20} color="#EF4444" />
          </View>
          <Text style={styles.logoutLabel}>Se déconnecter</Text>
        </Pressable>

        {/* Suppression compte */}
        <Pressable style={styles.deleteBtn} onPress={handleDeleteAccount}>
          <Ionicons name="trash-outline" size={13} color="#9CA3AF" />
          <Text style={styles.deleteText}>Supprimer mon compte</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ─── Bouton hamburger ─────────────────────────────────────────────────────────

export function TenantHamburgerButton({ color = "#fff" }: { color?: string }) {
  const { open } = useTenantNav();
  return (
    <Pressable onPress={open} hitSlop={12} style={styles.hamburger}>
      <Ionicons name="menu" size={26} color={color} />
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.45)" },
  drawer: {
    position: "absolute",
    top: 0, left: 0, bottom: 0,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 6, height: 0 },
    elevation: 12,
  },
  profile: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, gap: 12, marginBottom: 16,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.teal,
    alignItems: "center", justifyContent: "center",
  },
  avatarText:   { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  profileName:  { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text },
  profileRole:  { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  divider:      { height: 1, backgroundColor: COLORS.border, marginVertical: 10, marginHorizontal: 16 },
  nav:          { paddingHorizontal: 10, gap: 2 },
  navItem: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 12, paddingVertical: 12,
    borderRadius: 12,
  },
  navItemActive:    { backgroundColor: `${COLORS.teal}15` },
  navIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center",
  },
  navIconActive:    { backgroundColor: `${COLORS.teal}20` },
  navLabel:         { fontSize: 15, fontFamily: "Inter_500Medium", color: COLORS.text, flex: 1 },
  navLabelActive:   { fontFamily: "Inter_700Bold", color: COLORS.teal },
  activeDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: COLORS.teal,
  },
  hamburger:    { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  logoutIcon:   { backgroundColor: "#FEF2F2" },
  logoutLabel:  { fontSize: 15, fontFamily: "Inter_500Medium", color: "#EF4444", flex: 1 },
  deleteBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, marginHorizontal: 16, marginTop: 2 },
  deleteText:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", textDecorationLine: "underline" },
});
