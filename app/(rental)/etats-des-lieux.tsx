import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  collection, getDocs, orderBy, query, where,
} from "firebase/firestore";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import {
  InventoryReport, InventoryRoom,
  INVENTORY_TYPE_LABELS,
  INVENTORY_TYPE_ICONS,
  INVENTORY_TYPE_COLORS,
  INVENTORY_STATUS_LABELS,
  INVENTORY_STATUS_COLORS,
} from "@/shared/types";
import { HamburgerButton } from "@/components/rental/RentalDrawer";
import { generateInventoryHtml } from "@/lib/inventoryPdf";

// ─── Helpers PDF ───────────────────────────────────────────────────────────────

async function shareInventoryPdf(report: InventoryReport, rooms: InventoryRoom[]) {
  const html = generateInventoryHtml(report, rooms);

  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    else Alert.alert("Bloqué", "Autorisez les pop-ups pour afficher le PDF.");
    return;
  }

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      dialogTitle: "Partager l'état des lieux",
      UTI: "com.adobe.pdf",
    });
  } else {
    Alert.alert("PDF généré", `Fichier disponible : ${uri}`);
  }
}

// ─── Carte rapport ─────────────────────────────────────────────────────────────

function ReportCard({ report }: { report: InventoryReport }) {
  const router      = useRouter();
  const typeColor   = INVENTORY_TYPE_COLORS[report.type];
  const typeIcon    = INVENTORY_TYPE_ICONS[report.type] as any;
  const statusColor = INVENTORY_STATUS_COLORS[report.status];
  const snap        = report.propertySnapshot;
  const [pdfLoading, setPdfLoading] = useState(false);

  const handlePdf = async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      // Charger les pièces (sans orderBy pour éviter un index composite)
      const rSnap = await getDocs(
        collection(db, "properties", report.propertyId, "inventoryReports", report.id, "rooms")
      );
      const rooms: InventoryRoom[] = rSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryRoom, "id">) }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      await shareInventoryPdf(report, rooms);
    } catch (err) {
      console.error("PDF état des lieux:", err);
      Alert.alert("Erreur PDF", String(err instanceof Error ? err.message : err));
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      onPress={() => router.push(`/inventory/${report.id}?propertyId=${report.propertyId}` as any)}
    >
      {/* Rail coloré selon le type */}
      <View style={[s.typeRail, { backgroundColor: typeColor }]} />

      <View style={s.cardBody}>
        {/* En-tête */}
        <View style={s.cardTop}>
          <View style={[s.typeIconBox, { backgroundColor: `${typeColor}18` }]}>
            <Ionicons name={typeIcon} size={18} color={typeColor} />
          </View>
          <View style={s.cardInfo}>
            <Text style={s.cardType}>{INVENTORY_TYPE_LABELS[report.type]}</Text>
            <Text style={s.cardAddress} numberOfLines={1}>
              {snap.address}
              {snap.apartmentNumber ? ` — Apt. ${snap.apartmentNumber}` : ""}
            </Text>
            <Text style={s.cardCity}>{snap.postalCode} {snap.city}</Text>
          </View>
          <View style={[s.statusBadge, { backgroundColor: `${statusColor}16` }]}>
            <View style={[s.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[s.statusText, { color: statusColor }]}>
              {INVENTORY_STATUS_LABELS[report.status]}
            </Text>
          </View>
        </View>

        {/* Pied */}
        <View style={s.cardFooter}>
          <View style={s.footerLeft}>
            <Ionicons name="person-outline" size={12} color={COLORS.textMuted} />
            <Text style={s.footerText}>
              {snap.tenantFirstName} {snap.tenantLastName}
            </Text>
          </View>
          <Text style={s.footerDate}>
            {new Date(report.createdAt).toLocaleDateString("fr-FR")}
          </Text>
        </View>

        {/* Signatures + PDF */}
        <View style={s.cardActions}>
          {report.status !== "draft" && (
            <View style={s.sigRow}>
              <SigChip label="Bailleur"   signed={report.signatures?.landlord?.status === "signed"} />
              <SigChip label="Locataire"  signed={report.signatures?.tenant?.status === "signed"} />
            </View>
          )}
          {report.status !== "draft" && (
            <Pressable
              style={[s.pdfBtn, pdfLoading && { opacity: 0.6 }]}
              onPress={handlePdf}
              disabled={pdfLoading}
            >
              {pdfLoading ? (
                <ActivityIndicator size="small" color="#8B5CF6" />
              ) : (
                <>
                  <Ionicons name="share-outline" size={13} color="#8B5CF6" />
                  <Text style={s.pdfBtnText}>PDF</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function SigChip({ label, signed }: { label: string; signed: boolean }) {
  return (
    <View style={[s.sigChip, { backgroundColor: signed ? "rgba(16,185,129,0.1)" : COLORS.surfaceAlt }]}>
      <Ionicons
        name={signed ? "checkmark-circle" : "time-outline"}
        size={12}
        color={signed ? "#10B981" : COLORS.textMuted}
      />
      <Text style={[s.sigLabel, { color: signed ? "#10B981" : COLORS.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

// ─── Écran principal ───────────────────────────────────────────────────────────

export default function EtatsDesLieux() {
  const insets     = useSafeAreaInsets();
  const router     = useRouter();
  const { user }   = useAuth();

  const [reports, setReports] = useState<InventoryReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;

    const loadAll = async () => {
      try {
        const propsSnap = await getDocs(
          query(collection(db, "properties"), where("landlordId", "==", user.uid))
        );
        if (cancelled) return;

        const allReports: InventoryReport[] = [];
        await Promise.all(
          propsSnap.docs.map(async (propDoc) => {
            const rSnap = await getDocs(
              query(
                collection(db, "properties", propDoc.id, "inventoryReports"),
                orderBy("createdAt", "desc")
              )
            );
            rSnap.docs.forEach((d) => {
              allReports.push({ id: d.id, ...d.data() } as InventoryReport);
            });
          })
        );
        if (cancelled) return;

        allReports.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setReports(allReports);
      } catch (e) {
        console.error("Erreur chargement rapports:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAll();
    const interval = setInterval(loadAll, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.uid]);

  const paddingTop = Platform.OS === "web" ? 16 : insets.top + 16;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop }]}>
        <HamburgerButton />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.title}>États des lieux</Text>
          {!loading && (
            <Text style={s.subtitle}>
              {reports.length === 0
                ? "Aucun rapport créé"
                : `${reports.length} rapport${reports.length > 1 ? "s" : ""}`}
            </Text>
          )}
        </View>
        <Pressable
          style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.8 }]}
          onPress={() => router.push("/inventory/create" as any)}
        >
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={s.addBtnText}>Nouveau</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#8B5CF6" size="large" />
        </View>
      ) : reports.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="clipboard-outline" size={64} color={COLORS.textMuted} style={{ opacity: 0.35 }} />
          <Text style={s.emptyTitle}>Aucun état des lieux</Text>
          <Text style={s.emptyDesc}>
            Créez votre premier état des lieux d'entrée depuis la fiche d'un logement ou en appuyant sur "Nouveau".
          </Text>
          <Pressable
            style={({ pressed }) => [s.emptyBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.push("/inventory/create" as any)}
          >
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={s.emptyBtnText}>Créer un état des lieux</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => <ReportCard report={item} />}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingBottom: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    gap: 6,
  },
  title:    { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.text },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },

  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#8B5CF6", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  addBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

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

  card: {
    flexDirection: "row",
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardPressed: { opacity: 0.75 },
  typeRail: { width: 4 },
  cardBody: { flex: 1, padding: 14, gap: 10 },

  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  typeIconBox: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  cardInfo: { flex: 1 },
  cardType:    { fontSize: 13, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 2 },
  cardAddress: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  cardCity:    { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4,
    flexShrink: 0, alignSelf: "flex-start",
  },
  statusDot:  { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 10, fontFamily: "Inter_700Bold" },

  cardFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  footerLeft:  { flexDirection: "row", alignItems: "center", gap: 4 },
  footerText:  { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  footerDate:  { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  cardActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sigRow: { flexDirection: "row", gap: 6, flex: 1 },
  sigChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
  },
  sigLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  pdfBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "#8B5CF6",
    backgroundColor: "#F5F3FF",
  },
  pdfBtnText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#8B5CF6" },
});
