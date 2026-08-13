import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import {
  PropertyType,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_ICONS,
} from "@/shared/types";

const PROPERTY_TYPES: PropertyType[] = ["apartment", "house", "studio", "room", "other"];

export default function RentalOnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { user, markRentalSetup } = useAuth();

  const [propertyType, setPropertyType] = useState<PropertyType>("apartment");
  const [address, setAddress]           = useState("");
  const [postalCode, setPostalCode]     = useState("");
  const [city, setCity]                 = useState("");
  const [aptNumber, setAptNumber]       = useState("");
  const [surface, setSurface]           = useState("");
  const [rooms, setRooms]               = useState("");
  const [saving, setSaving]             = useState(false);

  const canSubmit = address.trim() && postalCode.trim() && city.trim();

  const handleCreate = async () => {
    if (!canSubmit || !user?.uid) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "properties"), {
        landlordId:   user.uid,
        propertyType,
        address:      address.trim(),
        postalCode:   postalCode.trim(),
        city:         city.trim(),
        ...(aptNumber.trim()   ? { apartmentNumber: aptNumber.trim() }  : {}),
        ...(surface.trim()     ? { surface: parseFloat(surface) || 0 }  : {}),
        ...(rooms.trim()       ? { numberOfRooms: parseInt(rooms) || 0 }: {}),
        status:    "vacant",
        createdAt: new Date().toISOString(),
      });

      // Marque le module Location comme configuré → _layout.tsx route vers (rental)
      await markRentalSetup();
    } catch (e) {
      console.error("[RENTAL] property creation failed:", e);
      Alert.alert("Erreur", "La création du logement a échoué. Vérifiez votre connexion.");
      setSaving(false);
    }
  };

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={styles.root}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.content,
            { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 24, paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* En-tête */}
          <View style={styles.header}>
            <View style={styles.iconBadge}>
              <Ionicons name="home" size={32} color="#8B5CF6" />
            </View>
            <Text style={styles.title}>Configurez votre{"\n"}premier logement</Text>
            <Text style={styles.subtitle}>
              Vous pourrez en ajouter d'autres depuis votre tableau de bord.
            </Text>
          </View>

          {/* Type de bien */}
          <View style={styles.section}>
            <Text style={styles.label}>Type de bien</Text>
            <View style={styles.typeRow}>
              {PROPERTY_TYPES.map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeChip, propertyType === t && styles.typeChipActive]}
                  onPress={() => setPropertyType(t)}
                >
                  <Ionicons
                    name={PROPERTY_TYPE_ICONS[t] as any}
                    size={18}
                    color={propertyType === t ? "#8B5CF6" : "rgba(255,255,255,0.4)"}
                  />
                  <Text style={[styles.typeLabel, propertyType === t && styles.typeLabelActive]}>
                    {PROPERTY_TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Adresse */}
          <View style={styles.section}>
            <Text style={styles.label}>Adresse *</Text>
            <TextInput
              style={styles.input}
              placeholder="12 rue de la Paix"
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={address}
              onChangeText={setAddress}
              autoCorrect={false}
            />
          </View>

          {/* Code postal + Ville */}
          <View style={styles.row}>
            <View style={[styles.section, { flex: 1 }]}>
              <Text style={styles.label}>Code postal *</Text>
              <TextInput
                style={styles.input}
                placeholder="75001"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={postalCode}
                onChangeText={setPostalCode}
                keyboardType="number-pad"
                maxLength={5}
              />
            </View>
            <View style={[styles.section, { flex: 2 }]}>
              <Text style={styles.label}>Ville *</Text>
              <TextInput
                style={styles.input}
                placeholder="Paris"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={city}
                onChangeText={setCity}
                autoCorrect={false}
              />
            </View>
          </View>

          {/* Numéro d'appartement */}
          <View style={styles.section}>
            <Text style={styles.label}>N° d'appartement <Text style={styles.optional}>(optionnel)</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="3A, Bat. B…"
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={aptNumber}
              onChangeText={setAptNumber}
              autoCorrect={false}
            />
          </View>

          {/* Surface + Nb pièces */}
          <View style={styles.row}>
            <View style={[styles.section, { flex: 1 }]}>
              <Text style={styles.label}>Surface (m²) <Text style={styles.optional}>opt.</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="45"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={surface}
                onChangeText={setSurface}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={[styles.section, { flex: 1 }]}>
              <Text style={styles.label}>Nb pièces <Text style={styles.optional}>opt.</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="2"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={rooms}
                onChangeText={setRooms}
                keyboardType="number-pad"
              />
            </View>
          </View>

          {/* Bouton */}
          <Pressable
            style={[styles.btn, (!canSubmit || saving) && styles.btnDisabled]}
            onPress={handleCreate}
            disabled={!canSubmit || saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.btnText}>Créer mon logement</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
            }
          </Pressable>

          <Text style={styles.hint}>
            * Champs obligatoires
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1 },
  content: { paddingHorizontal: 20, gap: 4 },

  header: { alignItems: "center", marginBottom: 24, gap: 12 },
  iconBadge: {
    width: 72, height: 72, borderRadius: 24,
    backgroundColor: "rgba(139,92,246,0.15)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(139,92,246,0.3)",
  },
  title: {
    fontSize: 24, fontFamily: "Inter_700Bold",
    color: "#fff", textAlign: "center", letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.45)", textAlign: "center",
  },

  section: { gap: 8, marginBottom: 12 },
  row:     { flexDirection: "row", gap: 12 },

  label: {
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.7)",
  },
  optional: { fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.35)" },

  input: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#fff",
  },

  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  typeChipActive: {
    backgroundColor: "rgba(139,92,246,0.15)",
    borderColor: "rgba(139,92,246,0.4)",
  },
  typeLabel: {
    fontSize: 13, fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.4)",
  },
  typeLabelActive: { color: "#8B5CF6" },

  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#8B5CF6",
    borderRadius: 14, paddingVertical: 16,
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },

  hint: {
    textAlign: "center", fontSize: 12,
    fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.25)",
    marginTop: 8,
  },
});
