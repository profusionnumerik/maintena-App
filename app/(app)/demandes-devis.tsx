import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, Linking, Modal, PanResponder,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Path, Svg, SvgXml } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  addDoc, collection, doc, getDoc, onSnapshot, orderBy,
  query, updateDoc, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { wa, wConfirm } from "@/shared/dialogs";
import {
  ALL_CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS, Category,
  DemandeDevis, DemandeDevisStatus, DevisOffer, ProviderContact,
} from "@/shared/types";
import { getApiUrl } from "@/lib/query-client";

function safeHaptic() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

async function openOrShareDevis(url: string, contactName: string) {
  if (Platform.OS === "web") {
    Linking.openURL(url);
    return;
  }
  try {
    const ext = url.includes(".pdf") ? "pdf" : url.includes(".png") ? "png" : url.includes(".webp") ? "webp" : "jpg";
    const safeName = contactName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const localUri = FileSystem.cacheDirectory + `devis_${safeName}.${ext}`;
    const { uri } = await FileSystem.downloadAsync(url, localUri);
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: ext === "pdf" ? "application/pdf" : "image/*",
        dialogTitle: `Devis — ${contactName}`,
        UTI: ext === "pdf" ? "com.adobe.pdf" : "public.image",
      });
    } else {
      Linking.openURL(url);
    }
  } catch {
    Linking.openURL(url);
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatPrice(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

type Point = { x: number; y: number };

function pointsToSvgPath(pts: Point[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} l0.1,0.1`;
  return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` +
    pts.slice(1).map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
}

const SIG_W = Math.min(Dimensions.get("window").width - 48, 360);
const SIG_H = 160;

const STATUS_LABELS: Record<DemandeDevisStatus, string> = {
  open: "En attente",
  devis_demandes: "Devis demandés",
  devis_recus: "Devis reçus",
  cloture: "Clôturé",
};

const STATUS_COLORS: Record<DemandeDevisStatus, string> = {
  open: "#F59E0B",
  devis_demandes: "#3B82F6",
  devis_recus: "#8B5CF6",
  cloture: "#10B981",
};

const EMPTY_FORM = { title: "", description: "", category: "divers" as Category, urgency: "normal" as "normal" | "urgent" };

export default function DemandesDevisScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { currentCopro, currentRole, members } = useCoPro();

  const isAdmin = currentRole === "admin";
  const isConseil = currentRole === "conseil";
  const canManage = isAdmin || isConseil;

  // Active tab (admin only)
  type Tab = "open" | "devis_demandes" | "devis_recus" | "cloture";
  const [tab, setTab] = useState<Tab>("open");

  // Demandes
  const [demandes, setDemandes] = useState<DemandeDevis[]>([]);
  const [loading, setLoading] = useState(true);

  // Annuaire (for forwarding)
  const [contacts, setContacts] = useState<ProviderContact[]>([]);

  // Modals
  const [createModal, setCreateModal] = useState(false);
  const [forwardModal, setForwardModal] = useState(false);
  const [compareModal, setCompareModal] = useState(false);
  const [selectedDemande, setSelectedDemande] = useState<DemandeDevis | null>(null);

  // Create form
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Forward: selected contacts
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [forwarding, setForwarding] = useState(false);

  // Admin signature pad
  const [adminSignVisible, setAdminSignVisible] = useState(false);
  const [adminSignOffer, setAdminSignOffer] = useState<DevisOffer | null>(null);
  const [adminSignDemande, setAdminSignDemande] = useState<DemandeDevis | null>(null);
  const [adminSigning, setAdminSigning] = useState(false);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [liveStroke, setLiveStroke] = useState<Point[]>([]);
  const currentStroke = useRef<Point[]>([]);
  const strokesRef = useRef<Point[][]>([]);
  // Modèle de signature sauvegardé
  const [savedSignUrl, setSavedSignUrl] = useState<string | null>(null);
  const [savedSignSvg, setSavedSignSvg] = useState<string | null>(null);
  const [appliedSaved, setAppliedSaved] = useState(false);

  const adminPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        currentStroke.current = [{ x, y }];
        setLiveStroke([{ x, y }]);
      },
      onPanResponderMove: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        currentStroke.current = [...currentStroke.current, { x, y }];
        setLiveStroke([...currentStroke.current]);
      },
      onPanResponderRelease: () => {
        if (currentStroke.current.length > 0) {
          strokesRef.current = [...strokesRef.current, currentStroke.current];
          setStrokes([...strokesRef.current]);
        }
        setLiveStroke([]);
        currentStroke.current = [];
      },
      onPanResponderTerminate: () => {
        if (currentStroke.current.length > 0) {
          strokesRef.current = [...strokesRef.current, currentStroke.current];
          setStrokes([...strokesRef.current]);
        }
        setLiveStroke([]);
        currentStroke.current = [];
      },
    })
  ).current;

  // Subscribe to demandesDevis
  useEffect(() => {
    if (!currentCopro?.id) return;
    const q = query(
      collection(db, "copros", currentCopro.id, "demandesDevis"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setDemandes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DemandeDevis)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [currentCopro?.id]);

  // Subscribe to providerContacts for admin forwarding
  useEffect(() => {
    if (!currentCopro?.id || !canManage) return;
    const q = query(
      collection(db, "copros", currentCopro.id, "providerContacts"),
      orderBy("lastName", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProviderContact)));
    });
    return unsub;
  }, [currentCopro?.id, canManage]);

  // Filtered by tab (admin) or by creator (propriétaire)
  const filtered = useMemo(() => {
    if (canManage) return demandes.filter((d) => d.status === tab);
    return demandes.filter((d) => d.createdBy === user?.uid);
  }, [demandes, tab, canManage, user?.uid]);

  // Create ticket
  const handleCreate = useCallback(async () => {
    if (!currentCopro?.id || !user) return;
    if (!form.title.trim()) { wa("Erreur", "Titre requis."); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, "copros", currentCopro.id, "demandesDevis"), {
        coProId: currentCopro.id,
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        urgency: form.urgency,
        createdBy: user.uid,
        createdByName: user.displayName ?? user.email ?? "Inconnu",
        createdAt: new Date().toISOString(),
        status: "open",
        devis: [],
      });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCreateModal(false);
      setForm({ ...EMPTY_FORM });
    } catch { wa("Erreur", "Impossible d'enregistrer la demande."); }
    finally { setSaving(false); }
  }, [form, currentCopro?.id, user]);

  // Admin: forward to prestataires
  const handleForward = useCallback(async () => {
    if (!selectedDemande || !currentCopro?.id || selectedContacts.length === 0) return;
    if (selectedContacts.length > 3) { wa("Limite", "Maximum 3 prestataires par demande."); return; }
    setForwarding(true);
    try {
      const idToken = await user?.getIdToken();
      const apiBase = getApiUrl().replace(/\/$/, "");
      const res = await fetch(`${apiBase}/api/demande-devis/send-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          coProId: currentCopro.id,
          demandeId: selectedDemande.id,
          contactIds: selectedContacts,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur serveur");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setForwardModal(false);
      setSelectedContacts([]);
      setSelectedDemande(null);
    } catch (e: any) { wa("Erreur", e.message ?? "Impossible d'envoyer les demandes."); }
    finally { setForwarding(false); }
  }, [selectedDemande, selectedContacts, currentCopro?.id, user]);

  // Admin: select winning devis
  const handleSelectDevis = useCallback(async (demande: DemandeDevis, offerId: string, contactName: string) => {
    const isChange = demande.status === "cloture";
    wConfirm(
      isChange ? "Changer le devis retenu" : "Retenir ce devis",
      isChange
        ? `Basculer sur le devis de ${contactName} ? Un email de notification lui sera envoyé pour signature.`
        : `Retenir le devis de ${contactName} ? Un email lui sera envoyé pour signer le bon de commande.`,
      async () => {
        try {
          const idToken = await user?.getIdToken();
          const apiBase = getApiUrl().replace(/\/$/, "");
          const res = await fetch(`${apiBase}/api/demande-devis/retain`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ coProId: demande.coProId, demandeId: demande.id, offerId }),
          });
          if (!res.ok) throw new Error((await res.json()).error ?? "Erreur serveur");
          setCompareModal(false);
          setSelectedDemande(null);
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e: any) { wa("Erreur", e.message ?? "Impossible de valider le devis."); }
      },
      isChange ? "Changer" : "Retenir"
    );
  }, [user]);

  const openForward = (d: DemandeDevis) => {
    setSelectedDemande(d);
    setSelectedContacts(d.devis.map((o) => o.contactId));
    setForwardModal(true);
  };

  const openCompare = (d: DemandeDevis) => {
    setSelectedDemande(d);
    setCompareModal(true);
  };

  const openAdminSign = async (demande: DemandeDevis, offer: DevisOffer) => {
    setAdminSignDemande(demande);
    setAdminSignOffer(offer);
    setStrokes([]); strokesRef.current = [];
    setLiveStroke([]);
    setAppliedSaved(false);
    setSavedSignUrl(null);
    setSavedSignSvg(null);
    currentStroke.current = [];
    // Charger le modèle de signature sauvegardé
    if (user?.uid) {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const url = snap.data()?.signatureModelUrl ?? null;
        const svg = snap.data()?.signatureModelSvg ?? null;
        setSavedSignUrl(url);
        setSavedSignSvg(svg);
        if (svg || url) setAppliedSaved(true);
      } catch { /* ignore */ }
    }
    setAdminSignVisible(true);
  };

  const handleAdminSign = useCallback(async () => {
    if (!adminSignDemande || !adminSignOffer || !currentCopro?.id) return;
    // Lire depuis strokesRef pour éviter la closure périmée
    const currentStrokes = strokesRef.current;
    if (!appliedSaved && currentStrokes.length === 0) { wa("Signature requise", "Appliquez votre modèle ou dessinez une signature."); return; }
    setAdminSigning(true);
    try {
      let svgBase64: string;
      if (appliedSaved && (savedSignSvg || savedSignUrl)) {
        if (savedSignSvg) {
          // SVG stocké dans Firestore — pas besoin de réseau
          svgBase64 = btoa(unescape(encodeURIComponent(savedSignSvg)));
        } else {
          // Fallback : fetch depuis Storage
          const res = await fetch(savedSignUrl!);
          const svgText = await res.text();
          svgBase64 = btoa(unescape(encodeURIComponent(svgText)));
        }
      } else {
        const pathsXml = currentStrokes
          .map((pts) => `<path d="${pointsToSvgPath(pts)}" stroke="#1E293B" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
          .join("");
        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIG_W}" height="${SIG_H}" viewBox="0 0 ${SIG_W} ${SIG_H}">${pathsXml}</svg>`;
        svgBase64 = btoa(unescape(encodeURIComponent(svgStr)));
      }
      const idToken = await user?.getIdToken();
      const apiBase = getApiUrl().replace(/\/$/, "");
      const res = await fetch(`${apiBase}/api/demande-devis/admin-sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          coProId: currentCopro.id,
          demandeId: adminSignDemande.id,
          offerId: adminSignOffer.id,
          svgBase64,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur serveur");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdminSignVisible(false);
      setAdminSignOffer(null);
      setAdminSignDemande(null);
    } catch (e: any) {
      wa("Erreur", e.message ?? "Impossible d'enregistrer la signature.");
    } finally {
      setAdminSigning(false);
    }
  }, [strokes, adminSignDemande, adminSignOffer, currentCopro?.id, user, appliedSaved, savedSignSvg, savedSignUrl]);

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  };

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "open", label: "Nouveaux", count: demandes.filter((d) => d.status === "open").length },
    { key: "devis_demandes", label: "Envoyés", count: demandes.filter((d) => d.status === "devis_demandes").length },
    { key: "devis_recus", label: "Reçus", count: demandes.filter((d) => d.status === "devis_recus").length },
    { key: "cloture", label: "Clôturés", count: demandes.filter((d) => d.status === "cloture").length },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Demandes de devis</Text>
          <Text style={styles.headerSub}>{currentCopro?.name}</Text>
        </View>
        <Pressable style={styles.addBtn} onPress={() => { safeHaptic(); setCreateModal(true); }}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Tabs (admin/conseil only) */}
      {canManage && (
        <View style={styles.tabsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsContent}
          >
            {TABS.map((t) => (
              <Pressable key={t.key} style={[styles.tabChip, tab === t.key && styles.tabChipActive]} onPress={() => setTab(t.key)}>
                <Text style={[styles.tabChipText, tab === t.key && styles.tabChipTextActive]}>{t.label}</Text>
                {t.count > 0 && (
                  <View style={[styles.tabBadge, tab === t.key && styles.tabBadgeActive]}>
                    <Text style={[styles.tabBadgeText, tab === t.key && styles.tabBadgeTextActive]}>{t.count}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={COLORS.primary} />
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}>
          {/* Header propriétaire */}
          {!canManage && (
            <View style={styles.propInfoCard}>
              <Ionicons name="information-circle-outline" size={18} color="#0891B2" />
              <Text style={styles.propInfoText}>
                Créez une demande pour que le syndic puisse solliciter des devis auprès des prestataires.
              </Text>
            </View>
          )}

          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={44} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>Aucune demande dans cet onglet</Text>
              <Pressable style={styles.emptyBtn} onPress={() => { safeHaptic(); setCreateModal(true); }}>
                <Text style={styles.emptyBtnText}>Créer une demande</Text>
              </Pressable>
            </View>
          ) : (
            filtered.map((d) => {
              const submittedDevis = d.devis.filter((o) => o.submitted);
              const minPrice = submittedDevis.length > 0
                ? Math.min(...submittedDevis.map((o) => o.priceTTC ?? Infinity))
                : null;
              return (
                <View key={d.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[d.status] + "20" }]}>
                      <Text style={[styles.statusText, { color: STATUS_COLORS[d.status] }]}>
                        {STATUS_LABELS[d.status]}
                      </Text>
                    </View>
                    {d.urgency === "urgent" && (
                      <View style={styles.urgentBadge}>
                        <Ionicons name="flash" size={11} color="#DC2626" />
                        <Text style={styles.urgentText}>Urgent</Text>
                      </View>
                    )}
                    <Text style={styles.cardDate}>{formatDate(d.createdAt)}</Text>
                  </View>

                  <Text style={styles.cardTitle}>{d.title}</Text>
                  <View style={styles.cardMeta}>
                    <Ionicons name={CATEGORY_ICONS[d.category] as any} size={13} color={COLORS.textMuted} />
                    <Text style={styles.cardMetaText}>{CATEGORY_LABELS[d.category]}</Text>
                    <Text style={styles.cardMetaSep}>·</Text>
                    <Ionicons name="person-outline" size={13} color={COLORS.textMuted} />
                    <Text style={styles.cardMetaText}>{d.createdByName}</Text>
                  </View>
                  {!!d.description && (
                    <Text style={styles.cardDesc} numberOfLines={2}>{d.description}</Text>
                  )}

                  {/* Devis reçus preview */}
                  {d.devis.length > 0 && (
                    <View style={styles.devisPreview}>
                      <Text style={styles.devisPreviewLabel}>
                        {submittedDevis.length}/{d.devis.length} devis reçu{submittedDevis.length > 1 ? "s" : ""}
                        {minPrice !== null ? ` · à partir de ${formatPrice(minPrice)}` : ""}
                      </Text>
                    </View>
                  )}

                  {/* Actions */}
                  {canManage && (
                    <View style={styles.cardActions}>
                      {/* Envoi aux prestataires : admin uniquement */}
                      {isAdmin && (d.status === "open" || d.status === "devis_demandes") && (
                        <Pressable style={styles.actionBtn} onPress={() => openForward(d)}>
                          <Ionicons name="paper-plane-outline" size={15} color={COLORS.primary} />
                          <Text style={styles.actionBtnText}>
                            {d.status === "open" ? "Demander des devis" : "Modifier l'envoi"}
                          </Text>
                        </Pressable>
                      )}
                      {/* Comparaison : admin et conseil peuvent consulter */}
                      {(d.status === "devis_recus" || d.status === "devis_demandes") && submittedDevis.length > 0 && (
                        <Pressable style={[styles.actionBtn, { backgroundColor: "#F5F3FF", borderColor: "#A78BFA" }]} onPress={() => openCompare(d)}>
                          <Ionicons name="stats-chart-outline" size={15} color="#7C3AED" />
                          <Text style={[styles.actionBtnText, { color: "#7C3AED" }]}>Comparer les devis</Text>
                        </Pressable>
                      )}
                      {d.status === "cloture" && (
                        <Pressable style={[styles.actionBtn, { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" }]} onPress={() => openCompare(d)}>
                          <Ionicons name="checkmark-circle-outline" size={15} color="#16A34A" />
                          <Text style={[styles.actionBtnText, { color: "#16A34A" }]}>Voir tous les devis</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ── Modal création (propriétaire) ── */}
      <Modal visible={createModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setCreateModal(false)}>
              <Text style={styles.modalCancel}>Annuler</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Nouvelle demande</Text>
            <Pressable onPress={handleCreate} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.modalSave}>Envoyer</Text>}
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Titre *</Text>
            <TextInput
              style={styles.input}
              value={form.title}
              onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
              placeholder="Ex : Fuite d'eau au sous-sol, Portail en panne…"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
              value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="Détails du problème, localisation, accès…"
              placeholderTextColor={COLORS.textMuted}
              multiline
            />

            <Text style={styles.fieldLabel}>Catégorie</Text>
            <View style={styles.catGrid}>
              {ALL_CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  style={[styles.catChip, form.category === c && { borderColor: COLORS.primary, backgroundColor: COLORS.primary + "15" }]}
                  onPress={() => setForm((f) => ({ ...f, category: c }))}
                >
                  <Ionicons name={CATEGORY_ICONS[c] as any} size={13} color={form.category === c ? COLORS.primary : COLORS.textMuted} />
                  <Text style={[styles.catChipText, form.category === c && { color: COLORS.primary }]}>{CATEGORY_LABELS[c]}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Urgence</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["normal", "urgent"] as const).map((u) => (
                <Pressable
                  key={u}
                  style={[styles.urgencyChip, form.urgency === u && (u === "urgent" ? styles.urgencyChipUrgent : styles.urgencyChipNormal)]}
                  onPress={() => setForm((f) => ({ ...f, urgency: u }))}
                >
                  <Ionicons name={u === "urgent" ? "flash" : "time-outline"} size={14} color={
                    form.urgency === u ? (u === "urgent" ? "#DC2626" : COLORS.primary) : COLORS.textMuted
                  } />
                  <Text style={[styles.urgencyText, form.urgency === u && (u === "urgent" ? { color: "#DC2626" } : { color: COLORS.primary })]}>
                    {u === "urgent" ? "Urgent" : "Normal"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* ── Modal envoi aux prestataires (admin) ── */}
      <Modal visible={forwardModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => { setForwardModal(false); setSelectedContacts([]); }}>
              <Text style={styles.modalCancel}>Annuler</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Demander des devis</Text>
            <Pressable onPress={handleForward} disabled={forwarding || selectedContacts.length === 0}>
              {forwarding
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Text style={[styles.modalSave, selectedContacts.length === 0 && { opacity: 0.4 }]}>
                    Envoyer ({selectedContacts.length}/3)
                  </Text>
              }
            </Pressable>
          </View>

          {selectedDemande && (
            <View style={styles.forwardDemandeBanner}>
              <Text style={styles.forwardDemandeTitle} numberOfLines={1}>{selectedDemande.title}</Text>
              <Text style={styles.forwardDemandeInfo}>
                {CATEGORY_LABELS[selectedDemande.category]} · {selectedDemande.createdByName}
              </Text>
            </View>
          )}

          <Text style={styles.forwardHint}>
            Sélectionnez jusqu'à 3 prestataires. Ils recevront un email avec un lien pour soumettre leur devis.
          </Text>

          {contacts.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={40} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>Aucun prestataire dans l'annuaire</Text>
              <Pressable style={styles.emptyBtn} onPress={() => { setForwardModal(false); router.push("/(app)/annuaire-prestataires" as any); }}>
                <Text style={styles.emptyBtnText}>Aller à l'annuaire</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }}>
              {contacts.map((c) => {
                const selected = selectedContacts.includes(c.id);
                const alreadySent = selectedDemande?.devis.some((o) => o.contactId === c.id && o.submitted) ?? false;
                return (
                  <Pressable
                    key={c.id}
                    style={[styles.contactRow, selected && styles.contactRowSelected]}
                    onPress={() => !alreadySent && toggleContact(c.id)}
                  >
                    <View style={[styles.contactAvatar, selected && { backgroundColor: COLORS.primary }]}>
                      <Text style={[styles.contactAvatarText, selected && { color: "#fff" }]}>
                        {(c.firstName[0] ?? "") + (c.lastName[0] ?? "")}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{c.firstName} {c.lastName}</Text>
                      <Text style={styles.contactInfo}>
                        {[c.specialty, c.company].filter(Boolean).join(" · ")}
                        {c.email ? ` · ${c.email}` : ""}
                      </Text>
                      {alreadySent && <Text style={styles.alreadySentBadge}>Devis déjà reçu ✓</Text>}
                    </View>
                    <View style={[styles.checkbox, selected && styles.checkboxActive]}>
                      {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  </Pressable>
                );
              })}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Modal signature syndic ── */}
      <Modal visible={adminSignVisible} animationType="slide" presentationStyle="fullScreen">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => { setAdminSignVisible(false); setStrokes([]); strokesRef.current = []; setLiveStroke([]); }}>
              <Text style={styles.modalCancel}>Annuler</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Signature syndic</Text>
            <Pressable onPress={handleAdminSign} disabled={adminSigning || (!appliedSaved && strokes.length === 0)}>
              {adminSigning
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Text style={[styles.modalSave, (!appliedSaved && strokes.length === 0) && { opacity: 0.4 }]}>Valider</Text>
              }
            </Pressable>
          </View>

          <View style={[styles.modalBody, { alignItems: "center", paddingBottom: 40 }]}>
            {adminSignDemande && (
              <View style={styles.signInfoBanner}>
                <Ionicons name="document-text-outline" size={16} color="#7C3AED" />
                <Text style={styles.signInfoText} numberOfLines={2}>
                  Bon de commande — {adminSignDemande.title}{"\n"}
                  <Text style={{ fontFamily: "Inter_700Bold" }}>{adminSignOffer?.contactName}</Text>
                  {adminSignOffer?.priceTTC !== undefined
                    ? ` · ${formatPrice(adminSignOffer.priceTTC)} TTC`
                    : ""}
                </Text>
              </View>
            )}

            {/* Modèle sauvegardé */}
            {(savedSignSvg || savedSignUrl) && (
              <View style={[styles.savedSigSection, appliedSaved && styles.savedSigSectionActive]}>
                <View style={styles.savedSigHeader}>
                  <Ionicons name="shield-checkmark" size={15} color={appliedSaved ? "#7C3AED" : COLORS.textMuted} />
                  <Text style={[styles.savedSigLabel, appliedSaved && { color: "#7C3AED" }]}>
                    {appliedSaved ? "Votre signature enregistrée (appliquée)" : "Votre signature enregistrée"}
                  </Text>
                  <Pressable
                    style={[styles.applySigBtn, appliedSaved && styles.applySigBtnActive]}
                    onPress={() => { setAppliedSaved(!appliedSaved); if (!appliedSaved) { setStrokes([]); strokesRef.current = []; setLiveStroke([]); } }}
                  >
                    <Text style={[styles.applySigBtnText, appliedSaved && { color: "#7C3AED" }]}>
                      {appliedSaved ? "✓ Appliquée" : "Appliquer"}
                    </Text>
                  </Pressable>
                </View>
                {savedSignSvg
                  ? <SvgXml xml={savedSignSvg} width={SIG_W} height={100} style={styles.savedSigPreview} />
                  : null
                }
              </View>
            )}

            {/* Pad de dessin (affiché si pas de modèle ou si l'utilisateur veut dessiner) */}
            {(!(savedSignSvg || savedSignUrl) || !appliedSaved) && (
              <>
                <Text style={[styles.signHint, { alignSelf: "flex-start", marginTop: (savedSignSvg || savedSignUrl) ? 12 : 0 }]}>
                  {(savedSignSvg || savedSignUrl) ? "Ou dessinez une nouvelle signature :" : "Signez dans le cadre ci-dessous"}
                </Text>
                <View style={[styles.signCanvas, { width: SIG_W, height: SIG_H }]} pointerEvents="box-only" {...adminPanResponder.panHandlers}>
                  <Svg width={SIG_W} height={SIG_H}>
                    {strokes.map((pts, i) => (
                      <Path key={i} d={pointsToSvgPath(pts)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    ))}
                    {liveStroke.length > 1 && (
                      <Path d={pointsToSvgPath(liveStroke)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </Svg>
                </View>
                <Pressable
                  style={styles.clearSignBtn}
                  onPress={() => { setStrokes([]); strokesRef.current = []; setLiveStroke([]); currentStroke.current = []; }}
                >
                  <Ionicons name="trash-outline" size={15} color={COLORS.textMuted} />
                  <Text style={styles.clearSignBtnText}>Effacer</Text>
                </Pressable>
              </>
            )}

            <Text style={styles.signLegal}>
              En validant, vous apposez votre signature électronique au bon de commande conformément à l'article 1366 du Code civil.
            </Text>
          </View>
        </View>
      </Modal>

      {/* ── Modal comparaison devis ── */}
      <Modal visible={compareModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => { setCompareModal(false); setSelectedDemande(null); }}>
              <Text style={styles.modalCancel}>Fermer</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Comparatif devis</Text>
            <View style={{ width: 60 }} />
          </View>

          {selectedDemande && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
              <Text style={styles.compareDemandeTitle}>{selectedDemande.title}</Text>
              <Text style={styles.compareDemandeInfo}>
                {CATEGORY_LABELS[selectedDemande.category]} · {formatDate(selectedDemande.createdAt)}
              </Text>
              {!!selectedDemande.description && (
                <Text style={styles.compareDemandeDesc}>{selectedDemande.description}</Text>
              )}

              {/* Prestataires en attente */}
              {selectedDemande.devis.filter((o) => !o.submitted).length > 0 && (
                <View style={styles.pendingSection}>
                  <Text style={styles.pendingSectionTitle}>En attente de réponse</Text>
                  {selectedDemande.devis.filter((o) => !o.submitted).map((o) => (
                    <View key={o.id} style={styles.pendingRow}>
                      <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
                      <Text style={styles.pendingName}>{o.contactName} — {o.contactCompany}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Devis reçus */}
              {selectedDemande.devis.filter((o) => o.submitted).length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="hourglass-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.emptyText}>Aucun devis reçu pour l'instant</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.compareRecusTitle}>Devis reçus</Text>
                  {selectedDemande.devis
                    .filter((o) => o.submitted)
                    .sort((a, b) => (a.priceTTC ?? 999999) - (b.priceTTC ?? 999999))
                    .map((o, idx) => {
                      const isWinner = selectedDemande.selectedDevisId === o.id;
                      const isBest = idx === 0;
                      return (
                        <View key={o.id} style={[
                          styles.devisCard,
                          isWinner && styles.devisCardWinner,
                          isBest && !isWinner && styles.devisCardBest,
                        ]}>
                          <View style={styles.devisCardTop}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.devisContactName}>{o.contactName}</Text>
                              <Text style={styles.devisContactCompany}>{o.contactCompany}</Text>
                            </View>
                            {isWinner && (
                              <View style={{ gap: 4, alignItems: "flex-end" }}>
                                <View style={styles.winnerBadge}>
                                  <Ionicons name="trophy" size={13} color="#D97706" />
                                  <Text style={styles.winnerBadgeText}>Retenu</Text>
                                </View>
                                {o.signedAt && o.adminSignedAt ? (
                                  <View style={styles.signedBadge}>
                                    <Ionicons name="checkmark-done" size={11} color="#16A34A" />
                                    <Text style={styles.signedBadgeText}>Double signature ✓</Text>
                                  </View>
                                ) : o.signedAt ? (
                                  <View style={styles.pendingSignBadge}>
                                    <Ionicons name="time-outline" size={11} color="#D97706" />
                                    <Text style={styles.pendingSignBadgeText}>En attente signature syndic</Text>
                                  </View>
                                ) : (
                                  <View style={styles.pendingSignBadge}>
                                    <Ionicons name="time-outline" size={11} color="#D97706" />
                                    <Text style={styles.pendingSignBadgeText}>Signature prestataire en attente</Text>
                                  </View>
                                )}
                              </View>
                            )}
                            {isBest && !isWinner && (
                              <View style={styles.bestBadge}>
                                <Text style={styles.bestBadgeText}>Moins cher</Text>
                              </View>
                            )}
                          </View>

                          <Text style={[styles.devisPrice, isBest && !isWinner && { color: COLORS.primary }, isWinner && { color: "#D97706" }]}>
                            {o.priceTTC !== undefined ? formatPrice(o.priceTTC) : "Prix non renseigné"}
                            <Text style={styles.devisPriceTtc}> TTC</Text>
                          </Text>

                          {!!o.description && (
                            <Text style={styles.devisDesc}>{o.description}</Text>
                          )}
                          {o.submittedAt && (
                            <Text style={styles.devisDate}>Reçu le {formatDate(o.submittedAt)}</Text>
                          )}

                          {!!o.devisFileUrl && (
                            <Pressable
                              style={styles.viewFileBtn}
                              onPress={() => openOrShareDevis(o.devisFileUrl!, o.contactName)}
                            >
                              <Ionicons name="share-outline" size={15} color={COLORS.primary} />
                              <Text style={styles.viewFileBtnText}>Ouvrir / Partager le devis</Text>
                            </Pressable>
                          )}
                          {!!o.signatureUrl && (
                            <Pressable
                              style={[styles.viewFileBtn, { borderColor: "#16A34A40", backgroundColor: "#16A34A08" }]}
                              onPress={() => openOrShareDevis(o.signatureUrl!, o.contactName)}
                            >
                              <Ionicons name="pencil" size={15} color="#16A34A" />
                              <Text style={[styles.viewFileBtnText, { color: "#16A34A" }]}>Signature prestataire</Text>
                            </Pressable>
                          )}
                          {!!o.adminSignatureUrl && (
                            <Pressable
                              style={[styles.viewFileBtn, { borderColor: "#7C3AED40", backgroundColor: "#7C3AED08" }]}
                              onPress={() => openOrShareDevis(o.adminSignatureUrl!, "syndic")}
                            >
                              <Ionicons name="shield-checkmark" size={15} color="#7C3AED" />
                              <Text style={[styles.viewFileBtnText, { color: "#7C3AED" }]}>Signature syndic</Text>
                            </Pressable>
                          )}
                          {isWinner && isAdmin && o.signedAt && (
                            <Pressable
                              style={styles.adminSignBtn}
                              onPress={() => {
                                setCompareModal(false);
                                setTimeout(() => openAdminSign(selectedDemande!, o), 400);
                              }}
                            >
                              <Ionicons name="create-outline" size={16} color="#fff" />
                              <Text style={styles.adminSignBtnText}>
                                {o.adminSignedAt ? "Re-signer (syndic)" : "Signer (syndic)"}
                              </Text>
                            </Pressable>
                          )}
                          {isWinner && o.finalDevisUrl && (
                            <Pressable
                              style={styles.bonCommandeBtn}
                              onPress={() => openOrShareDevis(o.finalDevisUrl!, o.contactName)}
                            >
                              <Ionicons name="document-text" size={16} color="#fff" />
                              <Text style={styles.bonCommandeBtnText}>Bon de commande (PDF)</Text>
                            </Pressable>
                          )}
                          {isWinner && o.signedAt && o.adminSignedAt && !o.finalDevisUrl && (
                            <View style={styles.pdfGeneratingBadge}>
                              <ActivityIndicator size="small" color={COLORS.textMuted} />
                              <Text style={styles.pdfGeneratingText}>Génération du PDF en cours…</Text>
                            </View>
                          )}
                          {isWinner && o.signedAt && o.adminSignedAt && o.signatureToken && (
                            <Pressable
                              style={[styles.bonCommandeBtn, { backgroundColor: "#475569", marginTop: 2 }]}
                              onPress={() => {
                                const apiBase = getApiUrl().replace(/\/$/, "");
                                Linking.openURL(`${apiBase}/bon-de-commande/${o.signatureToken}`);
                              }}
                            >
                              <Ionicons name="globe-outline" size={15} color="#fff" />
                              <Text style={styles.bonCommandeBtnText}>Bon de commande (web)</Text>
                            </Pressable>
                          )}

                          {isAdmin && !isWinner && (
                            <Pressable
                              style={[styles.retainBtn, selectedDemande.status === "cloture" && styles.retainBtnAlt]}
                              onPress={() => handleSelectDevis(selectedDemande, o.id, o.contactName)}
                            >
                              <Ionicons name={selectedDemande.status === "cloture" ? "swap-horizontal-outline" : "checkmark-circle-outline"} size={16} color="#fff" />
                              <Text style={styles.retainBtnText}>
                                {selectedDemande.status === "cloture" ? "Changer pour ce devis" : "Retenir ce devis"}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    })
                  }
                </>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  headerSub: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  addBtn: { backgroundColor: COLORS.primary, borderRadius: 20, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  tabsRow: {
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  tabsContent: {
    paddingHorizontal: 14, paddingVertical: 10, gap: 8,
    flexDirection: "row", alignItems: "center",
  },
  tabChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  tabChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  tabChipTextActive: { color: "#fff" },
  tabBadge: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: "center",
  },
  tabBadgeActive: { backgroundColor: "#fff" },
  tabBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  tabBadgeTextActive: { color: COLORS.primary },
  list: { padding: 12 },
  propInfoCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#E0F2FE", borderRadius: 12, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: "#BAE6FD",
  },
  propInfoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#0369A1", lineHeight: 18 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  emptyBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  emptyBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  card: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  urgentBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEE2E2", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  urgentText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
  cardDate: { marginLeft: "auto", fontSize: 11, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 4 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  cardMetaText: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  cardMetaSep: { fontSize: 12, color: COLORS.textMuted },
  cardDesc: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 8 },
  devisPreview: { backgroundColor: COLORS.surface, borderRadius: 8, padding: 8, marginBottom: 10 },
  devisPreviewLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.primary + "50",
    backgroundColor: COLORS.primary + "0D",
  },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  // Modals
  modal: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalCancel: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  modalTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  modalSave: { fontSize: 15, color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  modalBody: { padding: 16 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted, marginBottom: 6, marginTop: 14 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15,
    fontFamily: "Inter_400Regular", color: COLORS.text, backgroundColor: "#fff",
  },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  catChip: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  catChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  urgencyChip: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  urgencyChipNormal: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + "10" },
  urgencyChipUrgent: { borderColor: "#DC2626", backgroundColor: "#FEE2E2" },
  urgencyText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  // Forward modal
  forwardDemandeBanner: {
    backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  forwardDemandeTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  forwardDemandeInfo: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  forwardHint: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular", margin: 16, lineHeight: 18 },
  contactRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  contactRowSelected: { backgroundColor: COLORS.primary + "08" },
  contactAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: COLORS.border,
  },
  contactAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  contactName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  contactInfo: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  alreadySentBadge: { fontSize: 11, color: "#16A34A", fontFamily: "Inter_500Medium", marginTop: 2 },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: COLORS.border, alignItems: "center", justifyContent: "center",
  },
  checkboxActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  // Compare modal
  compareDemandeTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 4 },
  compareDemandeInfo: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginBottom: 4 },
  compareDemandeDesc: { fontSize: 14, color: COLORS.text, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 6, marginBottom: 4 },
  pendingSection: { backgroundColor: "#FFFBEB", borderRadius: 10, padding: 12, marginVertical: 12, borderWidth: 1, borderColor: "#FDE68A" },
  pendingSectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E", marginBottom: 6 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  pendingName: { fontSize: 13, color: "#78350F", fontFamily: "Inter_400Regular" },
  compareRecusTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text, marginTop: 8, marginBottom: 8 },
  devisCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  devisCardBest: { borderColor: COLORS.primary, borderWidth: 2 },
  devisCardWinner: { borderColor: "#D97706", borderWidth: 2, backgroundColor: "#FFFBEB" },
  devisCardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  devisContactName: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text },
  devisContactCompany: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  winnerBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  winnerBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#D97706" },
  bestBadge: { backgroundColor: COLORS.primary + "15", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  bestBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  devisPrice: { fontSize: 26, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 6 },
  devisPriceTtc: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  devisDesc: { fontSize: 14, color: COLORS.text, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 6 },
  devisDate: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginBottom: 10 },
  viewFileBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1,
    borderColor: COLORS.primary + "40",
    backgroundColor: COLORS.primary + "08",
    alignSelf: "flex-start", marginBottom: 10,
  },
  viewFileBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },
  retainBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#16A34A", borderRadius: 10, paddingVertical: 11,
  },
  retainBtnAlt: { backgroundColor: "#64748B" },
  retainBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  signedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#DCFCE7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  signedBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#16A34A" },
  pendingSignBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  pendingSignBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#D97706" },
  adminSignBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#7C3AED", borderRadius: 10, paddingVertical: 11, marginTop: 4,
  },
  adminSignBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  bonCommandeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#0F172A", borderRadius: 10, paddingVertical: 11, marginTop: 4,
  },
  bonCommandeBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  pdfGeneratingBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, marginTop: 4,
  },
  pdfGeneratingText: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  // Admin signature modal
  signInfoBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#F5F3FF", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#DDD6FE", width: "100%", marginBottom: 20,
  },
  signInfoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#5B21B6", lineHeight: 18 },
  signHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginBottom: 10, alignSelf: "flex-start" },
  signCanvas: {
    borderWidth: 2, borderColor: COLORS.border, borderRadius: 12,
    backgroundColor: "#FAFAFA", overflow: "hidden",
  },
  clearSignBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 10, paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignSelf: "flex-end",
  },
  clearSignBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  signLegal: {
    fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted,
    textAlign: "center", lineHeight: 15, marginTop: 20, paddingHorizontal: 8,
  },
  savedSigSection: {
    width: "100%", borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, overflow: "hidden", marginBottom: 4,
  },
  savedSigSectionActive: { borderColor: "#7C3AED", backgroundColor: "#F5F3FF" },
  savedSigHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  savedSigLabel: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  applySigBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  applySigBtnActive: { backgroundColor: "#EDE9FE", borderColor: "#7C3AED" },
  applySigBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  savedSigPreview: { backgroundColor: "#fff" },
});
