import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { documentDirectory, moveAsync } from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { wa, wConfirm } from "@/shared/dialogs";
import { useInterventions } from "@/context/InterventionsContext";

interface Lot {
  id: string;
  numero: string;
  proprietaire: string;
  tantieme: number;
  description?: string;
  updatedAt: string;
}

function fmt(n: number) { return n.toLocaleString("fr-FR", { maximumFractionDigits: 4 }); }

export default function TantièmesScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const { currentCopro, currentRole } = useCoPro();
  const { interventions } = useInterventions();

  const isAdmin  = currentRole === "admin" || currentRole === "co-admin";
  const isConseil = currentRole === "conseil";
  const canWrite = isAdmin;

  const [lots,    setLots]    = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Lot | null>(null);
  const [form,    setForm]    = useState({ numero: "", proprietaire: "", tantieme: "", description: "" });
  const [saving,  setSaving]  = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tab,     setTab]     = useState<"lots" | "calcul">("lots");

  // montant de charges à répartir
  const [totalCharges, setTotalCharges] = useState("");

  useEffect(() => {
    if (!currentCopro?.id) return;
    const q = query(collection(db, "copros", currentCopro.id, "lots"), orderBy("numero", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setLots(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lot)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [currentCopro?.id]);

  const totalTantièmes = lots.reduce((s, l) => s + l.tantieme, 0);

  const openEdit = (lot?: Lot) => {
    if (lot) {
      setEditing(lot);
      setForm({ numero: lot.numero, proprietaire: lot.proprietaire, tantieme: String(lot.tantieme), description: lot.description ?? "" });
    } else {
      setEditing({ id: "", numero: "", proprietaire: "", tantieme: 0, description: "", updatedAt: "" });
      setForm({ numero: "", proprietaire: "", tantieme: "", description: "" });
    }
  };

  const handleSave = async () => {
    if (!currentCopro?.id || !user) return;
    const num = parseFloat(form.tantieme.replace(",", "."));
    if (!form.numero.trim() || !form.proprietaire.trim() || isNaN(num) || num <= 0) {
      wa("Données invalides", "Numéro de lot, propriétaire et tantième sont requis.");
      return;
    }
    setSaving(true);
    try {
      const id = editing?.id || `lot_${Date.now()}`;
      await setDoc(doc(db, "copros", currentCopro.id, "lots", id), {
        numero: form.numero.trim(),
        proprietaire: form.proprietaire.trim(),
        tantieme: num,
        description: form.description.trim() || null,
        updatedAt: new Date().toISOString(),
      });
      setEditing(null);
    } catch { wa("Erreur", "Impossible d'enregistrer."); }
    setSaving(false);
  };

  const handleDelete = (lot: Lot) => {
    wConfirm("Supprimer ce lot", `Lot ${lot.numero} sera supprimé.`, async () => {
      try { await deleteDoc(doc(db, "copros", currentCopro!.id, "lots", lot.id)); }
      catch { wa("Erreur", "Impossible de supprimer."); }
    }, "Supprimer");
  };

  const handleExportPDF = async () => {
    if (!currentCopro || !lots.length) { wa("Export", "Aucun lot à exporter."); return; }
    setExporting(true);
    try {
      const totalC = parseFloat(totalCharges.replace(",", ".")) || 0;
      const rows = lots.map((l) => {
        const pct = totalTantièmes > 0 ? ((l.tantieme / totalTantièmes) * 100).toFixed(2) : "0.00";
        const part = totalC > 0 ? ((l.tantieme / totalTantièmes) * totalC) : null;
        return `<tr>
          <td>${l.numero}</td>
          <td>${l.proprietaire}</td>
          <td style="text-align:right">${fmt(l.tantieme)}</td>
          <td style="text-align:right">${pct} %</td>
          ${totalC > 0 ? `<td style="text-align:right">${part!.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</td>` : ""}
        </tr>`;
      }).join("");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
        <style>
          body{font-family:Arial,sans-serif;font-size:12px;padding:30px;color:#1a1a1a}
          h1{font-size:20px;color:#2563EB;margin-bottom:4px}
          .meta{color:#6B7280;font-size:11px;margin-bottom:20px}
          table{width:100%;border-collapse:collapse}
          th{background:#F1F5F9;text-align:left;padding:8px 10px;font-size:11px}
          td{padding:7px 10px;border-bottom:1px solid #F1F5F9}
          .total{font-weight:bold;background:#EFF6FF;padding:10px;border-radius:6px;margin-top:10px}
        </style></head><body>
        <h1>Tableau des tantièmes</h1>
        <div class="meta">${currentCopro.name} · ${lots.length} lots · Total : ${fmt(totalTantièmes)} tantièmes · Édité le ${new Date().toLocaleDateString("fr-FR")}</div>
        <table>
          <thead><tr><th>Lot</th><th>Propriétaire</th><th style="text-align:right">Tantièmes</th><th style="text-align:right">Quote-part</th>${totalC > 0 ? `<th style="text-align:right">Charges (${totalC.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })})</th>` : ""}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="total">Total : ${fmt(totalTantièmes)} tantièmes — ${lots.length} lots</div>
        </body></html>`;
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const dest = `${documentDirectory ?? ""}Tantiemes_${currentCopro.name.replace(/\s+/g, "_")}.pdf`;
      await moveAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest, { mimeType: "application/pdf" });
    } catch { wa("Erreur", "Impossible de générer le PDF."); }
    setExporting(false);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Tantièmes</Text>
          <Text style={styles.headerSub}>{currentCopro?.name} · {lots.length} lots</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {lots.length > 0 && (
            <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={handleExportPDF} disabled={exporting}>
              {exporting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="document-text-outline" size={20} color="#fff" />}
            </Pressable>
          )}
          {canWrite && (
            <Pressable style={styles.addBtn} onPress={() => openEdit()}>
              <Ionicons name="add" size={22} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(["lots", "calcul"] as const).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "lots" ? `Lots (${lots.length})` : "Calcul de charges"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={COLORS.primary} />
      ) : tab === "lots" ? (
        <FlatList
          data={lots}
          keyExtractor={(l) => l.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            totalTantièmes > 0 ? (
              <View style={styles.totalBanner}>
                <Ionicons name="pie-chart-outline" size={16} color={COLORS.primary} />
                <Text style={styles.totalBannerText}>Total tantièmes : {fmt(totalTantièmes)}</Text>
                {Math.abs(totalTantièmes - 10000) < 0.5 && (
                  <View style={styles.okBadge}><Text style={styles.okBadgeText}>10 000 ✓</Text></View>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="grid-outline" size={40} color={COLORS.border} />
              <Text style={styles.emptyTitle}>Aucun lot enregistré</Text>
              <Text style={styles.emptyDesc}>{canWrite ? "Appuyez sur + pour ajouter le premier lot avec ses tantièmes." : "L'administrateur n'a pas encore saisi les lots."}</Text>
            </View>
          }
          renderItem={({ item: lot }) => {
            const pct = totalTantièmes > 0 ? ((lot.tantieme / totalTantièmes) * 100).toFixed(2) : "0.00";
            return (
              <View style={styles.lotRow}>
                <View style={styles.lotNumBadge}><Text style={styles.lotNumText}>{lot.numero}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lotOwner} numberOfLines={1}>{lot.proprietaire}</Text>
                  {lot.description ? <Text style={styles.lotDesc} numberOfLines={1}>{lot.description}</Text> : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.lotTantieme}>{fmt(lot.tantieme)}</Text>
                  <Text style={styles.lotPct}>{pct} %</Text>
                </View>
                {canWrite && (
                  <View style={{ flexDirection: "row", gap: 4, marginLeft: 8 }}>
                    <Pressable onPress={() => openEdit(lot)} hitSlop={8} style={styles.actionBtn}>
                      <Ionicons name="create-outline" size={16} color={COLORS.primary} />
                    </Pressable>
                    <Pressable onPress={() => handleDelete(lot)} hitSlop={8} style={styles.actionBtn}>
                      <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
        />
      ) : (
        /* Calcul de charges */
        <View style={styles.calculContainer}>
          <Text style={styles.calculTitle}>Répartition des charges</Text>
          <Text style={styles.calculHint}>Entrez le montant total des charges à répartir entre les copropriétaires.</Text>
          <View style={styles.calculInputRow}>
            <TextInput
              style={styles.calculInput}
              value={totalCharges}
              onChangeText={setTotalCharges}
              placeholder="Ex : 12 500,00"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="decimal-pad"
            />
            <Text style={styles.calculEuro}>€</Text>
          </View>
          {lots.length > 0 && totalTantièmes > 0 && parseFloat(totalCharges.replace(",", ".")) > 0 ? (
            <FlatList
              data={lots}
              keyExtractor={(l) => l.id}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              showsVerticalScrollIndicator={false}
              style={{ marginTop: 16 }}
              renderItem={({ item: lot }) => {
                const total = parseFloat(totalCharges.replace(",", "."));
                const part  = (lot.tantieme / totalTantièmes) * total;
                const pct   = ((lot.tantieme / totalTantièmes) * 100).toFixed(2);
                return (
                  <View style={styles.calculRow}>
                    <View style={styles.lotNumBadge}><Text style={styles.lotNumText}>{lot.numero}</Text></View>
                    <Text style={styles.calculOwner} numberOfLines={1}>{lot.proprietaire}</Text>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.calculAmount}>{part.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</Text>
                      <Text style={styles.calculPct}>{pct} %</Text>
                    </View>
                  </View>
                );
              }}
            />
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="calculator-outline" size={40} color={COLORS.border} />
              <Text style={styles.emptyTitle}>
                {lots.length === 0 ? "Aucun lot enregistré" : "Entrez un montant de charges"}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Formulaire modal */}
      {editing !== null && (
        <View style={styles.formOverlay}>
          <View style={styles.formSheet}>
            <Text style={styles.formTitle}>{editing.id ? "Modifier le lot" : "Nouveau lot"}</Text>
            <View style={styles.formRow}>
              <View style={[styles.formField, { flex: 0.4 }]}>
                <Text style={styles.formLabel}>Lot n°</Text>
                <TextInput style={styles.formInput} value={form.numero} onChangeText={(v) => setForm((f) => ({ ...f, numero: v }))} placeholder="Ex: 12" placeholderTextColor={COLORS.textMuted} />
              </View>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.formLabel}>Propriétaire</Text>
                <TextInput style={styles.formInput} value={form.proprietaire} onChangeText={(v) => setForm((f) => ({ ...f, proprietaire: v }))} placeholder="Nom prénom" placeholderTextColor={COLORS.textMuted} />
              </View>
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Tantièmes</Text>
              <TextInput style={styles.formInput} value={form.tantieme} onChangeText={(v) => setForm((f) => ({ ...f, tantieme: v }))} placeholder="Ex: 250" keyboardType="decimal-pad" placeholderTextColor={COLORS.textMuted} />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Description (optionnel)</Text>
              <TextInput style={styles.formInput} value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="Appartement T3, 2e étage…" placeholderTextColor={COLORS.textMuted} />
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <Pressable style={[styles.formBtn, styles.formBtnCancel]} onPress={() => setEditing(null)}>
                <Text style={styles.formBtnCancelText}>Annuler</Text>
              </Pressable>
              <Pressable style={[styles.formBtn, styles.formBtnSave, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.formBtnSaveText}>Enregistrer</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  addBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },

  tabRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  tabTextActive: { color: COLORS.primary, fontFamily: "Inter_600SemiBold" },

  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },

  totalBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(37,99,235,0.07)", borderRadius: 10, padding: 10, marginBottom: 10 },
  totalBannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  okBadge: { backgroundColor: "#D1FAE5", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  okBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#065F46" },

  lotRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  lotNumBadge: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(37,99,235,0.1)", alignItems: "center", justifyContent: "center" },
  lotNumText: { fontSize: 13, fontFamily: "Inter_700Bold", color: COLORS.primary },
  lotOwner: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  lotDesc: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  lotTantieme: { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  lotPct: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  actionBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border },

  calculContainer: { flex: 1, padding: 16 },
  calculTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 6 },
  calculHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginBottom: 14, lineHeight: 18 },
  calculInputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  calculInput: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text, backgroundColor: COLORS.surface },
  calculEuro: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  calculRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  calculOwner: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.text },
  calculAmount: { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  calculPct: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  emptyState: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center", paddingHorizontal: 40 },

  formOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  formSheet: { backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  formTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 4 },
  formRow: { flexDirection: "row", gap: 10 },
  formField: { gap: 4 },
  formLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  formInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, backgroundColor: COLORS.surface },
  formBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  formBtnCancel: { borderWidth: 1, borderColor: COLORS.border },
  formBtnCancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  formBtnSave: { backgroundColor: COLORS.primary },
  formBtnSaveText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
