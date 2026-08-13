import {
  View, Text, StyleSheet, Platform, ScrollView,
  Pressable, Modal, TextInput, Alert, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState, useCallback } from "react";
import {
  collection, query, where, onSnapshot, addDoc, doc, getDoc,
  orderBy, getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import type { RentalProperty, PropertyTenant } from "@/shared/types";
import { generateQuittanceHtml } from "@/lib/quittancePdf";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Quittance {
  id:              string;
  propertyId:      string;
  landlordId:      string;
  tenantName:      string;
  period:          string;    // "2026-08"
  rentAmount:      number;
  chargesAmount:   number;
  paymentDate:     string;
  quittanceNumber: string;
  propertyLabel?:  string;
  createdAt:       string;
}

interface PropertyOption {
  id:         string;
  label:      string;
  address:    string;
  postalCode: string;
  city:       string;
  surface?:   number;
  tenants?:   PropertyTenant[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function currentPeriod(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${m}`;
}

function formatMoney(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}

function generateNumber(period: string, count: number): string {
  return `QUI-${period.replace("-", "")}-${String(count + 1).padStart(3, "0")}`;
}

// ─── Modale création ──────────────────────────────────────────────────────────

function CreateModal({
  visible, onClose, properties, landlordName, landlordEmail,
}: {
  visible:      boolean;
  onClose:      () => void;
  properties:   PropertyOption[];
  landlordName: string;
  landlordEmail?: string;
}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [propertyId, setPropertyId]   = useState("");
  const [tenantName, setTenantName]   = useState("");
  const [tenantEmail, setTenantEmail] = useState("");
  const [period, setPeriod]           = useState(currentPeriod());
  const [paymentDate, setPaymentDate] = useState("");
  const [rentAmount, setRentAmount]   = useState("");
  const [charges, setCharges]         = useState("");
  const [saving, setSaving]           = useState(false);

  const selectedProp = properties.find((p) => p.id === propertyId);

  useEffect(() => {
    if (!visible) {
      setPropertyId(""); setTenantName(""); setTenantEmail("");
      setPeriod(currentPeriod()); setPaymentDate(""); setRentAmount(""); setCharges("");
    }
    if (visible && properties.length === 1) setPropertyId(properties[0].id);
  }, [visible, properties]);

  // Auto-remplir locataire actif
  useEffect(() => {
    if (!propertyId) return;
    const prop = properties.find((p) => p.id === propertyId);
    if (!prop?.tenants) return;
    const active = prop.tenants.find((t) => t.status === "active");
    if (active) {
      setTenantName(`${active.firstName} ${active.lastName}`);
      setTenantEmail(active.email ?? "");
    }
  }, [propertyId, properties]);

  const handleGenerate = async () => {
    if (!propertyId)      { Alert.alert("Logement manquant");   return; }
    if (!tenantName.trim()) { Alert.alert("Locataire manquant"); return; }
    if (!rentAmount)      { Alert.alert("Montant du loyer manquant"); return; }
    if (!paymentDate.trim()) { Alert.alert("Date de paiement manquante"); return; }
    if (!user) return;

    setSaving(true);
    try {
      const prop = properties.find((p) => p.id === propertyId)!;

      // Compter quittances existantes pour ce logement ce mois-ci
      const existing = await getDocs(
        query(
          collection(db, "properties", propertyId, "quittances"),
          where("period", "==", period)
        )
      );

      const number = generateNumber(period, existing.size);
      const quittanceData: Omit<Quittance, "id"> = {
        propertyId,
        landlordId:      user.uid,
        tenantName:      tenantName.trim(),
        period,
        rentAmount:      parseFloat(rentAmount),
        chargesAmount:   parseFloat(charges || "0"),
        paymentDate:     paymentDate.trim(),
        quittanceNumber: number,
        propertyLabel:   prop.label,
        createdAt:       new Date().toISOString(),
      };

      await addDoc(collection(db, "properties", propertyId, "quittances"), quittanceData);

      // Générer et partager le PDF immédiatement
      const html = generateQuittanceHtml({
        landlordName:    landlordName,
        landlordAddress: "", // Non stocké pour l'instant
        landlordEmail:   landlordEmail,
        tenantName:      tenantName.trim(),
        tenantEmail:     tenantEmail.trim() || undefined,
        propertyAddress: prop.address,
        propertyCity:    prop.city,
        propertyPostal:  prop.postalCode ?? "",
        surface:         prop.surface,
        period,
        paymentDate:     paymentDate.trim(),
        rentAmount:      parseFloat(rentAmount),
        chargesAmount:   parseFloat(charges || "0"),
        quittanceNumber: number,
      });

      await sharePdf(html, `quittance-${period}.pdf`);
      onClose();
    } catch (err) {
      console.error(err);
      Alert.alert("Erreur", "Impossible de générer la quittance.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]}
          onPress={onClose}
        />
        <ScrollView
          style={[create.sheet, { paddingBottom: insets.bottom + 20 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={create.handle} />
          <Text style={create.title}>Nouvelle quittance</Text>

          {/* Logement */}
          {properties.length > 1 && (
            <>
              <Text style={create.label}>Logement *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {properties.map((p) => (
                    <Pressable
                      key={p.id}
                      style={[create.chip, propertyId === p.id && create.chipActive]}
                      onPress={() => setPropertyId(p.id)}
                    >
                      <Text style={[create.chipText, propertyId === p.id && create.chipTextActive]}>
                        {p.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </>
          )}

          {/* Locataire */}
          <Text style={create.label}>Locataire *</Text>
          <TextInput
            style={create.input}
            placeholder="Prénom Nom du locataire"
            placeholderTextColor={COLORS.textMuted}
            value={tenantName}
            onChangeText={setTenantName}
          />

          {/* Période */}
          <Text style={create.label}>Période (AAAA-MM) *</Text>
          <TextInput
            style={create.input}
            placeholder="ex : 2026-08"
            placeholderTextColor={COLORS.textMuted}
            value={period}
            onChangeText={setPeriod}
          />

          {/* Date paiement */}
          <Text style={create.label}>Date de paiement *</Text>
          <TextInput
            style={create.input}
            placeholder="ex : 05/08/2026"
            placeholderTextColor={COLORS.textMuted}
            value={paymentDate}
            onChangeText={setPaymentDate}
          />

          {/* Montant loyer */}
          <Text style={create.label}>Loyer hors charges (€) *</Text>
          <TextInput
            style={create.input}
            placeholder="ex : 750"
            placeholderTextColor={COLORS.textMuted}
            value={rentAmount}
            onChangeText={setRentAmount}
            keyboardType="numeric"
          />

          {/* Charges */}
          <Text style={create.label}>Provision sur charges (€)</Text>
          <TextInput
            style={create.input}
            placeholder="ex : 80 (laisser vide si incluses)"
            placeholderTextColor={COLORS.textMuted}
            value={charges}
            onChangeText={setCharges}
            keyboardType="numeric"
          />

          {/* Total preview */}
          {rentAmount ? (
            <View style={create.preview}>
              <Text style={create.previewLabel}>Total</Text>
              <Text style={create.previewAmount}>
                {formatMoney((parseFloat(rentAmount) || 0) + (parseFloat(charges) || 0))}
              </Text>
            </View>
          ) : null}

          {/* Bouton */}
          <Pressable style={create.btn} onPress={handleGenerate} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="document-text-outline" size={18} color="#fff" />
                <Text style={create.btnText}>Générer et partager le PDF</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Share PDF helper ─────────────────────────────────────────────────────────

async function sharePdf(html: string, filename: string): Promise<void> {
  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    return;
  }
  try {
    const Print   = await import("expo-print");
    const Sharing = await import("expo-sharing");
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { UTI: ".pdf", mimeType: "application/pdf" });
    } else {
      Alert.alert("PDF généré", `Fichier : ${uri}`);
    }
  } catch {
    Alert.alert("Erreur", "Impossible de générer le PDF.");
  }
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function RentalQuittances() {
  const insets = useSafeAreaInsets();
  const paddingTop = Platform.OS === "web" ? 67 + 24 : insets.top + 16;
  const { user } = useAuth();

  const [quittances, setQuittances] = useState<Quittance[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const landlordName  = user?.displayName ?? "Bailleur";
  const landlordEmail = user?.email ?? undefined;

  const loadData = useCallback(() => {
    if (!user) return;

    let unsubQuittances: (() => void)[] = [];

    const propQ = query(
      collection(db, "properties"),
      where("landlordId", "==", user.uid)
    );

    const unsubProps = onSnapshot(propQ, async (propSnap) => {
      unsubQuittances.forEach((u) => u());
      unsubQuittances = [];

      const props = await Promise.all(
        propSnap.docs.map(async (d) => {
          const data = d.data() as RentalProperty;
          // Charger les locataires actifs
          const tenantsSnap = await getDocs(
            query(collection(db, "properties", d.id, "tenants"), where("status", "==", "active"))
          );
          return {
            id:         d.id,
            address:    data.address,
            postalCode: data.postalCode,
            city:       data.city,
            surface:    data.surface,
            label:      [data.address, data.city].filter(Boolean).join(", "),
            tenants:    tenantsSnap.docs.map((t) => ({
              id: t.id,
              ...(t.data() as Omit<PropertyTenant, "id">),
            })),
          };
        })
      );

      setProperties(props);

      if (props.length === 0) {
        setQuittances([]);
        setLoading(false);
        return;
      }

      const qMap = new Map<string, Quittance[]>();
      let resolved = 0;

      props.forEach((prop) => {
        const qQ = query(
          collection(db, "properties", prop.id, "quittances"),
          orderBy("createdAt", "desc")
        );

        const unsub = onSnapshot(qQ, (snap) => {
          qMap.set(
            prop.id,
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Quittance, "id">),
              propertyLabel: prop.label,
            }))
          );

          const all = Array.from(qMap.values())
            .flat()
            .sort((a, b) => b.period.localeCompare(a.period));
          setQuittances(all);
          resolved++;
          if (resolved >= props.length) setLoading(false);
        });

        unsubQuittances.push(unsub);
      });
    });

    return () => {
      unsubProps();
      unsubQuittances.forEach((u) => u());
    };
  }, [user]);

  useEffect(() => {
    const unsub = loadData();
    return unsub;
  }, [loadData]);

  const handleReprint = async (q: Quittance) => {
    const prop = properties.find((p) => p.id === q.propertyId);
    if (!prop) return;
    const html = generateQuittanceHtml({
      landlordName,
      landlordAddress: "",
      landlordEmail,
      tenantName:      q.tenantName,
      propertyAddress: prop.address,
      propertyCity:    prop.city,
      propertyPostal:  prop.postalCode ?? "",
      surface:         prop.surface,
      period:          q.period,
      paymentDate:     q.paymentDate,
      rentAmount:      q.rentAmount,
      chargesAmount:   q.chargesAmount,
      quittanceNumber: q.quittanceNumber,
    });
    await sharePdf(html, `quittance-${q.period}.pdf`);
  };

  return (
    <View style={[styles.root, { paddingTop }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Quittances</Text>
          <Text style={styles.subtitle}>
            {loading ? "Chargement…" : `${quittances.length} quittance${quittances.length !== 1 ? "s" : ""}`}
          </Text>
        </View>
        <Pressable style={styles.addBtn} onPress={() => setShowCreate(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Contenu */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : quittances.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={56} color={COLORS.textMuted} style={{ opacity: 0.4 }} />
          <Text style={styles.emptyTitle}>Aucune quittance</Text>
          <Text style={styles.emptyDesc}>
            Générez des quittances de loyer conformes à la loi du 6 juillet 1989.
          </Text>
          <Pressable style={styles.ctaBtn} onPress={() => setShowCreate(true)}>
            <Ionicons name="document-text-outline" size={16} color="#fff" />
            <Text style={styles.ctaBtnText}>Créer une quittance</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
          {quittances.map((q) => (
            <Pressable
              key={q.id}
              style={styles.card}
              onPress={() => handleReprint(q)}
            >
              <View style={styles.docIcon}>
                <Ionicons name="document-text" size={22} color={COLORS.primary} />
              </View>

              <View style={styles.cardBody}>
                <Text style={styles.cardPeriod}>{periodLabel(q.period)}</Text>
                <Text style={styles.cardTenant} numberOfLines={1}>{q.tenantName}</Text>
                {q.propertyLabel ? (
                  <Text style={styles.cardProp} numberOfLines={1}>{q.propertyLabel}</Text>
                ) : null}
              </View>

              <View style={styles.cardRight}>
                <Text style={styles.cardAmount}>
                  {formatMoney(q.rentAmount + q.chargesAmount)}
                </Text>
                <View style={styles.rePrint}>
                  <Ionicons name="share-outline" size={14} color={COLORS.primary} />
                  <Text style={styles.rePrintText}>Partager</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Modale */}
      <CreateModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        properties={properties}
        landlordName={landlordName}
        landlordEmail={landlordEmail}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title:    { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: "center", justifyContent: "center",
  },

  list: { flex: 1 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff",
    marginHorizontal: 16, marginTop: 12,
    borderRadius: 12,
    padding: 14,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  docIcon: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: "#EEF2FF",
    alignItems: "center", justifyContent: "center",
  },
  cardBody: { flex: 1, gap: 2 },
  cardPeriod: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text, textTransform: "capitalize" },
  cardTenant: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary },
  cardProp:   { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  cardRight:  { alignItems: "flex-end", gap: 4 },
  cardAmount: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text },
  rePrint:    { flexDirection: "row", alignItems: "center", gap: 4 },
  rePrintText: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.primary },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "center" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 },
  ctaBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 12, marginTop: 8,
  },
  ctaBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

const create = StyleSheet.create({
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12,
    maxHeight: "92%",
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: "center", marginBottom: 16,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 20 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    backgroundColor: "#FAFAFA", marginBottom: 14,
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: "#F8F8F8",
  },
  chipActive: { borderColor: COLORS.primary, backgroundColor: "#EEF2FF" },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.primary },
  preview: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#EEF2FF", borderRadius: 10, padding: 14, marginBottom: 16,
  },
  previewLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.primary },
  previewAmount: { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.primary },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingVertical: 14, marginTop: 4,
  },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
