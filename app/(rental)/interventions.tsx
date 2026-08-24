/**
 * Interventions — côté bailleur.
 * Workflow complet : création → demande de devis → comparatif → bon pour accord.
 */
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, Linking, Modal, PanResponder,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Path, Svg, SvgXml } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  addDoc, collection, doc, getDoc, onSnapshot,
  orderBy, query, updateDoc, where,
} from "firebase/firestore";
import DateInput, { maskDate } from "@/components/DateInput";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl } from "@/lib/query-client";
import { wa, wConfirm } from "@/shared/dialogs";
import type { RentalProperty, PropertyIntervention, RentalInterventionStatus } from "@/shared/types";
import { RENTAL_INTERVENTION_STATUS_LABELS, RENTAL_INTERVENTION_STATUS_COLORS } from "@/shared/types";
import { HamburgerButton } from "@/components/rental/RentalDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────

type InterventionWithProperty = PropertyIntervention & { propertyLabel?: string; devis?: DevisOffer[]; devisStatus?: DevisStatus; selectedDevisId?: string };
interface PropertyOption { id: string; label: string }
interface ProviderContact { id: string; firstName: string; lastName: string; email: string; phone?: string; company?: string; specialty?: string }

interface DevisOffer {
  id: string; contactId: string; contactName: string; contactCompany: string; contactEmail: string;
  token?: string; submitted: boolean; priceTTC?: number; description?: string;
  devisFileUrl?: string; signedAt?: string; signatureUrl?: string;
  signatureToken?: string; landlordSignedAt?: string; landlordSignatureUrl?: string;
  finalDevisUrl?: string;
}
type DevisStatus = "none" | "requested" | "received" | "retained";

// ─── Constantes ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "plomberie",   label: "Plomberie",    icon: "water-outline" },
  { id: "electricite",  label: "Électricité",  icon: "flash-outline" },
  { id: "chauffage",    label: "Chauffage",    icon: "flame-outline" },
  { id: "serrurerie",   label: "Serrurerie",   icon: "key-outline" },
  { id: "menuiserie",   label: "Menuiserie",   icon: "hammer-outline" },
  { id: "toiture",      label: "Toiture",      icon: "umbrella-outline" },
  { id: "peinture",     label: "Peinture",     icon: "brush-outline" },
  { id: "nettoyage",    label: "Nettoyage",    icon: "sparkles-outline" },
  { id: "autre",        label: "Autre",        icon: "construct-outline" },
] as const;
type Category = typeof CATEGORIES[number]["id"];

const STATUS_FLOW: RentalInterventionStatus[] = ["new", "scheduled", "in_progress", "completed"];
const STATUS_BG: Record<RentalInterventionStatus, string> = {
  new: "#FEF2F2", assigned: "#FFF7ED", scheduled: "#EFF6FF",
  in_progress: "#F5F3FF", completed: "#F0FDF4", cancelled: "#F8FAFC",
};
const STATUS_NEXT_LABEL: Partial<Record<RentalInterventionStatus, string>> = {
  new: "Planifier", scheduled: "Démarrer", in_progress: "Terminer",
};

const DEVIS_STATUS_COLORS: Record<DevisStatus, string> = {
  none: COLORS.textMuted, requested: "#F59E0B", received: "#8B5CF6", retained: "#16A34A",
};
const DEVIS_STATUS_LABELS: Record<DevisStatus, string> = {
  none: "Aucun devis", requested: "Devis demandés", received: "Devis reçus", retained: "Devis retenu",
};

const SIG_W = Math.min(Dimensions.get("window").width - 48, 360);
const SIG_H = 160;

function safeHaptic() { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
function formatPrice(n: number) { return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }); }
function formatDate(iso: string) { return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }); }

async function openUrl(url: string) {
  if (Platform.OS === "web") { Linking.openURL(url); return; }
  Linking.openURL(url);
}

// ─── Modale Création ──────────────────────────────────────────────────────────

function CreateModal({ visible, onClose, properties }: { visible: boolean; onClose: () => void; properties: PropertyOption[] }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [propertyId, setPropertyId] = useState("");
  const [category, setCategory]     = useState<Category | "">("");
  const [title, setTitle]           = useState("");
  const [description, setDesc]      = useState("");
  const [scheduledDate, setDate]    = useState("");
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (!visible) { setPropertyId(""); setCategory(""); setTitle(""); setDesc(""); setDate(""); }
    if (visible && properties.length === 1) setPropertyId(properties[0].id);
  }, [visible, properties]);

  const handleCreate = async () => {
    if (!propertyId) { Alert.alert("Logement manquant", "Sélectionnez un logement."); return; }
    if (!category) { Alert.alert("Catégorie manquante", "Choisissez une catégorie."); return; }
    if (!title.trim()) { Alert.alert("Titre manquant", "Saisissez un titre."); return; }
    if (!user) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "properties", propertyId, "interventions"), {
        propertyId, landlordId: user.uid,
        status: scheduledDate ? "scheduled" : "new",
        title: title.trim(), description: description.trim(),
        priority: "normal", category,
        scheduledDate: scheduledDate || null,
        devis: [], devisStatus: "none",
        createdBy: user.uid, createdAt: new Date().toISOString(),
      });
      onClose();
    } catch { Alert.alert("Erreur", "Impossible de créer l'intervention."); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]} onPress={onClose} />
        <ScrollView style={[cr.sheet, { paddingBottom: insets.bottom + 20 }]} keyboardShouldPersistTaps="handled">
          <View style={cr.handle} />
          <Text style={cr.title}>Nouvelle intervention</Text>

          {properties.length > 1 && (
            <>
              <Text style={cr.label}>Logement *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {properties.map((p) => (
                    <Pressable key={p.id} style={[cr.chip, propertyId === p.id && cr.chipActive]} onPress={() => setPropertyId(p.id)}>
                      <Text style={[cr.chipText, propertyId === p.id && cr.chipTextActive]}>{p.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </>
          )}

          <Text style={cr.label}>Catégorie *</Text>
          <View style={cr.grid}>
            {CATEGORIES.map((c) => (
              <Pressable key={c.id} style={[cr.catBtn, category === c.id && cr.catBtnActive]} onPress={() => setCategory(c.id)}>
                <Ionicons name={c.icon as any} size={18} color={category === c.id ? COLORS.primary : COLORS.textMuted} />
                <Text style={[cr.catLabel, category === c.id && { color: COLORS.primary }]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={cr.label}>Titre *</Text>
          <TextInput style={cr.input} placeholder="ex : Fuite robinet cuisine" placeholderTextColor={COLORS.textMuted} value={title} onChangeText={setTitle} />

          <Text style={cr.label}>Description</Text>
          <TextInput style={[cr.input, { minHeight: 80, textAlignVertical: "top" }]} placeholder="Détails, accès, contexte…" placeholderTextColor={COLORS.textMuted} value={description} onChangeText={setDesc} multiline numberOfLines={3} />

          <Text style={cr.label}>Date prévue</Text>
          <DateInput style={cr.input} placeholderTextColor={COLORS.textMuted} value={scheduledDate} onChangeText={setDate} />

          <Pressable style={cr.btn} onPress={handleCreate} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={cr.btnText}>Créer l'intervention</Text>}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Modale Détail + Devis ────────────────────────────────────────────────────

function DetailModal({ intervention, onClose, landlordUid }: { intervention: InterventionWithProperty; onClose: () => void; landlordUid: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [saving, setSaving]                   = useState(false);
  const [note, setNote]                       = useState(intervention.report ?? "");
  const [contacts, setContacts]               = useState<ProviderContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [sendingDevis, setSendingDevis]       = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showCompare, setShowCompare]         = useState(false);
  const [retaining, setRetaining]             = useState<string | null>(null);
  const [devis, setDevis]                     = useState<DevisOffer[]>(intervention.devis ?? []);
  const [devisStatus, setDevisStatus]         = useState<DevisStatus>(intervention.devisStatus ?? "none");
  const [selectedDevisId, setSelectedDevisId] = useState<string | undefined>(intervention.selectedDevisId);

  // Signature bailleur
  const [showSign, setShowSign]       = useState(false);
  const [signOffer, setSignOffer]     = useState<DevisOffer | null>(null);
  const [signing, setSigning]         = useState(false);
  const [strokes, setStrokes]         = useState<{x:number;y:number}[][]>([]);
  const [liveStroke, setLiveStroke]   = useState<{x:number;y:number}[]>([]);
  const currentStroke = useRef<{x:number;y:number}[]>([]);
  const strokesRef    = useRef<{x:number;y:number}[][]>([]);
  const [savedSignSvg, setSavedSignSvg]   = useState<string | null>(null);
  const [appliedSaved, setAppliedSaved]   = useState(false);

  // Écoute Firestore pour le devis en temps réel
  useEffect(() => {
    const ref = doc(db, "properties", intervention.propertyId, "interventions", intervention.id);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setDevis(d.devis ?? []);
      setDevisStatus(d.devisStatus ?? "none");
      setSelectedDevisId(d.selectedDevisId);
    });
  }, [intervention.propertyId, intervention.id]);

  // Charger l'annuaire
  useEffect(() => {
    if (!landlordUid) return;
    const q = query(collection(db, "users", landlordUid, "providerContacts"), orderBy("lastName", "asc"));
    return onSnapshot(q, (snap) => {
      setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProviderContact)));
      setContactsLoading(false);
    }, () => setContactsLoading(false));
  }, [landlordUid]);

  const statusCfg = {
    color: RENTAL_INTERVENTION_STATUS_COLORS[intervention.status],
    bg:    STATUS_BG[intervention.status],
    label: RENTAL_INTERVENTION_STATUS_LABELS[intervention.status],
  };
  const nextStatusIdx = STATUS_FLOW.indexOf(intervention.status);
  const nextStatus: RentalInterventionStatus | null =
    nextStatusIdx !== -1 && nextStatusIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[nextStatusIdx + 1] : null;
  const cat = CATEGORIES.find((c) => c.id === (intervention as any).category) ?? CATEGORIES[CATEGORIES.length - 1];

  const submittedDevis = useMemo(() => devis.filter((o) => o.submitted), [devis]);

  // PanResponder signature
  const signPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        currentStroke.current = [{ x, y }]; setLiveStroke([{ x, y }]);
      },
      onPanResponderMove: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        currentStroke.current = [...currentStroke.current, { x, y }]; setLiveStroke([...currentStroke.current]);
      },
      onPanResponderRelease: () => {
        if (currentStroke.current.length > 0) { strokesRef.current = [...strokesRef.current, currentStroke.current]; setStrokes([...strokesRef.current]); }
        setLiveStroke([]); currentStroke.current = [];
      },
      onPanResponderTerminate: () => {
        if (currentStroke.current.length > 0) { strokesRef.current = [...strokesRef.current, currentStroke.current]; setStrokes([...strokesRef.current]); }
        setLiveStroke([]); currentStroke.current = [];
      },
    })
  ).current;

  function ptsToPath(pts: {x:number;y:number}[]): string {
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} l0.1,0.1`;
    return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` + pts.slice(1).map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
  }

  const openSign = async (offer: DevisOffer) => {
    setSignOffer(offer);
    setStrokes([]); strokesRef.current = []; setLiveStroke([]); currentStroke.current = [];
    setAppliedSaved(false); setSavedSignSvg(null);
    try {
      const snap = await getDoc(doc(db, "users", landlordUid));
      const svg = snap.data()?.signatureModelSvg ?? null;
      setSavedSignSvg(svg); if (svg) setAppliedSaved(true);
    } catch {}
    setShowCompare(false);
    setTimeout(() => setShowSign(true), 300);
  };

  const handleSign = useCallback(async () => {
    if (!signOffer || !user) return;
    const currentStrokes = strokesRef.current;
    if (!appliedSaved && currentStrokes.length === 0) { wa("Signature requise", "Dessinez ou appliquez votre signature."); return; }
    setSigning(true);
    try {
      let svgBase64: string;
      if (appliedSaved && savedSignSvg) {
        svgBase64 = btoa(unescape(encodeURIComponent(savedSignSvg)));
      } else {
        const pathsXml = currentStrokes.map((pts) => `<path d="${ptsToPath(pts)}" stroke="#1E293B" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIG_W}" height="${SIG_H}" viewBox="0 0 ${SIG_W} ${SIG_H}">${pathsXml}</svg>`;
        svgBase64 = btoa(unescape(encodeURIComponent(svgStr)));
      }
      const idToken = await user.getIdToken();
      const res = await fetch(`${getApiUrl().replace(/\/$/, "")}/api/rental/devis/landlord-sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ propertyId: intervention.propertyId, interventionId: intervention.id, offerId: signOffer.id, svgBase64 }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur serveur");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowSign(false);
    } catch (e: any) { wa("Erreur", e.message ?? "Impossible de signer."); }
    finally { setSigning(false); }
  }, [signOffer, appliedSaved, savedSignSvg, user, intervention]);

  const save = async (newStatus?: RentalInterventionStatus) => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = { report: note.trim() || null, updatedAt: new Date().toISOString() };
      if (newStatus) { updates.status = newStatus; if (newStatus === "completed") updates.completedDate = new Date().toISOString(); }
      await updateDoc(doc(db, "properties", intervention.propertyId, "interventions", intervention.id), updates);
      onClose();
    } catch { Alert.alert("Erreur", "Impossible de sauvegarder."); }
    finally { setSaving(false); }
  };

  const handleCancel = () => {
    wConfirm("Annuler l'intervention ?", "Cette action est irréversible.", () => save("cancelled"), "Oui, annuler");
  };

  const handleSendDevis = useCallback(async () => {
    if (selectedContactIds.length === 0) return;
    setSendingDevis(true);
    try {
      const idToken = await user?.getIdToken();
      const res = await fetch(`${getApiUrl().replace(/\/$/, "")}/api/rental/devis/send-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ propertyId: intervention.propertyId, interventionId: intervention.id, contactIds: selectedContactIds }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur serveur");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowContactPicker(false); setSelectedContactIds([]);
    } catch (e: any) { wa("Erreur", e.message ?? "Impossible d'envoyer les demandes."); }
    finally { setSendingDevis(false); }
  }, [selectedContactIds, user, intervention]);

  const handleRetain = (offer: DevisOffer) => {
    wConfirm(
      "Retenir ce devis ?",
      `Retenir le devis de ${offer.contactName} (${offer.priceTTC !== undefined ? formatPrice(offer.priceTTC) : "—"}) ? Un email lui sera envoyé pour signer le bon pour accord.`,
      async () => {
        setRetaining(offer.id);
        try {
          const idToken = await user?.getIdToken();
          const res = await fetch(`${getApiUrl().replace(/\/$/, "")}/api/rental/devis/retain`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ propertyId: intervention.propertyId, interventionId: intervention.id, offerId: offer.id }),
          });
          if (!res.ok) throw new Error((await res.json()).error ?? "Erreur");
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e: any) { wa("Erreur", e.message); }
        finally { setRetaining(null); }
      },
      "Retenir",
    );
  };

  const toggleContact = (id: string) => {
    setSelectedContactIds((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : prev.length < 3 ? [...prev, id] : prev);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <View style={[dt.root, { paddingTop: insets.top + 16 }]}>
        {/* Header */}
        <View style={dt.header}>
          <Pressable onPress={onClose} style={dt.closeBtn}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={dt.headerTitle} numberOfLines={1}>{intervention.title}</Text>
            {intervention.propertyLabel && <Text style={dt.headerSub} numberOfLines={1}>{intervention.propertyLabel}</Text>}
          </View>
          <View style={[dt.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Text style={[dt.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={[dt.body, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">

          {/* Catégorie + description */}
          <View style={dt.catRow}>
            <View style={[dt.catIcon, { backgroundColor: statusCfg.bg }]}>
              <Ionicons name={cat.icon as any} size={18} color={statusCfg.color} />
            </View>
            <Text style={dt.catLabel}>{cat.label}</Text>
            {intervention.scheduledDate && (
              <View style={dt.dateChip}>
                <Ionicons name="calendar-outline" size={12} color={COLORS.textMuted} />
                <Text style={dt.dateChipText}>{intervention.scheduledDate}</Text>
              </View>
            )}
          </View>

          {!!intervention.description && <Text style={dt.desc}>{intervention.description}</Text>}

          {/* ── Section Devis ─────────────────────────────────── */}
          <View style={dt.section}>
            <View style={dt.sectionHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={dt.sectionTitle}>Devis</Text>
                <View style={[dt.devStatBadge, { backgroundColor: DEVIS_STATUS_COLORS[devisStatus] + "20" }]}>
                  <Text style={[dt.devStatText, { color: DEVIS_STATUS_COLORS[devisStatus] }]}>{DEVIS_STATUS_LABELS[devisStatus]}</Text>
                </View>
              </View>
              <Pressable style={dt.sectionBtn} onPress={() => { safeHaptic(); setShowContactPicker(true); }}>
                <Ionicons name="paper-plane-outline" size={14} color={COLORS.primary} />
                <Text style={dt.sectionBtnText}>{devisStatus === "none" ? "Demander" : "Modifier"}</Text>
              </Pressable>
            </View>

            {devis.length === 0 ? (
              <View style={dt.devisEmpty}>
                <Ionicons name="document-text-outline" size={28} color={COLORS.textMuted} />
                <Text style={dt.devisEmptyText}>Aucun devis demandé</Text>
                <Text style={dt.devisEmptySub}>Sélectionnez des professionnels de votre annuaire</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {devis.map((o) => {
                  const isRetained = selectedDevisId === o.id;
                  return (
                    <View key={o.id} style={[dt.devisCard, isRetained && dt.devisCardRetained]}>
                      <View style={dt.devisCardTop}>
                        <View style={dt.devisAvatar}>
                          <Text style={dt.devisAvatarText}>{(o.contactName[0] ?? "").toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={dt.devisName}>{o.contactName}</Text>
                          {!!o.contactCompany && <Text style={dt.devisCompany}>{o.contactCompany}</Text>}
                        </View>
                        {isRetained && (
                          <View style={dt.retainedBadge}>
                            <Ionicons name="trophy" size={11} color="#D97706" />
                            <Text style={dt.retainedBadgeText}>Retenu</Text>
                          </View>
                        )}
                        {!o.submitted && <View style={dt.pendingBadge}><Text style={dt.pendingBadgeText}>En attente</Text></View>}
                      </View>

                      {o.submitted && (
                        <>
                          <Text style={dt.devisPrice}>
                            {o.priceTTC !== undefined ? formatPrice(o.priceTTC) : "—"}{" "}
                            <Text style={dt.devisPriceTtc}>TTC</Text>
                          </Text>
                          {!!o.description && <Text style={dt.devisDesc}>{o.description}</Text>}
                          <View style={dt.devisActions}>
                            {!!o.devisFileUrl && (
                              <Pressable style={dt.devisFileBtn} onPress={() => openUrl(o.devisFileUrl!)}>
                                <Ionicons name="share-outline" size={14} color={COLORS.primary} />
                                <Text style={dt.devisFileBtnText}>Ouvrir le devis</Text>
                              </Pressable>
                            )}
                            {isRetained && !!o.signatureToken && (
                              <Pressable style={dt.devisFileBtn} onPress={() => openUrl(`${getApiUrl().replace(/\/$/, "")}/bon-de-commande-rental/${o.signatureToken}`)}>
                                <Ionicons name="document-text" size={14} color="#D97706" />
                                <Text style={[dt.devisFileBtnText, { color: "#D97706" }]}>Bon pour accord</Text>
                              </Pressable>
                            )}
                            {isRetained && o.signedAt && !o.landlordSignedAt && (
                              <Pressable style={[dt.devisFileBtn, { backgroundColor: "#8B5CF620", borderColor: "#8B5CF6" }]} onPress={() => openSign(o)}>
                                <Ionicons name="create-outline" size={14} color="#8B5CF6" />
                                <Text style={[dt.devisFileBtnText, { color: "#8B5CF6" }]}>Signer (bailleur)</Text>
                              </Pressable>
                            )}
                            {isRetained && o.signedAt && o.landlordSignedAt && (
                              <View style={dt.signedBadge}>
                                <Ionicons name="checkmark-done" size={12} color="#16A34A" />
                                <Text style={dt.signedBadgeText}>Double signature ✓</Text>
                              </View>
                            )}
                            {!isRetained && (
                              <Pressable
                                style={[dt.retainBtn, !!retaining && { opacity: 0.6 }]}
                                onPress={() => { safeHaptic(); handleRetain(o); }}
                                disabled={!!retaining}
                              >
                                {retaining === o.id
                                  ? <ActivityIndicator size="small" color="#fff" />
                                  : <><Ionicons name="checkmark-circle-outline" size={14} color="#fff" /><Text style={dt.retainBtnText}>Retenir ce devis</Text></>}
                              </Pressable>
                            )}
                          </View>
                          {/* Statuts signature */}
                          {isRetained && !o.signedAt && (
                            <View style={dt.sigPendingRow}>
                              <Ionicons name="time-outline" size={12} color="#D97706" />
                              <Text style={dt.sigPendingText}>En attente de signature du prestataire</Text>
                            </View>
                          )}
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* ── Rapport ────────────────────────────────────────── */}
          <View style={dt.section}>
            <Text style={dt.sectionTitle}>Rapport</Text>
            <TextInput
              style={dt.noteInput}
              placeholder="Notes, observations, travaux effectués…"
              placeholderTextColor={COLORS.textMuted}
              value={note} onChangeText={setNote}
              multiline numberOfLines={4}
            />
          </View>

          {/* ── Actions statut ─────────────────────────────────── */}
          <View style={{ gap: 10 }}>
            <Pressable style={dt.saveBtn} onPress={() => save()} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={dt.saveBtnText}>Enregistrer</Text>}
            </Pressable>
            {nextStatus && (
              <Pressable
                style={[dt.nextBtn, { borderColor: RENTAL_INTERVENTION_STATUS_COLORS[nextStatus] }]}
                onPress={() => save(nextStatus)} disabled={saving}
              >
                <Text style={[dt.nextBtnText, { color: RENTAL_INTERVENTION_STATUS_COLORS[nextStatus] }]}>
                  {STATUS_NEXT_LABEL[intervention.status]}
                </Text>
              </Pressable>
            )}
            {intervention.status !== "cancelled" && intervention.status !== "completed" && (
              <Pressable style={dt.cancelBtn} onPress={handleCancel} disabled={saving}>
                <Text style={dt.cancelBtnText}>Annuler l'intervention</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </View>

      {/* ── Modal sélection contacts ─────────────────────────────────────────── */}
      <Modal visible={showContactPicker} animationType="slide" presentationStyle="pageSheet">
        <View style={[dt.root, { paddingTop: insets.top + 16 }]}>
          <View style={dt.header}>
            <Pressable onPress={() => { setShowContactPicker(false); setSelectedContactIds([]); }}>
              <Text style={dt.cancelText}>Annuler</Text>
            </Pressable>
            <Text style={[dt.headerTitle, { flex: 0 }]}>Demander des devis</Text>
            <Pressable onPress={handleSendDevis} disabled={sendingDevis || selectedContactIds.length === 0}>
              {sendingDevis
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Text style={[dt.sendText, selectedContactIds.length === 0 && { opacity: 0.4 }]}>Envoyer ({selectedContactIds.length}/3)</Text>}
            </Pressable>
          </View>

          <Text style={dt.pickerHint}>
            Sélectionnez jusqu'à 3 professionnels. Ils recevront un email avec un lien pour soumettre leur devis.
          </Text>

          {contactsLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} />
          ) : contacts.length === 0 ? (
            <View style={dt.pickerEmpty}>
              <Ionicons name="people-outline" size={40} color={COLORS.textMuted} />
              <Text style={dt.pickerEmptyText}>Aucun contact dans votre annuaire</Text>
              <Text style={dt.pickerEmptySub}>Ajoutez des professionnels dans l'onglet "Professionnels"</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }}>
              {contacts.map((c) => {
                const sel = selectedContactIds.includes(c.id);
                const alreadySent = devis.some((o) => o.contactId === c.id && o.submitted);
                return (
                  <Pressable key={c.id} style={[dt.contactRow, sel && dt.contactRowSel]} onPress={() => !alreadySent && toggleContact(c.id)}>
                    <View style={[dt.contactAvatar, sel && { backgroundColor: COLORS.primary }]}>
                      <Text style={[dt.contactAvatarText, sel && { color: "#fff" }]}>
                        {(c.firstName[0] ?? "").toUpperCase() + (c.lastName[0] ?? "").toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={dt.contactName}>{c.firstName} {c.lastName}</Text>
                      <Text style={dt.contactInfo}>{[c.specialty, c.company, c.email].filter(Boolean).join(" · ")}</Text>
                      {alreadySent && <Text style={dt.alreadySentText}>Devis déjà reçu ✓</Text>}
                    </View>
                    <View style={[dt.checkbox, sel && dt.checkboxSel]}>
                      {sel && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  </Pressable>
                );
              })}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Modal signature bailleur ────────────────────────────────────────── */}
      <Modal visible={showSign} animationType="slide" presentationStyle="fullScreen">
        <View style={[dt.root, { paddingTop: insets.top + 16 }]}>
          <View style={dt.header}>
            <Pressable onPress={() => { setShowSign(false); setStrokes([]); strokesRef.current = []; setLiveStroke([]); }}>
              <Text style={dt.cancelText}>Annuler</Text>
            </Pressable>
            <Text style={[dt.headerTitle, { flex: 0 }]}>Signature bailleur</Text>
            <Pressable onPress={handleSign} disabled={signing || (!appliedSaved && strokes.length === 0)}>
              {signing
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Text style={[dt.sendText, (!appliedSaved && strokes.length === 0) && { opacity: 0.4 }]}>Valider</Text>}
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, alignItems: "center" }}>
            {signOffer && (
              <View style={dt.signBanner}>
                <Ionicons name="document-text-outline" size={16} color="#7C3AED" />
                <Text style={dt.signBannerText} numberOfLines={3}>
                  Bon pour accord — {intervention.title}{"\n"}
                  <Text style={{ fontFamily: "Inter_700Bold" }}>{signOffer.contactName}</Text>
                  {signOffer.priceTTC !== undefined ? ` · ${formatPrice(signOffer.priceTTC)} TTC` : ""}
                </Text>
              </View>
            )}

            {savedSignSvg && (
              <View style={[dt.savedSigBox, appliedSaved && dt.savedSigBoxActive]}>
                <View style={dt.savedSigHeader}>
                  <Ionicons name="shield-checkmark" size={15} color={appliedSaved ? "#7C3AED" : COLORS.textMuted} />
                  <Text style={[dt.savedSigLabel, appliedSaved && { color: "#7C3AED" }]}>
                    {appliedSaved ? "Signature enregistrée (appliquée)" : "Signature enregistrée"}
                  </Text>
                  <Pressable
                    style={[dt.applySigBtn, appliedSaved && dt.applySigBtnActive]}
                    onPress={() => { setAppliedSaved(!appliedSaved); if (!appliedSaved) { setStrokes([]); strokesRef.current = []; setLiveStroke([]); } }}
                  >
                    <Text style={[dt.applySigBtnText, appliedSaved && { color: "#7C3AED" }]}>
                      {appliedSaved ? "✓ Appliquée" : "Appliquer"}
                    </Text>
                  </Pressable>
                </View>
                <SvgXml xml={savedSignSvg} width={SIG_W} height={100} />
              </View>
            )}

            {(!savedSignSvg || !appliedSaved) && (
              <>
                <Text style={[dt.signHint, { alignSelf: "flex-start", marginTop: savedSignSvg ? 12 : 0 }]}>
                  {savedSignSvg ? "Ou dessinez une nouvelle signature :" : "Signez dans le cadre ci-dessous"}
                </Text>
                <View style={[dt.signCanvas, { width: SIG_W, height: SIG_H }]} pointerEvents="box-only" {...signPanResponder.panHandlers}>
                  <Svg width={SIG_W} height={SIG_H}>
                    {strokes.map((pts, i) => <Path key={i} d={ptsToPath(pts)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
                    {liveStroke.length > 1 && <Path d={ptsToPath(liveStroke)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
                  </Svg>
                </View>
                <Pressable style={dt.clearSignBtn} onPress={() => { setStrokes([]); strokesRef.current = []; setLiveStroke([]); currentStroke.current = []; }}>
                  <Ionicons name="trash-outline" size={14} color={COLORS.textMuted} />
                  <Text style={dt.clearSignBtnText}>Effacer</Text>
                </Pressable>
              </>
            )}

            <Text style={dt.signLegal}>
              En validant, vous apposez votre signature électronique au bon pour accord conformément à l'article 1366 du Code civil.
            </Text>
          </ScrollView>
        </View>
      </Modal>
    </Modal>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function RentalInterventions() {
  const insets = useSafeAreaInsets();
  const paddingTop = Platform.OS === "web" ? 67 + 24 : insets.top + 16;
  const { user } = useAuth();

  const [interventions, setInterventions] = useState<InterventionWithProperty[]>([]);
  const [properties, setProperties]       = useState<PropertyOption[]>([]);
  const [loading, setLoading]             = useState(true);
  const [filter, setFilter]               = useState<"active" | "completed" | "all">("active");
  const [showCreate, setShowCreate]       = useState(false);
  const [selected, setSelected]           = useState<InterventionWithProperty | null>(null);

  const loadData = useCallback(() => {
    if (!user) return;
    let unsubInterventions: (() => void)[] = [];
    const propQ = query(collection(db, "properties"), where("landlordId", "==", user.uid));
    const unsubProps = onSnapshot(propQ, (propSnap) => {
      unsubInterventions.forEach((u) => u());
      unsubInterventions = [];
      const props = propSnap.docs.map((d) => ({ ...(d.data() as RentalProperty), id: d.id }));
      setProperties(props.map((p) => ({ id: p.id, label: [p.address, p.city].filter(Boolean).join(", ") })));
      if (props.length === 0) { setInterventions([]); setLoading(false); return; }
      const intMap = new Map<string, InterventionWithProperty[]>();
      let resolved = 0;
      props.forEach((prop) => {
        const propLabel = [prop.address, prop.city].filter(Boolean).join(", ");
        const unsub = onSnapshot(
          query(collection(db, "properties", prop.id, "interventions"), orderBy("createdAt", "desc")),
          (snap) => {
            intMap.set(prop.id, snap.docs.map((d) => ({ id: d.id, ...(d.data() as any), propertyLabel: propLabel })));
            const all = Array.from(intMap.values()).flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            setInterventions(all);
            resolved++; if (resolved >= props.length) setLoading(false);
          }
        );
        unsubInterventions.push(unsub);
      });
    });
    return () => { unsubProps(); unsubInterventions.forEach((u) => u()); };
  }, [user]);

  useEffect(() => { const unsub = loadData(); return unsub; }, [loadData]);

  const filtered = interventions.filter((i) => {
    if (filter === "active")    return i.status !== "completed" && i.status !== "cancelled";
    if (filter === "completed") return i.status === "completed" || i.status === "cancelled";
    return true;
  });
  const activeCount = interventions.filter((i) => i.status !== "completed" && i.status !== "cancelled").length;

  return (
    <View style={[s.root, { paddingTop }]}>
      <View style={s.header}>
        <HamburgerButton />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={s.title}>Interventions</Text>
          <Text style={s.subtitle}>
            {loading ? "Chargement…" : `${activeCount} en cours · ${interventions.length} total`}
          </Text>
        </View>
        <Pressable style={s.addBtn} onPress={() => setShowCreate(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={s.filterBar}>
        {(["active", "completed", "all"] as const).map((f) => (
          <Pressable key={f} style={[s.filterTab, filter === f && s.filterTabActive]} onPress={() => setFilter(f)}>
            <Text style={[s.filterTabText, filter === f && s.filterTabTextActive]}>
              {f === "active" ? "En cours" : f === "completed" ? "Terminées" : "Tout"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="construct-outline" size={56} color={COLORS.textMuted} style={{ opacity: 0.4 }} />
          <Text style={s.emptyTitle}>{interventions.length === 0 ? "Aucune intervention" : "Aucun résultat"}</Text>
          <Text style={s.emptyDesc}>
            {interventions.length === 0 ? "Planifiez vos interventions et gérez les devis." : "Essayez un autre filtre."}
          </Text>
          {interventions.length === 0 && (
            <Pressable style={s.ctaBtn} onPress={() => setShowCreate(true)}>
              <Text style={s.ctaBtnText}>Créer une intervention</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 40 }}>
          {filtered.map((item) => {
            const color = RENTAL_INTERVENTION_STATUS_COLORS[item.status];
            const bg    = STATUS_BG[item.status];
            const label = RENTAL_INTERVENTION_STATUS_LABELS[item.status];
            const cat   = CATEGORIES.find((c) => c.id === (item as any).category) ?? CATEGORIES[CATEGORIES.length - 1];
            const dStat = (item as any).devisStatus as DevisStatus | undefined;

            return (
              <Pressable key={item.id} style={s.card} onPress={() => setSelected(item)}>
                <View style={[s.catDot, { backgroundColor: bg }]}>
                  <Ionicons name={cat.icon as any} size={18} color={color} />
                </View>
                <View style={s.cardBody}>
                  <View style={s.cardTop}>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <View style={[s.statusBadge, { backgroundColor: bg }]}>
                      <Text style={[s.statusText, { color }]}>{label}</Text>
                    </View>
                  </View>
                  {item.propertyLabel && <Text style={s.cardProp} numberOfLines={1}><Ionicons name="home-outline" size={11} color={COLORS.textMuted} /> {item.propertyLabel}</Text>}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                    {item.scheduledDate
                      ? <Text style={s.cardDate}><Ionicons name="calendar-outline" size={11} color={COLORS.textMuted} /> {item.scheduledDate}</Text>
                      : <Text style={s.cardDate}>{new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</Text>
                    }
                    {dStat && dStat !== "none" && (
                      <View style={[s.devisChip, { backgroundColor: DEVIS_STATUS_COLORS[dStat] + "20" }]}>
                        <Text style={[s.devisChipText, { color: DEVIS_STATUS_COLORS[dStat] }]}>{DEVIS_STATUS_LABELS[dStat]}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <CreateModal visible={showCreate} onClose={() => setShowCreate(false)} properties={properties} />
      {selected && (
        <DetailModal intervention={selected} onClose={() => setSelected(null)} landlordUid={user?.uid ?? ""} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title:    { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  addBtn:   { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  filterBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterTab:         { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#F8F8F8" },
  filterTabActive:   { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterTabText:     { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  filterTabTextActive: { color: "#fff" },
  list: { flex: 1 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 14, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  catDot:  { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, gap: 3 },
  cardTop:  { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text, flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusText:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  cardProp: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  cardDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  devisChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  devisChipText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "center" },
  emptyDesc:  { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 },
  ctaBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  ctaBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

const cr = StyleSheet.create({
  sheet: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12, maxHeight: "92%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: "center", marginBottom: 16 },
  title:  { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 20 },
  label:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 6 },
  input:  { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, backgroundColor: "#FAFAFA", marginBottom: 16 },
  grid:   { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  catBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#F8F8F8" },
  catBtnActive: { borderColor: COLORS.primary, backgroundColor: "#EEF2FF" },
  catLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  chip:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#F8F8F8" },
  chipActive: { borderColor: COLORS.primary, backgroundColor: "#EEF2FF" },
  chipText:       { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.primary },
  btn:     { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

const dt = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  closeBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  body: { padding: 16, gap: 20 },

  catRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  catIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  catLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.textSecondary, flex: 1 },
  dateChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.background, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  dateChipText: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, lineHeight: 22, backgroundColor: COLORS.background, borderRadius: 10, padding: 14 },

  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text },
  sectionBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: COLORS.primary + "12", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  sectionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  devStatBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  devStatText:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  devisEmpty: { alignItems: "center", paddingVertical: 24, gap: 6, backgroundColor: COLORS.background, borderRadius: 12 },
  devisEmptyText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  devisEmptySub: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  devisCard: { backgroundColor: COLORS.background, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  devisCardRetained: { borderColor: "#D97706", borderWidth: 1.5, backgroundColor: "#FFFBEB" },
  devisCardTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  devisAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary + "20", alignItems: "center", justifyContent: "center" },
  devisAvatarText: { fontSize: 13, fontFamily: "Inter_700Bold", color: COLORS.primary },
  devisName:     { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  devisCompany:  { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  devisPrice:    { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 4 },
  devisPriceTtc: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  devisDesc:     { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginBottom: 8 },
  devisActions:  { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  devisFileBtn:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: COLORS.primary + "50", backgroundColor: COLORS.primary + "0D" },
  devisFileBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.primary },

  retainedBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  retainedBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#D97706" },
  pendingBadge: { backgroundColor: COLORS.background, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  pendingBadgeText: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  retainBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#16A34A", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, flex: 1 },
  retainBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  signedBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#DCFCE7", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  signedBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#16A34A" },
  sigPendingRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  sigPendingText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#D97706" },

  noteInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, minHeight: 80, textAlignVertical: "top" },
  saveBtn:   { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  nextBtn:   { borderRadius: 12, borderWidth: 1.5, paddingVertical: 13, alignItems: "center" },
  nextBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cancelBtn: { borderRadius: 12, borderWidth: 1, borderColor: "#EF4444", paddingVertical: 13, alignItems: "center" },
  cancelBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#EF4444" },

  cancelText: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  sendText:   { fontSize: 15, color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  pickerHint: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular", margin: 16, lineHeight: 18 },
  pickerEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
  pickerEmptyText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "center" },
  pickerEmptySub:  { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  contactRowSel: { backgroundColor: COLORS.primary + "08" },
  contactAvatar:     { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border },
  contactAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  contactName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  contactInfo: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  alreadySentText: { fontSize: 11, color: "#16A34A", fontFamily: "Inter_500Medium", marginTop: 2 },
  checkbox:    { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  checkboxSel: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },

  signBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#F5F3FF", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#DDD6FE", width: "100%", marginBottom: 20 },
  signBannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#5B21B6", lineHeight: 18 },
  signHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginBottom: 10 },
  signCanvas: { borderWidth: 2, borderColor: COLORS.border, borderRadius: 12, backgroundColor: "#FAFAFA", overflow: "hidden" },
  clearSignBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background, alignSelf: "flex-end" },
  clearSignBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  signLegal: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center", lineHeight: 15, marginTop: 20, paddingHorizontal: 8 },
  savedSigBox: { width: "100%", borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background, overflow: "hidden", marginBottom: 4 },
  savedSigBoxActive: { borderColor: "#7C3AED", backgroundColor: "#F5F3FF" },
  savedSigHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  savedSigLabel: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  applySigBtn:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border },
  applySigBtnActive: { backgroundColor: "#EDE9FE", borderColor: "#7C3AED" },
  applySigBtnText:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
});

// ptsToPath helper (exposé pour le composant Modal)
function ptsToPath(pts: {x:number;y:number}[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} l0.1,0.1`;
  return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` + pts.slice(1).map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
}
