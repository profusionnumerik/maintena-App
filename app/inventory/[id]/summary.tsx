/**
 * app/inventory/[id]/summary.tsx
 * Récapitulatif complet du rapport + bouton Finaliser (→ ready_for_signature).
 * Bailleur : peut finaliser, signer, archiver.
 * Locataire : peut consulter et ajouter une observation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, Modal, PanResponder,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Path, Svg, SvgXml } from "react-native-svg";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {
  collection, doc, getDocs, onSnapshot, updateDoc,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";

const SIG_W = Math.min(Dimensions.get("window").width - 48, 360);
const SIG_H = 160;
import { generateInventoryHtml } from "@/lib/inventoryPdf";
import {
  InventoryReport, InventoryRoom, InventoryStatus,
  INVENTORY_TYPE_LABELS,
  INVENTORY_STATUS_LABELS, INVENTORY_STATUS_COLORS,
  ELEMENT_CONDITION_LABELS, ELEMENT_CONDITION_COLORS,
  METER_TYPE_LABELS,
} from "@/shared/types";

type SectionStat = {
  label: string;
  icon: string;
  count: number;
  detail: string;
  ok: boolean;
};

export default function SummaryScreen() {
  const { id, propertyId } = useLocalSearchParams<{ id: string; propertyId: string }>();
  const router              = useRouter();
  const insets              = useSafeAreaInsets();
  const { user }            = useAuth();

  const [report, setReport]   = useState<InventoryReport | null>(null);
  const [rooms, setRooms]     = useState<InventoryRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [showFinalizeModal, setShowFinalizeModal]     = useState(false);
  const [showSignModal, setShowSignModal]             = useState(false);
  const [showTenantSignModal, setShowTenantSignModal] = useState(false);
  const [observations, setObservations]               = useState("");
  const [generatingPdf, setGeneratingPdf]             = useState(false);

  // ── Signature pad bailleur
  const [landlordStrokes, setLandlordStrokes]   = useState<{x:number;y:number}[][]>([]);
  const [landlordLive, setLandlordLive]         = useState<{x:number;y:number}[]>([]);
  const landlordCurrentStroke = useRef<{x:number;y:number}[]>([]);
  const landlordStrokesRef    = useRef<{x:number;y:number}[][]>([]);
  const [savedSignSvg, setSavedSignSvg]         = useState<string | null>(null);
  const [useSavedSig, setUseSavedSig]           = useState(false);

  // ── Signature pad locataire
  const [tenantStrokes, setTenantStrokes]       = useState<{x:number;y:number}[][]>([]);
  const [tenantLive, setTenantLive]             = useState<{x:number;y:number}[]>([]);
  const tenantCurrentStroke = useRef<{x:number;y:number}[]>([]);
  const tenantStrokesRef    = useRef<{x:number;y:number}[][]>([]);

  const paddingTop = Platform.OS === "web" ? 67 + 12 : insets.top + 8;

  // Écoute rapport
  useEffect(() => {
    if (!id || !propertyId) return;
    return onSnapshot(
      doc(db, "properties", propertyId, "inventoryReports", id),
      (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as InventoryReport;
          setReport(data);
          setObservations(data.generalObservations ?? "");
        }
        setLoading(false);
      }
    );
  }, [id, propertyId]);

  // Charger les pièces
  useEffect(() => {
    if (!id || !propertyId) return;
    getDocs(collection(db, "properties", propertyId, "inventoryReports", id, "rooms"))
      .then((snap) => {
        setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryRoom)));
      });
  }, [id, propertyId]);

  // ── PanResponder bailleur
  const landlordPR = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true, onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { const { locationX: x, locationY: y } = e.nativeEvent; landlordCurrentStroke.current = [{ x, y }]; setLandlordLive([{ x, y }]); },
      onPanResponderMove: (e) => { const { locationX: x, locationY: y } = e.nativeEvent; landlordCurrentStroke.current = [...landlordCurrentStroke.current, { x, y }]; setLandlordLive([...landlordCurrentStroke.current]); },
      onPanResponderRelease: () => { if (landlordCurrentStroke.current.length > 0) { landlordStrokesRef.current = [...landlordStrokesRef.current, landlordCurrentStroke.current]; setLandlordStrokes([...landlordStrokesRef.current]); } setLandlordLive([]); landlordCurrentStroke.current = []; },
      onPanResponderTerminate: () => { if (landlordCurrentStroke.current.length > 0) { landlordStrokesRef.current = [...landlordStrokesRef.current, landlordCurrentStroke.current]; setLandlordStrokes([...landlordStrokesRef.current]); } setLandlordLive([]); landlordCurrentStroke.current = []; },
    })
  ).current;

  // ── PanResponder locataire
  const tenantPR = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true, onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { const { locationX: x, locationY: y } = e.nativeEvent; tenantCurrentStroke.current = [{ x, y }]; setTenantLive([{ x, y }]); },
      onPanResponderMove: (e) => { const { locationX: x, locationY: y } = e.nativeEvent; tenantCurrentStroke.current = [...tenantCurrentStroke.current, { x, y }]; setTenantLive([...tenantCurrentStroke.current]); },
      onPanResponderRelease: () => { if (tenantCurrentStroke.current.length > 0) { tenantStrokesRef.current = [...tenantStrokesRef.current, tenantCurrentStroke.current]; setTenantStrokes([...tenantStrokesRef.current]); } setTenantLive([]); tenantCurrentStroke.current = []; },
      onPanResponderTerminate: () => { if (tenantCurrentStroke.current.length > 0) { tenantStrokesRef.current = [...tenantStrokesRef.current, tenantCurrentStroke.current]; setTenantStrokes([...tenantStrokesRef.current]); } setTenantLive([]); tenantCurrentStroke.current = []; },
    })
  ).current;

  function ptsToPath(pts: {x:number;y:number}[]): string {
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} l0.1,0.1`;
    return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` + pts.slice(1).map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
  }

  async function uploadSignatureSvg(strokes: {x:number;y:number}[][], svgOverride?: string, role: "landlord" | "tenant" = "landlord"): Promise<string> {
    let svgStr = svgOverride;
    if (!svgStr) {
      const pathsXml = strokes.map((pts) => `<path d="${ptsToPath(pts)}" stroke="#1E293B" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
      svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIG_W}" height="${SIG_H}" viewBox="0 0 ${SIG_W} ${SIG_H}" style="background:white">${pathsXml}</svg>`;
    }
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const path = `inventory-signatures/${propertyId}/${id}/${role}_${Date.now()}.svg`;
    const sRef = storageRef(storage, path);
    await uploadBytes(sRef, blob, { contentType: "image/svg+xml" });
    return await getDownloadURL(sRef);
  }

  const isLandlord = report?.landlordId === user?.uid;
  const isTenant   = !isLandlord && user?.uid != null;

  // Stats pièces
  const roomStats = rooms.map((r) => {
    const checked = r.items.filter((i) => i.condition !== "not_checked").length;
    return { room: r, checked, total: r.items.length };
  });
  const allChecked = roomStats.every((rs) => rs.checked === rs.total);
  const totalItems = roomStats.reduce((s, rs) => s + rs.total, 0);
  const checkedItems = roomStats.reduce((s, rs) => s + rs.checked, 0);

  const sections: SectionStat[] = [
    {
      label: "Pièces & annexes",
      icon:  "grid-outline",
      count: rooms.length,
      detail: `${checkedItems}/${totalItems} éléments vérifiés`,
      ok: allChecked && rooms.length > 0,
    },
    {
      label: "Compteurs",
      icon:  "speedometer-outline",
      count: report?.meterReadings.length ?? 0,
      detail: report?.meterReadings.map((m) => METER_TYPE_LABELS[m.type]).join(", ") || "Aucun relevé",
      ok: (report?.meterReadings.length ?? 0) > 0,
    },
    {
      label: "Clés & accès",
      icon:  "key-outline",
      count: report?.keyItems.reduce((s, k) => s + k.quantity, 0) ?? 0,
      detail: report?.keyItems.length
        ? `${report.keyItems.length} type${report.keyItems.length > 1 ? "s" : ""} d'accès`
        : "Aucune clé renseignée",
      ok: (report?.keyItems.length ?? 0) > 0,
    },
    {
      label: "Équipements",
      icon:  "construct-outline",
      count: report?.equipment.length ?? 0,
      detail: report?.equipment.length
        ? `${report.equipment.length} équipement${report.equipment.length > 1 ? "s" : ""}`
        : "Aucun équipement",
      ok: true, // Optionnel
    },
  ];

  const canFinalize = isLandlord &&
    report?.status === "draft" &&
    rooms.length > 0 &&
    allChecked;

  // Sauvegarder observations générales
  const saveObservations = useCallback(async () => {
    if (!report) return;
    setSaving(true);
    try {
      await updateDoc(
        doc(db, "properties", propertyId, "inventoryReports", id),
        { generalObservations: observations, updatedAt: new Date().toISOString() }
      );
    } catch {
      Alert.alert("Erreur", "Impossible de sauvegarder.");
    } finally {
      setSaving(false);
    }
  }, [observations, propertyId, id, report]);

  // Finaliser le rapport
  const handleFinalize = async () => {
    setSaving(true);
    setShowFinalizeModal(false);
    try {
      await updateDoc(
        doc(db, "properties", propertyId, "inventoryReports", id),
        {
          status:           "ready_for_signature",
          generalObservations: observations,
          finalizedAt:      new Date().toISOString(),
          updatedAt:        new Date().toISOString(),
        }
      );
      Alert.alert(
        "Rapport finalisé ✓",
        "Le rapport est prêt pour signature. Le locataire peut maintenant le consulter et signer.",
        [{ text: "OK" }]
      );
    } catch {
      Alert.alert("Erreur", "Impossible de finaliser le rapport.");
    } finally {
      setSaving(false);
    }
  };

  // Ouvre le pad bailleur et charge la signature enregistrée si elle existe
  const openLandlordSign = async () => {
    setLandlordStrokes([]); landlordStrokesRef.current = []; setLandlordLive([]); landlordCurrentStroke.current = [];
    setUseSavedSig(false); setSavedSignSvg(null);
    try {
      const { getDoc } = await import("firebase/firestore");
      const snap = await getDoc(doc(db, "users", user!.uid));
      const svg = snap.data()?.signatureModelSvg ?? null;
      setSavedSignSvg(svg); if (svg) setUseSavedSig(true);
    } catch {}
    setShowSignModal(true);
  };

  const handleSignLandlord = async () => {
    const strokes = landlordStrokesRef.current;
    if (!useSavedSig && strokes.length === 0) { Alert.alert("Signature requise", "Dessinez ou appliquez votre signature."); return; }
    setShowSignModal(false);
    setSaving(true);
    try {
      const signatureImageUrl = await uploadSignatureSvg(strokes, useSavedSig && savedSignSvg ? savedSignSvg : undefined, "landlord");
      const sigRecord = {
        status:           "signed",
        providerType:     "local",
        signerUid:        user!.uid,
        signerEmail:      user!.email ?? "",
        signerName:       report!.propertySnapshot.landlordName,
        signedAt:         new Date().toISOString(),
        signatureImageUrl,
      };
      const currentStatus: InventoryStatus = report?.signatures?.tenant?.status === "signed" ? "signed" : "partially_signed";
      await updateDoc(
        doc(db, "properties", propertyId, "inventoryReports", id),
        { "signatures.landlord": sigRecord, status: currentStatus, updatedAt: new Date().toISOString() }
      );
      Alert.alert("Signé ✓", "Votre signature a été enregistrée.");
    } catch {
      Alert.alert("Erreur", "Impossible d'enregistrer la signature.");
    } finally {
      setSaving(false);
    }
  };

  // Génération PDF
  const handleGeneratePdf = async () => {
    if (!report) return;
    setGeneratingPdf(true);
    try {
      const html = generateInventoryHtml(report, rooms);

      // Web : ouvrir dans un nouvel onglet
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
    } catch {
      Alert.alert("Erreur", "Impossible de générer le PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Signature locataire
  const handleSignTenant = async () => {
    const strokes = tenantStrokesRef.current;
    if (strokes.length === 0) { Alert.alert("Signature requise", "Dessinez votre signature dans le cadre."); return; }
    setShowTenantSignModal(false);
    setSaving(true);
    try {
      const signatureImageUrl = await uploadSignatureSvg(strokes, undefined, "tenant");
      const sigRecord = {
        status:            "signed",
        providerType:      "local",
        signerUid:         user!.uid,
        signerEmail:       user!.email ?? "",
        signerName:        `${report!.propertySnapshot.tenantFirstName} ${report!.propertySnapshot.tenantLastName}`,
        signedAt:          new Date().toISOString(),
        signatureImageUrl,
      };
      const currentStatus: InventoryStatus = report?.signatures?.landlord?.status === "signed" ? "signed" : "partially_signed";
      await updateDoc(
        doc(db, "properties", propertyId, "inventoryReports", id),
        { "signatures.tenant": sigRecord, status: currentStatus, updatedAt: new Date().toISOString() }
      );
      Alert.alert("Signé ✓", "Votre signature a été enregistrée. L'état des lieux est maintenant complet.");
    } catch {
      Alert.alert("Erreur", "Impossible d'enregistrer la signature.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color="#8B5CF6" size="large" />
      </View>
    );
  }

  if (!report) {
    return (
      <View style={[s.root, s.center]}>
        <Text style={s.notFound}>Rapport introuvable</Text>
        <Pressable style={s.backBtnAlt} onPress={() => router.back()}>
          <Text style={s.backBtnAltText}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  const statusColor = INVENTORY_STATUS_COLORS[report.status];
  const snap        = report.propertySnapshot;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </Pressable>
        <Text style={s.headerTitle}>Résumé & signature</Text>
        {saving && <ActivityIndicator size="small" color="#8B5CF6" />}
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Statut */}
        <View style={[s.statusBanner, { backgroundColor: statusColor + "14" }]}>
          <View style={[s.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[s.statusText, { color: statusColor }]}>
            {INVENTORY_STATUS_LABELS[report.status]}
          </Text>
        </View>

        {/* Info logement */}
        <View style={s.card}>
          <Text style={s.cardTitle}>{INVENTORY_TYPE_LABELS[report.type]}</Text>
          <Text style={s.cardAddr}>{snap.address}{snap.apartmentNumber ? ` — Apt. ${snap.apartmentNumber}` : ""}</Text>
          <Text style={s.cardSub}>{snap.postalCode} {snap.city}</Text>
          <View style={s.divider} />
          <Text style={s.cardMeta}>Locataire : {snap.tenantFirstName} {snap.tenantLastName}</Text>
          <Text style={s.cardMeta}>Bailleur : {snap.landlordName}</Text>
          <Text style={s.cardMeta}>
            Créé le {new Date(report.createdAt).toLocaleDateString("fr-FR", {
              day: "numeric", month: "long", year: "numeric",
            })}
          </Text>
        </View>

        {/* Sections */}
        <Text style={s.sectionLabel}>Sections</Text>
        <View style={s.statsList}>
          {sections.map((sec, idx) => (
            <View key={sec.label} style={[s.statRow, idx < sections.length - 1 && s.statRowBorder]}>
              <View style={[s.statIcon, sec.ok ? s.statIconOk : s.statIconWarn]}>
                <Ionicons
                  name={sec.icon as any}
                  size={17}
                  color={sec.ok ? "#10B981" : "#F59E0B"}
                />
              </View>
              <View style={s.statBody}>
                <Text style={s.statLabel}>{sec.label}</Text>
                <Text style={s.statDetail}>{sec.detail}</Text>
              </View>
              <Text style={[s.statCount, { color: sec.ok ? "#10B981" : COLORS.textMuted }]}>
                {sec.count}
              </Text>
            </View>
          ))}
        </View>

        {/* Pièces détail */}
        {rooms.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>État par pièce</Text>
            <View style={s.statsList}>
              {rooms.map((room, idx) => {
                const rs = roomStats.find((r) => r.room.id === room.id)!;
                const condDistrib = room.items.reduce<Record<string, number>>((acc, it) => {
                  acc[it.condition] = (acc[it.condition] ?? 0) + 1;
                  return acc;
                }, {});
                const worstColor = room.generalCondition
                  ? ELEMENT_CONDITION_COLORS[room.generalCondition]
                  : COLORS.textMuted;
                return (
                  <View key={room.id} style={[s.statRow, idx < rooms.length - 1 && s.statRowBorder]}>
                    <View style={[s.roomDot, { backgroundColor: worstColor + "20" }]}>
                      <View style={[s.roomDotInner, { backgroundColor: worstColor }]} />
                    </View>
                    <View style={s.statBody}>
                      <Text style={s.statLabel}>{room.name}</Text>
                      <Text style={s.statDetail}>{rs.checked}/{rs.total} éléments</Text>
                    </View>
                    {room.generalCondition && room.generalCondition !== "not_checked" && (
                      <Text style={[s.condChip, { color: worstColor }]}>
                        {ELEMENT_CONDITION_LABELS[room.generalCondition]}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Observations générales */}
        <Text style={[s.sectionLabel, { marginTop: 16 }]}>Observations générales</Text>
        <TextInput
          style={s.textarea}
          placeholder="Observations générales du bailleur sur l'état du logement…"
          placeholderTextColor={COLORS.textMuted}
          value={observations}
          onChangeText={setObservations}
          onBlur={saveObservations}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          editable={isLandlord}
        />
        {isLandlord && (
          <Pressable style={s.saveObsBtn} onPress={saveObservations}>
            <Text style={s.saveObsBtnText}>Sauvegarder les observations</Text>
          </Pressable>
        )}

        {/* Signatures */}
        <Text style={[s.sectionLabel, { marginTop: 16 }]}>Signatures</Text>
        <View style={s.sigCard}>
          <SigBlock
            label="Bailleur"
            name={snap.landlordName}
            record={report.signatures?.landlord}
            canSign={
              isLandlord &&
              report.status !== "draft" &&
              report.status !== "archived" &&
              report.signatures?.landlord?.status !== "signed"
            }
            onSign={openLandlordSign}
          />
          <View style={s.divider} />
          <SigBlock
            label="Locataire"
            name={`${snap.tenantFirstName} ${snap.tenantLastName}`}
            record={report.signatures?.tenant}
            canSign={
              isTenant &&
              (report.status === "ready_for_signature" || report.status === "partially_signed") &&
              report.signatures?.landlord?.status === "signed" &&
              report.signatures?.tenant?.status !== "signed"
            }
            onSign={() => setShowTenantSignModal(true)}
          />
        </View>

        {/* Bouton PDF — disponible dès que le rapport est finalisé */}
        {report.status !== "draft" && (
          <Pressable
            style={[s.pdfBtn, generatingPdf && { opacity: 0.6 }]}
            onPress={handleGeneratePdf}
            disabled={generatingPdf}
          >
            {generatingPdf ? (
              <ActivityIndicator size="small" color="#8B5CF6" />
            ) : (
              <Ionicons name="document-text" size={20} color="#8B5CF6" />
            )}
            <Text style={s.pdfBtnText}>
              {generatingPdf ? "Génération en cours…" : "Générer et partager le PDF"}
            </Text>
            {!generatingPdf && <Ionicons name="share-outline" size={18} color="#8B5CF6" />}
          </Pressable>
        )}

        {/* ── CTA Finaliser ─────────────────────────────────────────────── */}
        {canFinalize && (
          <View style={s.finalizeBox}>
            <Ionicons name="checkmark-circle-outline" size={28} color="#10B981" />
            <Text style={s.finalizeTitle}>Rapport complet</Text>
            <Text style={s.finalizeDesc}>
              Toutes les pièces sont vérifiées. Finalisez le rapport pour le soumettre à la signature.
            </Text>
            <Pressable
              style={s.finalizeBtn}
              onPress={() => setShowFinalizeModal(true)}
            >
              <Ionicons name="send" size={18} color="#fff" />
              <Text style={s.finalizeBtnText}>Finaliser & envoyer pour signature</Text>
            </Pressable>
          </View>
        )}

        {!canFinalize && report.status === "draft" && isLandlord && (
          <View style={s.warningBox}>
            <Ionicons name="information-circle-outline" size={22} color="#F59E0B" />
            <Text style={s.warningText}>
              {rooms.length === 0
                ? "Ajoutez au moins une pièce avant de finaliser."
                : "Vérifiez tous les éléments de chaque pièce avant de finaliser."}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Modale confirmation finalisation */}
      <Modal
        visible={showFinalizeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFinalizeModal(false)}
      >
        <View style={s.overlay}>
          <View style={s.alertModal}>
            <Ionicons name="send" size={36} color="#8B5CF6" />
            <Text style={s.alertTitle}>Finaliser le rapport ?</Text>
            <Text style={s.alertDesc}>
              Le rapport sera verrouillé pour édition et envoyé aux deux parties pour signature.{"\n\n"}
              Cette action est irréversible.
            </Text>
            <Pressable style={s.alertConfirm} onPress={handleFinalize}>
              <Text style={s.alertConfirmText}>Confirmer et finaliser</Text>
            </Pressable>
            <Pressable style={s.alertCancel} onPress={() => setShowFinalizeModal(false)}>
              <Text style={s.alertCancelText}>Annuler</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Modale signature bailleur — pad de signature ── */}
      <Modal visible={showSignModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSignModal(false)}>
        <View style={[sp.root, { paddingTop: insets.top + 16 }]}>
          <View style={sp.header}>
            <Pressable onPress={() => setShowSignModal(false)}><Text style={sp.cancel}>Annuler</Text></Pressable>
            <Text style={sp.headerTitle}>Signature bailleur</Text>
            <Pressable onPress={handleSignLandlord} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#8B5CF6" /> : <Text style={sp.validate}>Valider</Text>}
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={sp.body} keyboardShouldPersistTaps="handled">
            <View style={sp.infoBanner}>
              <Ionicons name="create-outline" size={16} color="#7C3AED" />
              <Text style={sp.infoText}>Signature de {snap.landlordName} — {INVENTORY_TYPE_LABELS[report.type]}</Text>
            </View>
            {savedSignSvg && (
              <View style={[sp.savedBox, useSavedSig && sp.savedBoxActive]}>
                <View style={sp.savedHeader}>
                  <Ionicons name="shield-checkmark" size={14} color={useSavedSig ? "#7C3AED" : COLORS.textMuted} />
                  <Text style={[sp.savedLabel, useSavedSig && { color: "#7C3AED" }]}>Signature enregistrée</Text>
                  <Pressable style={[sp.applyBtn, useSavedSig && sp.applyBtnActive]} onPress={() => { setUseSavedSig(!useSavedSig); if (!useSavedSig) { setLandlordStrokes([]); landlordStrokesRef.current = []; } }}>
                    <Text style={[sp.applyBtnText, useSavedSig && { color: "#7C3AED" }]}>{useSavedSig ? "✓ Appliquée" : "Appliquer"}</Text>
                  </Pressable>
                </View>
                <SvgXml xml={savedSignSvg} width={SIG_W} height={90} />
              </View>
            )}
            {(!savedSignSvg || !useSavedSig) && (
              <>
                <Text style={sp.hint}>Dessinez votre signature :</Text>
                <View style={[sp.canvas, { width: SIG_W, height: SIG_H }]} pointerEvents="box-only" {...landlordPR.panHandlers}>
                  <Svg width={SIG_W} height={SIG_H}>
                    {landlordStrokes.map((pts, i) => <Path key={i} d={ptsToPath(pts)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
                    {landlordLive.length > 1 && <Path d={ptsToPath(landlordLive)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
                  </Svg>
                </View>
                <Pressable style={sp.clearBtn} onPress={() => { setLandlordStrokes([]); landlordStrokesRef.current = []; setLandlordLive([]); landlordCurrentStroke.current = []; }}>
                  <Ionicons name="trash-outline" size={13} color={COLORS.textMuted} />
                  <Text style={sp.clearBtnText}>Effacer</Text>
                </Pressable>
              </>
            )}
            <Text style={sp.legal}>En validant, vous apposez votre signature électronique conformément à l'article 1366 du Code civil.</Text>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Modale signature locataire — pad de signature ── */}
      <Modal visible={showTenantSignModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowTenantSignModal(false)}>
        <View style={[sp.root, { paddingTop: insets.top + 16 }]}>
          <View style={sp.header}>
            <Pressable onPress={() => { setShowTenantSignModal(false); setTenantStrokes([]); tenantStrokesRef.current = []; }}><Text style={sp.cancel}>Annuler</Text></Pressable>
            <Text style={sp.headerTitle}>Signature locataire</Text>
            <Pressable onPress={handleSignTenant} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#10B981" /> : <Text style={[sp.validate, { color: "#10B981" }]}>Valider</Text>}
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={sp.body} keyboardShouldPersistTaps="handled">
            <View style={[sp.infoBanner, { borderColor: "#BBFBDA", backgroundColor: "#F0FDF4" }]}>
              <Ionicons name="create-outline" size={16} color="#16A34A" />
              <Text style={[sp.infoText, { color: "#166534" }]}>Signature de {snap.tenantFirstName} {snap.tenantLastName} — {INVENTORY_TYPE_LABELS[report.type]}</Text>
            </View>
            <Text style={sp.hint}>Dessinez votre signature :</Text>
            <View style={[sp.canvas, { width: SIG_W, height: SIG_H }]} pointerEvents="box-only" {...tenantPR.panHandlers}>
              <Svg width={SIG_W} height={SIG_H}>
                {tenantStrokes.map((pts, i) => <Path key={i} d={ptsToPath(pts)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
                {tenantLive.length > 1 && <Path d={ptsToPath(tenantLive)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
              </Svg>
            </View>
            <Pressable style={sp.clearBtn} onPress={() => { setTenantStrokes([]); tenantStrokesRef.current = []; setTenantLive([]); tenantCurrentStroke.current = []; }}>
              <Ionicons name="trash-outline" size={13} color={COLORS.textMuted} />
              <Text style={sp.clearBtnText}>Effacer</Text>
            </Pressable>
            <Text style={sp.legal}>En validant, vous apposez votre signature électronique conformément à l'article 1366 du Code civil.</Text>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ─── Bloc signature ───────────────────────────────────────────────────────────
function SigBlock({
  label, name, record, canSign, onSign,
}: {
  label: string;
  name: string;
  record?: { status?: string; signedAt?: string } | null;
  canSign?: boolean;
  onSign?: () => void;
}) {
  const signed = record?.status === "signed";
  return (
    <View style={sb.container}>
      <View style={sb.top}>
        <View style={[sb.icon, signed ? sb.iconOk : sb.iconPending]}>
          <Ionicons
            name={signed ? "checkmark" : "time-outline"}
            size={16}
            color={signed ? "#10B981" : COLORS.textMuted}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sb.role}>{label}</Text>
          <Text style={sb.name}>{name}</Text>
          {signed && record?.signedAt ? (
            <Text style={sb.date}>
              Signé le {new Date(record.signedAt).toLocaleDateString("fr-FR", {
                day: "numeric", month: "long", year: "numeric",
              })}
            </Text>
          ) : (
            <Text style={sb.pending}>Signature en attente</Text>
          )}
        </View>
      </View>
      {canSign && (
        <Pressable style={sb.signBtn} onPress={onSign}>
          <Ionicons name="create-outline" size={16} color="#fff" />
          <Text style={sb.signBtnText}>Signer maintenant</Text>
        </Pressable>
      )}
    </View>
  );
}

const sb = StyleSheet.create({
  container: { gap: 12 },
  top:       { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  icon:      { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  iconOk:    { backgroundColor: "rgba(16,185,129,0.12)" },
  iconPending: { backgroundColor: COLORS.surfaceAlt },
  role:    { fontSize: 10, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  name:    { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  date:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#10B981", marginTop: 2 },
  pending: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  signBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "stretch",
    backgroundColor: "#8B5CF6", borderRadius: 12,
    paddingVertical: 12, justifyContent: "center",
  },
  signBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
});

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: "center", justifyContent: "center", gap: 12 },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center",
  },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },

  scroll: { padding: 16, gap: 4 },

  statusBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: "Inter_700Bold" },

  card: {
    backgroundColor: "#fff", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, gap: 3, marginBottom: 20,
  },
  cardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 4 },
  cardAddr:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  cardSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  cardMeta:  { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary },
  divider:   { height: 1, backgroundColor: COLORS.border, marginVertical: 8 },

  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8,
  },
  statsList: {
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, overflow: "hidden", marginBottom: 4,
  },
  statRow:       { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  statRowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  statIcon: {
    width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center",
  },
  statIconOk:   { backgroundColor: "rgba(16,185,129,0.1)" },
  statIconWarn: { backgroundColor: "rgba(245,158,11,0.1)" },
  statBody:  { flex: 1 },
  statLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  statDetail:{ fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  statCount: { fontSize: 18, fontFamily: "Inter_700Bold" },

  roomDot: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  roomDotInner: { width: 10, height: 10, borderRadius: 5 },
  condChip: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  textarea: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border,
    minHeight: 90, textAlignVertical: "top", marginBottom: 8,
  },
  saveObsBtn: {
    alignSelf: "flex-end",
    backgroundColor: COLORS.surfaceAlt, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8, marginBottom: 4,
    borderWidth: 1, borderColor: COLORS.border,
  },
  saveObsBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },

  sigCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, gap: 16, marginBottom: 16,
  },

  pdfBtn: {
    flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16,
    backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(139,92,246,0.2)",
  },
  pdfBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#8B5CF6" },

  finalizeBox: {
    backgroundColor: "rgba(16,185,129,0.06)", borderRadius: 16, padding: 20,
    borderWidth: 1.5, borderColor: "rgba(16,185,129,0.25)",
    alignItems: "center", gap: 10, marginTop: 8,
  },
  finalizeTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text },
  finalizeDesc:  {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary, textAlign: "center", lineHeight: 19,
  },
  finalizeBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4,
    backgroundColor: "#10B981", borderRadius: 14,
    paddingHorizontal: 24, paddingVertical: 14,
  },
  finalizeBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },

  warningBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)", marginTop: 8,
  },
  warningText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 18 },

  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  alertModal: {
    backgroundColor: "#fff", borderRadius: 20, padding: 24,
    alignItems: "center", gap: 12, width: "100%", maxWidth: 380,
  },
  alertTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, textAlign: "center" },
  alertDesc:  {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary, textAlign: "center", lineHeight: 19,
  },
  alertConfirm: {
    backgroundColor: "#8B5CF6", borderRadius: 14, paddingVertical: 14,
    alignSelf: "stretch", alignItems: "center", marginTop: 4,
  },
  alertConfirmText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  alertCancel: {
    paddingVertical: 12, alignSelf: "stretch", alignItems: "center",
  },
  alertCancelText: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.textMuted },

  notFound:       { fontSize: 16, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  backBtnAlt:     { backgroundColor: COLORS.surfaceAlt, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backBtnAltText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
});

// ── Styles pour les modales de signature (pad) ──────────────────────────────
const sp = StyleSheet.create({
  root:  { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  cancel:   { fontSize: 15, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  validate: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#8B5CF6" },
  body: { padding: 20, gap: 16 },

  infoBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F5F3FF", borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: "#DDD6FE",
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#6D28D9" },

  savedBox: {
    borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt, padding: 10, gap: 8,
  },
  savedBoxActive: { borderColor: "#8B5CF6", backgroundColor: "#F5F3FF" },
  savedHeader:  { flexDirection: "row", alignItems: "center", gap: 8 },
  savedLabel:   { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  applyBtn: {
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border,
  },
  applyBtnActive: { backgroundColor: "#EDE9FE", borderColor: "#8B5CF6" },
  applyBtnText:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },

  hint: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  canvas: {
    borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: "#fff", overflow: "hidden", alignSelf: "center",
  },
  clearBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end",
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border,
  },
  clearBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },

  legal: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, lineHeight: 16, textAlign: "center",
  },
});
