/**
 * app/(tenant)/documents.tsx
 * Page "Mes documents" côté locataire :
 *  - États des lieux (rapports non-draft liés à sa propriété)
 *  - Documents partagés par le bailleur (visibleToTenant = true)
 */
import {
  View, Text, StyleSheet, Platform, ScrollView,
  Pressable, ActivityIndicator, Linking, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { collection, query, onSnapshot, where, orderBy, getDocs } from "firebase/firestore";
import { useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import {
  InventoryReport,
  InventoryRoom,
  PropertyDocument,
  INVENTORY_TYPE_LABELS,
  INVENTORY_STATUS_LABELS,
  INVENTORY_STATUS_COLORS,
  PROPERTY_DOCUMENT_TYPE_LABELS,
  PROPERTY_DOCUMENT_TYPE_ICONS,
} from "@/shared/types";
import { generateInventoryHtml } from "@/lib/inventoryPdf";

// ─── Helper PDF ───────────────────────────────────────────────────────────────

async function sharePdf(html: string): Promise<void> {
  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    else Alert.alert("Bloqué", "Autorisez les pop-ups pour afficher le PDF.");
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      dialogTitle: "Partager l'état des lieux",
      UTI: "com.adobe.pdf",
    });
  } else {
    Alert.alert("PDF généré", `Fichier : ${uri}`);
  }
}

// ─── Carte état des lieux ─────────────────────────────────────────────────────

function InventoryCard({
  report, propertyId,
}: { report: InventoryReport; propertyId: string }) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);

  const statusColor = INVENTORY_STATUS_COLORS[report.status] ?? "#94A3B8";
  const statusLabel = INVENTORY_STATUS_LABELS[report.status] ?? report.status;
  const typeLabel   = INVENTORY_TYPE_LABELS[report.type] ?? report.type;

  const handleViewPdf = async () => {
    setGenerating(true);
    try {
      const roomsSnap = await getDocs(
        collection(db, "properties", propertyId, "inventoryReports", report.id, "rooms")
      );
      const rooms = roomsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryRoom));
      const html = generateInventoryHtml(report, rooms);
      await sharePdf(html);
    } catch {
      Alert.alert("Erreur", "Impossible de charger l'état des lieux.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <View style={card.root}>
      <View style={card.top}>
        <View style={card.iconBox}>
          <Ionicons name="clipboard" size={20} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={card.title}>{typeLabel}</Text>
          <Text style={card.date}>
            {new Date(report.createdAt).toLocaleDateString("fr-FR", {
              day: "numeric", month: "long", year: "numeric",
            })}
          </Text>
        </View>
        <View style={[card.badge, { backgroundColor: `${statusColor}18` }]}>
          <Text style={[card.badgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={card.actions}>
        {/* Voir l'état des lieux complet */}
        <Pressable
          style={card.btn}
          onPress={() =>
            router.push(`/inventory/${report.id}?propertyId=${propertyId}` as any)
          }
        >
          <Ionicons name="eye-outline" size={15} color={COLORS.primary} />
          <Text style={card.btnText}>Consulter</Text>
        </Pressable>

        {/* Générer PDF */}
        <Pressable
          style={[card.btn, card.btnPdf]}
          onPress={handleViewPdf}
          disabled={generating}
        >
          {generating ? (
            <ActivityIndicator size="small" color="#8B5CF6" />
          ) : (
            <Ionicons name="document-text-outline" size={15} color="#8B5CF6" />
          )}
          <Text style={card.btnText}>
            {generating ? "Chargement…" : "Télécharger PDF"}
          </Text>
        </Pressable>
      </View>

      {/* Signature tenant */}
      {report.signatures?.landlord?.status === "signed" &&
       report.signatures?.tenant?.status !== "signed" && (
         <View style={card.signAlert}>
           <Ionicons name="warning-outline" size={14} color="#F59E0B" />
           <Text style={card.signAlertText}>
             Signature bailleur apposée — votre signature est attendue
           </Text>
         </View>
       )}
    </View>
  );
}

// ─── Carte document partagé ───────────────────────────────────────────────────

function DocumentCard({ doc: pdoc }: { doc: PropertyDocument }) {
  const iconName = PROPERTY_DOCUMENT_TYPE_ICONS[pdoc.type] ?? "document";
  const typeLabel = PROPERTY_DOCUMENT_TYPE_LABELS[pdoc.type] ?? pdoc.type;

  const handleOpen = async () => {
    if (!pdoc.url) { Alert.alert("Lien indisponible"); return; }
    try {
      const can = await Linking.canOpenURL(pdoc.url);
      if (can) await Linking.openURL(pdoc.url);
      else Alert.alert("Impossible d'ouvrir le lien", pdoc.url);
    } catch {
      Alert.alert("Erreur", "Impossible d'ouvrir le document.");
    }
  };

  return (
    <Pressable style={docCard.root} onPress={handleOpen}>
      <View style={docCard.iconBox}>
        <Ionicons name={iconName as any} size={20} color="#3B82F6" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={docCard.label} numberOfLines={1}>{pdoc.label}</Text>
        <Text style={docCard.type}>{typeLabel}</Text>
        <Text style={docCard.date}>
          {new Date(pdoc.createdAt).toLocaleDateString("fr-FR", {
            day: "numeric", month: "short", year: "numeric",
          })}
        </Text>
      </View>
      <Ionicons name="open-outline" size={16} color={COLORS.textMuted} />
    </Pressable>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function TenantDocuments() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const paddingTop = Platform.OS === "web" ? 67 + 16 : insets.top + 12;
  const { user, rentalInfo } = useAuth();

  const [reports, setReports]     = useState<InventoryReport[]>([]);
  const [pdocs, setPdocs]         = useState<PropertyDocument[]>([]);
  const [loading, setLoading]     = useState(true);

  const propertyId = rentalInfo?.propertyId;

  useEffect(() => {
    if (!propertyId || !user) { setLoading(false); return; }

    let reportsDone = false;
    let docsDone = false;
    const checkDone = () => {
      if (reportsDone && docsDone) setLoading(false);
    };

    // États des lieux non-draft
    const rptQ = query(
      collection(db, "properties", propertyId, "inventoryReports"),
      orderBy("createdAt", "desc")
    );
    const unsubRpt = onSnapshot(rptQ, (snap) => {
      setReports(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as InventoryReport))
          .filter((r) => r.status !== "draft")
      );
      reportsDone = true;
      checkDone();
    }, () => { reportsDone = true; checkDone(); });

    // Documents visibles locataire
    const docQ = query(
      collection(db, "properties", propertyId, "documents"),
      where("visibleToTenant", "==", true),
      orderBy("createdAt", "desc")
    );
    const unsubDoc = onSnapshot(docQ, (snap) => {
      setPdocs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PropertyDocument)));
      docsDone = true;
      checkDone();
    }, () => { docsDone = true; checkDone(); });

    return () => { unsubRpt(); unsubDoc(); };
  }, [propertyId, user]);

  const hasNothing = reports.length === 0 && pdocs.length === 0;

  return (
    <View style={[styles.root, { paddingTop }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.title}>Mes documents</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : !propertyId ? (
        <View style={styles.center}>
          <Ionicons name="home-outline" size={48} color={COLORS.textMuted} style={{ opacity: 0.4 }} />
          <Text style={styles.emptyTitle}>Aucun logement associé</Text>
        </View>
      ) : hasNothing ? (
        <View style={styles.center}>
          <Ionicons name="folder-open-outline" size={56} color={COLORS.textMuted} style={{ opacity: 0.4 }} />
          <Text style={styles.emptyTitle}>Aucun document disponible</Text>
          <Text style={styles.emptyDesc}>
            Vos états des lieux et documents partagés par votre bailleur apparaîtront ici.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* États des lieux */}
          {reports.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="clipboard-outline" size={14} color={COLORS.textSecondary} /> États des lieux
              </Text>
              {reports.map((r) => (
                <InventoryCard key={r.id} report={r} propertyId={propertyId} />
              ))}
            </View>
          )}

          {/* Documents partagés */}
          {pdocs.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="folder-outline" size={14} color={COLORS.textSecondary} /> Documents partagés
              </Text>
              {pdocs.map((d) => (
                <DocumentCard key={d.id} doc={d} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text },
  section: { paddingHorizontal: 16, paddingTop: 20, gap: 10 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "center" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 },
});

const card = StyleSheet.create({
  root: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  iconBox: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: "#EEF2FF",
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  date:  { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  actions: { flexDirection: "row", gap: 8 },
  btn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingVertical: 10, backgroundColor: "#FAFAFA",
  },
  btnPdf: { borderColor: "#C4B5FD", backgroundColor: "#F5F3FF" },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  signAlert: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FFFBEB", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 10,
  },
  signAlertText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#B45309", flex: 1 },
});

const docCard = StyleSheet.create({
  root: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    flexDirection: "row", alignItems: "center", gap: 12,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: "#EFF6FF",
    alignItems: "center", justifyContent: "center",
  },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  type:  { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, marginTop: 2 },
  date:  { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
});
