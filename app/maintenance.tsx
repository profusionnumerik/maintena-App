import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

type MaintenanceData = {
  active: boolean;
  message?: string;
  estimatedEnd?: string;
};

export default function MaintenanceScreen() {
  const [data, setData] = useState<MaintenanceData | null>(null);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "appConfig", "maintenance"), (snap) => {
      if (snap.exists()) setData(snap.data() as MaintenanceData);
    });
    return unsub;
  }, []);

  useEffect(() => {
    // Rotation lente de l'icône
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 6000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Pulsation douce du fond
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const message =
    data?.message ||
    "L'application est temporairement indisponible pour une mise à jour.\nMerci de votre patience.";

  return (
    <View style={styles.root}>
      {/* Fond décoratif */}
      <View style={styles.bgCircle1} />
      <View style={styles.bgCircle2} />

      <View style={styles.card}>
        {/* Icône animée */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <View style={styles.iconWrap}>
              <Ionicons name="settings" size={44} color={COLORS.primary} />
            </View>
          </Animated.View>
        </Animated.View>

        {/* Badge statut */}
        <View style={styles.statusBadge}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>En cours de maintenance</Text>
        </View>

        <Text style={styles.title}>Application indisponible</Text>

        <Text style={styles.message}>{message}</Text>

        {/* Heure de retour estimée */}
        {!!data?.estimatedEnd && (
          <View style={styles.etaRow}>
            <Ionicons name="time-outline" size={15} color="#92400E" />
            <Text style={styles.eta}>Reprise prévue : {data.estimatedEnd}</Text>
          </View>
        )}

        <View style={styles.divider} />

        {/* Contact */}
        <View style={styles.contactRow}>
          <Ionicons name="mail-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.contact}>contact@profusionnumerik.com</Text>
        </View>
      </View>

      {/* Footer */}
      <Text style={styles.footer}>Maintena · Profusion Numérik</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    overflow: "hidden",
  },

  // Cercles décoratifs de fond
  bgCircle1: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "#EFF6FF",
    top: -60,
    right: -80,
    opacity: 0.7,
  },
  bgCircle2: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#F0FDF4",
    bottom: 40,
    left: -60,
    opacity: 0.6,
  },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 32,
    alignItems: "center",
    gap: 16,
    width: "100%",
    maxWidth: Platform.OS === "web" ? 440 : 380,
    shadowColor: "#0B1628",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },

  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#BFDBFE",
  },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEF2F2",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
  },
  statusText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.danger,
  },

  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
    textAlign: "center",
  },

  message: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    textAlign: "center",
  },

  etaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#FFFBEB",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FDE68A",
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  eta: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#92400E",
  },

  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    alignSelf: "stretch",
  },

  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  contact: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },

  footer: {
    marginTop: 28,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },
});
