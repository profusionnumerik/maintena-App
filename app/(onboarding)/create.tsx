import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useCoPro } from "@/context/CoProContext";
import { CoPro } from "@/shared/types";

export default function CreateCoPro() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { createCoPro } = useCoPro();

  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CoPro | null>(null);
  const [geocodeStatus, setGeocodeStatus] = useState<"idle" | "found" | "not-found">("idle");

  const streetRef = useRef<TextInput>(null);
  const postalRef = useRef<TextInput>(null);
  const cityRef = useRef<TextInput>(null);

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const geocodeAddress = async (fullAddr: string): Promise<{ lat: number; lng: number } | null> => {
    if (!fullAddr.trim()) return null;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(fullAddr)}`;
      const res = await fetch(url, { headers: { "User-Agent": "Maintena-App/1.0" } });
      const data = await res.json();
      if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      return null;
    } catch {
      return null;
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) { setError("Le nom est requis."); return; }
    setError(null);
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      const fullAddress = [street.trim(), [postalCode.trim(), city.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      if (fullAddress) {
        const query = postalCode.trim() && city.trim()
          ? `${street.trim() ? street.trim() + ", " : ""}${postalCode.trim()} ${city.trim()}, France`
          : fullAddress;
        const coords = await geocodeAddress(query);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
          setGeocodeStatus("found");
        } else {
          setGeocodeStatus("not-found");
        }
      }
      const copro = await createCoPro(name, street, postalCode, city, lat, lng);
      setCreated(copro);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e.message ?? "Erreur lors de la création.");
    } finally {
      setLoading(false);
    }
  };

  const shareCode = async () => {
    if (!created) return;
    await Share.share({
      message: `Rejoins notre copropriété "${created.name}" sur Maintena.\nCode d'invitation : ${created.inviteCode}`,
    });
  };

  const copyCode = async () => {
    if (!created) return;
    await Clipboard.setStringAsync(created.inviteCode);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  if (created) {
    const isActive = created.status === "active";
    return (
      <View style={[styles.root, { paddingTop: top, paddingBottom: bottom }]}>
        <View style={styles.successInner}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color={COLORS.success} />
          </View>
          <Text style={styles.successTitle}>Copropriété ajoutée !</Text>
          <Text style={styles.successSub}>
            {isActive
              ? "Votre copropriété est active. Partagez les codes d'invitation à vos Résidents."
              : "Partagez ce code d'invitation à vos Résidents."}
          </Text>

          {created.latitude && created.longitude ? (
            <View style={styles.geoSuccessBox}>
              <Ionicons name="location" size={16} color={COLORS.success} />
              <Text style={styles.geoSuccessText}>
                Position GPS détectée — vérification sur site active
              </Text>
            </View>
          ) : null}

          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>Code prestataire</Text>
            <Text style={styles.codeValue}>{created.inviteCode}</Text>
            <View style={styles.codeActions}>
              <Pressable style={styles.codeBtn} onPress={copyCode}>
                <Ionicons name="copy-outline" size={16} color={COLORS.primary} />
                <Text style={styles.codeBtnText}>Copier</Text>
              </Pressable>
              <Pressable style={[styles.codeBtn, styles.codeBtnPrimary]} onPress={shareCode}>
                <Ionicons name="share-outline" size={16} color="#fff" />
                <Text style={[styles.codeBtnText, { color: "#fff" }]}>Partager</Text>
              </Pressable>
            </View>
          </View>

          {!isActive && (
            <View style={styles.pendingBox}>
              <Ionicons name="time-outline" size={18} color={COLORS.warning} />
              <Text style={styles.pendingText}>
                Votre copropriété est en attente d'activation par votre syndic.
              </Text>
            </View>
          )}

          <Pressable
            style={styles.continueBtn}
            onPress={() => isActive ? router.replace("/(app)") : router.replace("/(blocked)")}
          >
            <Text style={styles.continueBtnText}>
              {isActive ? "Voir mes copropriétés" : "Continuer"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: top + 16, paddingBottom: bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </Pressable>

          <Text style={styles.pageTitle}>Ajouter une copropriété</Text>
          <Text style={styles.pageSubtitle}>
            Renseignez les informations de votre immeuble
          </Text>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Nom de la copropriété *</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="business-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Résidence Les Pins"
                  placeholderTextColor={COLORS.textMuted}
                  value={name}
                  onChangeText={setName}
                  returnKeyType="next"
                  autoCapitalize="words"
                  onSubmitEditing={() => streetRef.current?.focus()}
                />
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Ionicons name="location-outline" size={15} color={COLORS.textMuted} />
              <Text style={styles.sectionLabel}>Adresse du bâtiment (optionnel)</Text>
            </View>
            <Text style={styles.sectionHint}>
              Utilisée pour la vérification automatique de présence des prestataires
            </Text>

            <View style={styles.field}>
              <Text style={styles.label}>Rue / Voie</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="navigate-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
                <TextInput
                  ref={streetRef}
                  style={styles.input}
                  placeholder="Ex: 12 rue de la Paix"
                  placeholderTextColor={COLORS.textMuted}
                  value={street}
                  onChangeText={(t) => { setStreet(t); setGeocodeStatus("idle"); }}
                  returnKeyType="next"
                  autoCapitalize="words"
                  onSubmitEditing={() => postalRef.current?.focus()}
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.field, { flex: 0.42 }]}>
                <Text style={styles.label}>Code postal</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    ref={postalRef}
                    style={styles.input}
                    placeholder="75001"
                    placeholderTextColor={COLORS.textMuted}
                    value={postalCode}
                    onChangeText={(t) => { setPostalCode(t); setGeocodeStatus("idle"); }}
                    keyboardType="number-pad"
                    maxLength={5}
                    returnKeyType="next"
                    onSubmitEditing={() => cityRef.current?.focus()}
                  />
                </View>
              </View>

              <View style={[styles.field, { flex: 0.55 }]}>
                <Text style={styles.label}>Ville</Text>
                <View style={[
                  styles.inputWrap,
                  geocodeStatus === "found" && { borderColor: COLORS.success },
                  geocodeStatus === "not-found" && { borderColor: COLORS.warning },
                ]}>
                  <TextInput
                    ref={cityRef}
                    style={styles.input}
                    placeholder="Paris"
                    placeholderTextColor={COLORS.textMuted}
                    value={city}
                    onChangeText={(t) => { setCity(t); setGeocodeStatus("idle"); }}
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={handleCreate}
                  />
                  {geocodeStatus === "found" && (
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                  )}
                  {geocodeStatus === "not-found" && (
                    <Ionicons name="alert-circle-outline" size={16} color={COLORS.warning} />
                  )}
                </View>
              </View>
            </View>

            {geocodeStatus === "found" && (
              <View style={styles.geoHintBox}>
                <Ionicons name="location" size={14} color={COLORS.success} />
                <Text style={[styles.geoHint, { color: COLORS.success }]}>
                  Position GPS détectée — vérification sur site activée automatiquement (rayon 300m)
                </Text>
              </View>
            )}
            {geocodeStatus === "not-found" && (
              <View style={styles.geoHintBox}>
                <Ionicons name="warning-outline" size={14} color={COLORS.warning} />
                <Text style={[styles.geoHint, { color: COLORS.warning }]}>
                  Adresse non localisée — à définir manuellement depuis l'onglet Gestion
                </Text>
              </View>
            )}

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={COLORS.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.85 }]}
              onPress={handleCreate}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.submitBtnText}>Ajouter la copropriété</Text>
              }
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  scroll: { paddingHorizontal: 20, gap: 8 },
  back: { width: 36, height: 36, justifyContent: "center", marginBottom: 16 },
  pageTitle: { fontSize: 26, fontFamily: "Inter_700Bold", color: COLORS.text, letterSpacing: -0.5 },
  pageSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, marginBottom: 16, marginTop: 4 },
  form: { gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  sectionHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: -6, lineHeight: 16 },
  field: { gap: 5 },
  row: { flexDirection: "row", gap: 10 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 12, height: 48,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: COLORS.text },
  geoHintBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: -4 },
  geoHint: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#FECACA",
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.danger },
  submitBtn: {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 52,
    alignItems: "center", justifyContent: "center", marginTop: 8,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  submitBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  successInner: { flex: 1, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", gap: 16 },
  successIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 26, fontFamily: "Inter_700Bold", color: COLORS.text, letterSpacing: -0.5 },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center" },
  geoSuccessBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#ECFDF5", borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: "#A7F3D0", width: "100%",
  },
  geoSuccessText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#065F46" },
  codeBox: {
    width: "100%", backgroundColor: COLORS.surface, borderRadius: 18,
    padding: 20, alignItems: "center", gap: 8,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  codeLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1 },
  codeValue: { fontSize: 36, fontFamily: "Inter_700Bold", color: COLORS.primary, letterSpacing: 6 },
  codeActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  codeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#EFF6FF", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  codeBtnPrimary: { backgroundColor: COLORS.primary },
  codeBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  pendingBox: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
    backgroundColor: "#FFFBEB", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#FDE68A", width: "100%",
  },
  pendingText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 },
  continueBtn: {
    width: "100%", backgroundColor: COLORS.primary, borderRadius: 14, height: 52,
    alignItems: "center", justifyContent: "center",
  },
  continueBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
