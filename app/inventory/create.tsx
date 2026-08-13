import { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addDoc, collection, doc, getDoc, getDocs,
  orderBy, query, serverTimestamp, where,
} from "firebase/firestore";
import { v4 as randomUUID } from "uuid";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import {
  InventoryType,
  INVENTORY_TYPE_LABELS,
  INVENTORY_TYPE_ICONS,
  INVENTORY_TYPE_COLORS,
  RentalProperty,
  PropertyTenant,
} from "@/shared/types";
import {
  ROOM_TEMPLATES_BY_PROPERTY_TYPE,
  DEFAULT_ROOM_ITEMS,
  createDefaultMeterReadings,
  createDefaultKeyItems,
} from "@/lib/inventoryDefaults";

const TYPES: InventoryType[] = ["entry", "exit", "intermediate"];

export default function CreateInventory() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const { user }   = useAuth();
  const params     = useLocalSearchParams<{ propertyId?: string }>();

  const [step, setStep]             = useState<1 | 2>(1);
  const [selectedType, setType]     = useState<InventoryType>("entry");
  const [properties, setProperties] = useState<RentalProperty[]>([]);
  const [selectedProp, setProp]     = useState<RentalProperty | null>(null);
  const [tenants, setTenants]       = useState<PropertyTenant[]>([]);
  const [selectedTenant, setTenant] = useState<PropertyTenant | null>(null);
  const [loadingProps, setLoadingProps] = useState(true);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [saving, setSaving]         = useState(false);

  const paddingTop = Platform.OS === "web" ? 67 + 16 : insets.top + 8;

  // Charger les logements du bailleur
  useEffect(() => {
    if (!user?.uid) return;
    getDocs(
      query(collection(db, "properties"), where("landlordId", "==", user.uid))
    ).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RentalProperty));
      setProperties(list);
      // Si propertyId passé en param, pré-sélectionner
      if (params.propertyId) {
        const pre = list.find((p) => p.id === params.propertyId);
        if (pre) setProp(pre);
      }
      setLoadingProps(false);
    }).catch(() => setLoadingProps(false));
  }, [user?.uid, params.propertyId]);

  // Charger les locataires actifs quand un logement est sélectionné
  useEffect(() => {
    if (!selectedProp) { setTenants([]); setTenant(null); return; }
    setLoadingTenants(true);
    getDocs(
      query(
        collection(db, "properties", selectedProp.id, "tenants"),
        where("status", "in", ["active", "invited"])
      )
    ).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PropertyTenant));
      setTenants(list);
      if (list.length === 1) setTenant(list[0]);
      setLoadingTenants(false);
    }).catch(() => setLoadingTenants(false));
  }, [selectedProp?.id]);

  const canGoStep2 = selectedProp !== null && selectedTenant !== null;
  const canCreate  = canGoStep2;

  const handleCreate = useCallback(async () => {
    if (!canCreate || !user?.uid || !selectedProp || !selectedTenant) return;
    setSaving(true);
    try {
      // Récupérer le nom du bailleur
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const landlordName  = userDoc.data()?.displayName ?? "Bailleur";
      const landlordEmail = userDoc.data()?.email ?? user.email ?? "";

      // Snapshot du logement
      const propertySnapshot = {
        address:           selectedProp.address,
        postalCode:        selectedProp.postalCode,
        city:              selectedProp.city,
        propertyType:      selectedProp.propertyType,
        surface:           selectedProp.surface,
        numberOfRooms:     selectedProp.numberOfRooms,
        apartmentNumber:   selectedProp.apartmentNumber,
        tenantFirstName:   selectedTenant.firstName,
        tenantLastName:    selectedTenant.lastName,
        tenantEmail:       selectedTenant.email,
        landlordName,
        landlordEmail,
      };

      // Créer le rapport
      const reportRef = await addDoc(
        collection(db, "properties", selectedProp.id, "inventoryReports"),
        {
          propertyId:     selectedProp.id,
          landlordId:     user.uid,
          tenantId:       selectedTenant.id,
          tenantUserId:   selectedTenant.userId ?? null,
          type:           selectedType,
          status:         "draft",
          propertySnapshot,
          generalObservations: "",
          tenantObservations:  "",
          meterReadings:  createDefaultMeterReadings(),
          keyItems:       createDefaultKeyItems(),
          equipment:      [],
          signatures:     {},
          createdAt:      new Date().toISOString(),
          updatedAt:      new Date().toISOString(),
        }
      );

      // Créer les pièces par défaut selon le type de logement
      const templates = ROOM_TEMPLATES_BY_PROPERTY_TYPE[selectedProp.propertyType] ?? [];
      const roomsRef  = collection(db, "properties", selectedProp.id, "inventoryReports", reportRef.id, "rooms");

      for (let i = 0; i < templates.length; i++) {
        const tmpl = templates[i];
        await addDoc(roomsRef, {
          reportId:         reportRef.id,
          name:             tmpl.name,
          type:             tmpl.type,
          isAnnex:          false,
          order:            i,
          photos:           [],
          items:            DEFAULT_ROOM_ITEMS[tmpl.type] ?? [],
          observation:      "",
          tenantObservation: "",
          createdAt:        new Date().toISOString(),
          updatedAt:        new Date().toISOString(),
        });
      }

      router.replace(`/inventory/${reportRef.id}?propertyId=${selectedProp.id}` as any);
    } catch (e: any) {
      Alert.alert("Erreur", "Impossible de créer le rapport. Réessayez.");
      setSaving(false);
    }
  }, [canCreate, user, selectedProp, selectedTenant, selectedType, router]);

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={s.headerTitle}>Nouvel état des lieux</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* TYPE */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Type d'état des lieux</Text>
            <View style={s.typeGrid}>
              {TYPES.map((t) => {
                const active = selectedType === t;
                const color  = INVENTORY_TYPE_COLORS[t];
                return (
                  <Pressable
                    key={t}
                    style={[s.typeCard, active && { borderColor: color, backgroundColor: `${color}0E` }]}
                    onPress={() => setType(t)}
                  >
                    <Ionicons
                      name={INVENTORY_TYPE_ICONS[t] as any}
                      size={24}
                      color={active ? color : COLORS.textMuted}
                    />
                    <Text style={[s.typeLabel, active && { color }]}>
                      {INVENTORY_TYPE_LABELS[t]}
                    </Text>
                    {active && (
                      <Ionicons name="checkmark-circle" size={16} color={color} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* LOGEMENT */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Logement concerné</Text>
            {loadingProps ? (
              <ActivityIndicator color="#8B5CF6" style={{ marginTop: 8 }} />
            ) : properties.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyCardText}>Aucun logement. Créez-en un depuis le dashboard.</Text>
              </View>
            ) : (
              <View style={s.pickList}>
                {properties.map((p) => {
                  const active = selectedProp?.id === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      style={[s.pickItem, active && s.pickItemActive]}
                      onPress={() => { setProp(p); setTenant(null); }}
                    >
                      <Ionicons name="home-outline" size={18} color={active ? "#8B5CF6" : COLORS.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.pickItemTitle, active && { color: "#8B5CF6" }]}>
                          {p.address}{p.apartmentNumber ? ` — Apt. ${p.apartmentNumber}` : ""}
                        </Text>
                        <Text style={s.pickItemSub}>{p.postalCode} {p.city}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color="#8B5CF6" />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* LOCATAIRE */}
          {selectedProp && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Locataire concerné</Text>
              {loadingTenants ? (
                <ActivityIndicator color="#8B5CF6" style={{ marginTop: 8 }} />
              ) : tenants.length === 0 ? (
                <View style={s.emptyCard}>
                  <Text style={s.emptyCardText}>
                    Aucun locataire actif sur ce logement.{"\n"}Invitez d'abord un locataire depuis la fiche logement.
                  </Text>
                </View>
              ) : (
                <View style={s.pickList}>
                  {tenants.map((t) => {
                    const active = selectedTenant?.id === t.id;
                    return (
                      <Pressable
                        key={t.id}
                        style={[s.pickItem, active && s.pickItemActive]}
                        onPress={() => setTenant(t)}
                      >
                        <View style={s.tenantAvatar}>
                          <Text style={s.tenantAvatarText}>
                            {(t.firstName[0] ?? "") + (t.lastName[0] ?? "")}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.pickItemTitle, active && { color: "#8B5CF6" }]}>
                            {t.firstName} {t.lastName}
                          </Text>
                          <Text style={s.pickItemSub}>{t.email}</Text>
                        </View>
                        {active && <Ionicons name="checkmark-circle" size={20} color="#8B5CF6" />}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* BOUTON CRÉER */}
          <Pressable
            style={[s.createBtn, (!canCreate || saving) && s.createBtnDisabled]}
            onPress={handleCreate}
            disabled={!canCreate || saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <Ionicons name="clipboard" size={20} color="#fff" />
                  <Text style={s.createBtnText}>Créer l'état des lieux</Text>
                </>
            }
          </Pressable>

          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },

  scroll: { padding: 20, gap: 28 },

  section: { gap: 12 },
  sectionLabel: {
    fontSize: 12, fontFamily: "Inter_700Bold",
    color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 0.7,
  },

  typeGrid: { gap: 10 },
  typeCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  typeLabel: {
    flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text,
  },

  pickList: { gap: 8 },
  pickItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  pickItemActive: {
    borderColor: "#8B5CF6", backgroundColor: "rgba(139,92,246,0.04)",
  },
  pickItemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  pickItemSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },

  tenantAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(139,92,246,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  tenantAvatarText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#8B5CF6" },

  emptyCard: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  emptyCardText: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, textAlign: "center", lineHeight: 18,
  },

  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, backgroundColor: "#8B5CF6", borderRadius: 16, paddingVertical: 16,
    marginTop: 4,
  },
  createBtnDisabled: { opacity: 0.45 },
  createBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
