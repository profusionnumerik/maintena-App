import { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { HamburgerButton } from "@/components/rental/RentalDrawer";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { addDoc, collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import {
  RentalProperty,
  PropertyType,
  PropertyStatus,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_ICONS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_STATUS_COLORS,
} from "@/shared/types";

const PROPERTY_TYPES: PropertyType[] = ["apartment", "house", "studio", "room", "other"];

// ─── Formulaire ajout logement (réutilisé dans le modal) ──────────────────────

function PropertyForm({
  onSave,
  onCancel,
}: {
  onSave: (data: Omit<RentalProperty, "id">) => Promise<void>;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const [propertyType, setPropertyType] = useState<PropertyType>("apartment");
  const [address, setAddress]           = useState("");
  const [postalCode, setPostalCode]     = useState("");
  const [city, setCity]                 = useState("");
  const [aptNumber, setAptNumber]       = useState("");
  const [surface, setSurface]           = useState("");
  const [rooms, setRooms]               = useState("");
  const [saving, setSaving]             = useState(false);

  const canSubmit = address.trim() && postalCode.trim() && city.trim();

  const handleSave = async () => {
    if (!canSubmit || !user?.uid) return;
    setSaving(true);
    try {
      await onSave({
        landlordId:  user.uid,
        propertyType,
        address:     address.trim(),
        postalCode:  postalCode.trim(),
        city:        city.trim(),
        ...(aptNumber.trim() ? { apartmentNumber: aptNumber.trim() } : {}),
        ...(surface.trim()   ? { surface: parseFloat(surface) || 0 } : {}),
        ...(rooms.trim()     ? { numberOfRooms: parseInt(rooms) || 0 } : {}),
        status:    "vacant" as PropertyStatus,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={formStyles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Type de bien */}
      <Text style={formStyles.sectionTitle}>Type de bien</Text>
      <View style={formStyles.typeRow}>
        {PROPERTY_TYPES.map((t) => (
          <Pressable
            key={t}
            style={[formStyles.typeChip, propertyType === t && formStyles.typeChipActive]}
            onPress={() => setPropertyType(t)}
          >
            <Ionicons
              name={PROPERTY_TYPE_ICONS[t] as any}
              size={16}
              color={propertyType === t ? "#8B5CF6" : COLORS.textMuted}
            />
            <Text style={[formStyles.typeLabel, propertyType === t && formStyles.typeLabelActive]}>
              {PROPERTY_TYPE_LABELS[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Adresse */}
      <Text style={formStyles.label}>Adresse *</Text>
      <TextInput
        style={formStyles.input}
        placeholder="12 rue de la Paix"
        placeholderTextColor={COLORS.textMuted}
        value={address}
        onChangeText={setAddress}
        autoCorrect={false}
      />

      {/* Code postal + Ville */}
      <View style={formStyles.row}>
        <View style={{ flex: 1 }}>
          <Text style={formStyles.label}>Code postal *</Text>
          <TextInput
            style={formStyles.input}
            placeholder="75001"
            placeholderTextColor={COLORS.textMuted}
            value={postalCode}
            onChangeText={setPostalCode}
            keyboardType="number-pad"
            maxLength={5}
          />
        </View>
        <View style={{ flex: 2 }}>
          <Text style={formStyles.label}>Ville *</Text>
          <TextInput
            style={formStyles.input}
            placeholder="Paris"
            placeholderTextColor={COLORS.textMuted}
            value={city}
            onChangeText={setCity}
            autoCorrect={false}
          />
        </View>
      </View>

      {/* Numéro d'appartement */}
      <Text style={formStyles.label}>N° d'appartement <Text style={formStyles.optional}>(opt.)</Text></Text>
      <TextInput
        style={formStyles.input}
        placeholder="3A"
        placeholderTextColor={COLORS.textMuted}
        value={aptNumber}
        onChangeText={setAptNumber}
        autoCorrect={false}
      />

      {/* Surface + Nb pièces */}
      <View style={formStyles.row}>
        <View style={{ flex: 1 }}>
          <Text style={formStyles.label}>Surface m² <Text style={formStyles.optional}>(opt.)</Text></Text>
          <TextInput
            style={formStyles.input}
            placeholder="45"
            placeholderTextColor={COLORS.textMuted}
            value={surface}
            onChangeText={setSurface}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={formStyles.label}>Nb pièces <Text style={formStyles.optional}>(opt.)</Text></Text>
          <TextInput
            style={formStyles.input}
            placeholder="2"
            placeholderTextColor={COLORS.textMuted}
            value={rooms}
            onChangeText={setRooms}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {/* Actions */}
      <View style={formStyles.actions}>
        <Pressable style={formStyles.cancelBtn} onPress={onCancel}>
          <Text style={formStyles.cancelText}>Annuler</Text>
        </Pressable>
        <Pressable
          style={[formStyles.saveBtn, (!canSubmit || saving) && formStyles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSubmit || saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={formStyles.saveText}>Ajouter</Text>
          }
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ─── Carte logement ───────────────────────────────────────────────────────────

function PropertyCard({ property }: { property: RentalProperty }) {
  const router      = useRouter();
  const statusColor = PROPERTY_STATUS_COLORS[property.status];
  const typeIcon    = PROPERTY_TYPE_ICONS[property.propertyType] as any;

  return (
    <Pressable
      style={({ pressed }) => [cardStyles.card, pressed && cardStyles.cardPressed]}
      onPress={() => router.push(`/property/${property.id}`)}
    >
      <View style={cardStyles.left}>
        <View style={cardStyles.iconBox}>
          <Ionicons name={typeIcon} size={22} color="#8B5CF6" />
        </View>
        <View style={cardStyles.info}>
          <Text style={cardStyles.address} numberOfLines={1}>
            {property.address}
            {property.apartmentNumber ? ` — Apt. ${property.apartmentNumber}` : ""}
          </Text>
          <Text style={cardStyles.city}>{property.postalCode} {property.city}</Text>
          <View style={cardStyles.meta}>
            {property.numberOfRooms ? (
              <Text style={cardStyles.metaText}>
                {property.numberOfRooms} pièce{property.numberOfRooms > 1 ? "s" : ""}
              </Text>
            ) : null}
            {property.surface ? (
              <Text style={cardStyles.metaText}>{property.surface} m²</Text>
            ) : null}
          </View>
        </View>
      </View>
      <View style={[cardStyles.badge, { backgroundColor: `${statusColor}18` }]}>
        <View style={[cardStyles.badgeDot, { backgroundColor: statusColor }]} />
        <Text style={[cardStyles.badgeText, { color: statusColor }]}>
          {PROPERTY_STATUS_LABELS[property.status]}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Limite plan gratuit ──────────────────────────────────────────────────────

const FREE_PROPERTY_LIMIT = 1;

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function RentalDashboard() {
  const insets  = useSafeAreaInsets();
  const { user, isPro } = useAuth();
  const router  = useRouter();

  const [properties, setProperties] = useState<RentalProperty[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Chargement en temps réel des logements du bailleur
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, "properties"),
      where("landlordId", "==", user.uid)
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RentalProperty));
      // Tri : logements loués en premier, puis vacants, puis en travaux
      const order: Record<string, number> = { rented: 0, vacant: 1, maintenance: 2 };
      data.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
      setProperties(data);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user?.uid]);

  // Les pros (SIRET / société) doivent payer — limite gratuit ne s'applique qu'aux particuliers
  // Pour l'instant on bloque aussi les pros tant qu'il n'y a pas de paiement en place
  const atLimit = !isPro && properties.length >= FREE_PROPERTY_LIMIT;

  const handlePressAdd = useCallback(() => {
    if (atLimit) {
      setShowLimitModal(true);
    } else {
      setShowModal(true);
    }
  }, [atLimit]);

  const handleSaveProperty = useCallback(async (data: Omit<RentalProperty, "id">) => {
    if (!isPro && properties.length >= FREE_PROPERTY_LIMIT) {
      setShowModal(false);
      setShowLimitModal(true);
      throw new Error("limit");
    }
    try {
      await addDoc(collection(db, "properties"), data);
      setShowModal(false);
    } catch (e: any) {
      if (e?.message !== "limit") {
        Alert.alert("Erreur", "Impossible d'ajouter le logement. Réessayez.");
      }
      throw e;
    }
  }, [properties.length]);

  const paddingTop = Platform.OS === "web" ? 16 : insets.top + 16;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop }]}>
        <HamburgerButton />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.title}>Mes logements</Text>
          {!loading && (
            <Text style={styles.subtitle}>
              {properties.length === 0
                ? "Aucun logement enregistré"
                : isPro
                  ? `${properties.length} logement${properties.length > 1 ? "s" : ""}`
                  : `${properties.length} / ${FREE_PROPERTY_LIMIT} logement${properties.length > 1 ? "s" : ""} (plan gratuit)`}
            </Text>
          )}
        </View>
        {/* Bouton + désactivé visuellement quand limite atteinte */}
        <Pressable
          style={({ pressed }) => [
            styles.addBtn,
            atLimit && styles.addBtnLocked,
            pressed && { opacity: 0.8 },
          ]}
          onPress={handlePressAdd}
        >
          <Ionicons name={atLimit ? "lock-closed" : "add"} size={20} color="#fff" />
        </Pressable>
      </View>

      {/* Bandeau limite plan gratuit */}
      {atLimit && !loading && (
        <Pressable style={styles.limitBanner} onPress={() => setShowLimitModal(true)}>
          <Ionicons name="lock-closed-outline" size={14} color="#8B5CF6" />
          <Text style={styles.limitBannerText}>
            Limite du plan gratuit atteinte · 1 logement max
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#8B5CF6" />
        </Pressable>
      )}

      {/* Contenu */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#8B5CF6" size="large" />
        </View>
      ) : properties.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="home-outline" size={64} color={COLORS.textMuted} style={{ opacity: 0.4 }} />
          <Text style={styles.emptyTitle}>Aucun logement</Text>
          <Text style={styles.emptyDesc}>
            Ajoutez votre premier logement pour commencer à gérer vos locations.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.8 }]}
            onPress={handlePressAdd}
          >
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={styles.emptyBtnText}>Ajouter un logement</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={properties}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <PropertyCard property={item} />}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modal ajout logement */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
        onRequestClose={() => setShowModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: "#fff" }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Ajouter un logement</Text>
            <Pressable onPress={() => setShowModal(false)} hitSlop={12}>
              <Ionicons name="close" size={24} color={COLORS.text} />
            </Pressable>
          </View>
          <PropertyForm
            onSave={handleSaveProperty}
            onCancel={() => setShowModal(false)}
          />
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal limite plan gratuit */}
      <Modal
        visible={showLimitModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLimitModal(false)}
      >
        <Pressable
          style={limitStyles.backdrop}
          onPress={() => setShowLimitModal(false)}
        >
          <View style={limitStyles.card}>
            <View style={limitStyles.iconWrap}>
              <Ionicons name="lock-closed" size={32} color="#8B5CF6" />
            </View>
            <Text style={limitStyles.title}>Plan gratuit</Text>
            <Text style={limitStyles.desc}>
              Le plan gratuit est limité à{" "}
              <Text style={{ fontFamily: "Inter_700Bold" }}>1 logement et 1 locataire</Text>.
            </Text>
            <Text style={limitStyles.desc}>
              Passez Pro pour gérer plusieurs logements et locataires sans limite.
            </Text>
            <Pressable
              style={({ pressed }) => [limitStyles.btnPro, pressed && { opacity: 0.85 }]}
              onPress={() => { setShowLimitModal(false); router.push("/rental-upgrade" as any); }}
            >
              <Ionicons name="diamond-outline" size={15} color="#fff" />
              <Text style={limitStyles.btnProText}>Voir les offres Pro</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [limitStyles.btnSecondary, pressed && { opacity: 0.7 }]}
              onPress={() => setShowLimitModal(false)}
            >
              <Text style={limitStyles.btnSecondaryText}>Plus tard</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  logoutIconBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },

  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#8B5CF6", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  addBtnLocked: { backgroundColor: "#9CA3AF" },
  addBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

  limitBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(139,92,246,0.07)",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(139,92,246,0.12)",
  },
  limitBannerText: {
    flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#8B5CF6",
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  empty: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 40, gap: 12,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  emptyDesc: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary, textAlign: "center", lineHeight: 20,
  },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#8B5CF6", borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 12, marginTop: 8,
  },
  emptyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },

  list: { padding: 16, gap: 12 },
});

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  left: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "rgba(139,92,246,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  info: { flex: 1, gap: 3 },
  address: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  city:    { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary },
  meta:    { flexDirection: "row", gap: 8 },
  metaText:{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

const formStyles = StyleSheet.create({
  content: { padding: 20, gap: 4 },
  sectionTitle: {
    fontSize: 14, fontFamily: "Inter_600SemiBold",
    color: COLORS.textSecondary, marginBottom: 8,
  },
  label: {
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    color: COLORS.text, marginBottom: 6, marginTop: 12,
  },
  optional: { fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  row: { flexDirection: "row", gap: 12 },
  input: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontFamily: "Inter_400Regular", color: COLORS.text,
  },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  typeChipActive: {
    backgroundColor: "rgba(139,92,246,0.08)", borderColor: "#8B5CF6",
  },
  typeLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  typeLabelActive: { color: "#8B5CF6" },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
  cancelBtn: {
    flex: 1, alignItems: "center", justifyContent: "center",
    borderRadius: 12, paddingVertical: 14,
    backgroundColor: COLORS.surfaceAlt,
  },
  cancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  saveBtn: {
    flex: 2, alignItems: "center", justifyContent: "center",
    borderRadius: 12, paddingVertical: 14, backgroundColor: "#8B5CF6",
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

const modalStyles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text },
});

const limitStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center", padding: 32,
  },
  card: {
    backgroundColor: "#fff", borderRadius: 20,
    padding: 28, alignItems: "center", gap: 14, width: "100%", maxWidth: 360,
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: "rgba(139,92,246,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.text },
  desc: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary, textAlign: "center", lineHeight: 20,
  },
  btnPro: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#8B5CF6", borderRadius: 12,
    paddingHorizontal: 28, paddingVertical: 13, marginTop: 4, width: "100%",
    justifyContent: "center",
  },
  btnProText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  btnSecondary: { paddingVertical: 10 },
  btnSecondaryText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#94A3B8" },
});
