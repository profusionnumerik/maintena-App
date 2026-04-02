import React from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

const SUPPORT_EMAIL = "contact@profusionnumerik.com";
const COMPANY_NAME = "Profusion Numérik";
const WEBSITE_URL = "https://maintena.profusionnumerik.com";

export default function ContactScreen() {
  const handleEmail = async () => {
    const subject = encodeURIComponent("Support Maintena");
    const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  };

  const handleWebsite = async () => {
    const supported = await Linking.canOpenURL(WEBSITE_URL);
    if (supported) {
      await Linking.openURL(WEBSITE_URL);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Contact</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Maintena</Text>
          <Text style={styles.subtitle}>
            Application exploitée par {COMPANY_NAME}
          </Text>

          <View style={styles.infoBlock}>
            <Text style={styles.label}>Éditeur</Text>
            <Text style={styles.value}>{COMPANY_NAME}</Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.label}>Email support</Text>
            <Text style={styles.value}>{SUPPORT_EMAIL}</Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.label}>Horaires</Text>
            <Text style={styles.value}>Du lundi au vendredi, 9h à 18h</Text>
          </View>

          <Text style={styles.paragraph}>
            Pour toute question liée à votre compte, à une intervention ou à l’utilisation
            de l’application, contactez-nous par email.
          </Text>

          <Pressable style={styles.primaryBtn} onPress={handleEmail}>
            <Ionicons name="mail-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Nous écrire</Text>
          </Pressable>

          <Pressable style={styles.secondaryBtn} onPress={handleWebsite}>
            <Ionicons name="globe-outline" size={18} color={COLORS.primary} />
            <Text style={styles.secondaryBtnText}>Ouvrir le site</Text>
          </Pressable>

          {Platform.OS === "web" && (
            <Text style={styles.footerNote}>
              Site : {WEBSITE_URL}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: {
    width: 38,
    height: 38,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },
  content: {
    padding: 16,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    gap: 14,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },
  infoBlock: {
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
  },
  primaryBtn: {
    marginTop: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#fff",
  },
  secondaryBtnText: {
    color: COLORS.primary,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  footerNote: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },
});