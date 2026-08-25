/**
 * app/(tenant)/interventions.tsx
 * Locataire : consulter les interventions de son logement + en créer.
 * Quand le bailleur a retenu un artisan → coordonnées visibles.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Linking, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  addDoc, collection, onSnapshot, orderBy, query,
} from "firebase/firestore";
import DateInput, { maskDate } from "@/components/DateInput";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import type { PropertyIntervention, RentalInterventionStatus } from "@/shared/types";
import {
  RENTAL_INTERVENTION_STATUS_LABELS,
  RENTAL_INTERVENTION_STATUS_COLORS,
} from "@/shared/types";

// ─── Constantes ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "plomberie",    label: "Plomberie",    icon: "water-outline" },
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

const CAT_ICONS: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon]));

type FilterKey = "all" | "mine" | RentalInterventionStatus;

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: "all",         label: "Toutes" },
  { key: "mine",        label: "Mes demandes" },
  { key: "new",         label: "À planifier" },
  { key: "scheduled",   label: "Planifiée" },
  { key: "in_progress", label: "En cours" },
  { key: "completed",   label: "Terminée" },
];

// ─── Carte détail intervention ────────────────────────────────────────────────

function InterventionCard({ item }: { item: PropertyIntervention }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = RENTAL_INTERVENTION_STATUS_COLORS[item.status] ?? "#94A3B8";
  const statusLabel = RENTAL_INTERVENTION_STATUS_LABELS[item.status] ?? item.status;
  const catIcon = CAT_ICONS[item.category ?? "autre"] ?? "construct-outline";
  const retainedDevis = item.devis?.find((d) => d.id === item.selectedDevisId);

  const formattedDate = item.scheduledDate
    ? new Date(item.scheduledDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <Pressable
      style={[c.card, item.createdByTenant && c.cardTenant]}
      onPress={() => setExpanded((v) => !v)}
    >
      {/* Rail coloré */}
      <View style={[c.rail, { backgroundColor: statusColor }]} />

      <View style={c.body}>
        {/* Ligne titre */}
        <View style={c.topRow}>
          <View style={[c.iconBox, { backgroundColor: statusColor + "22" }]}>
            <Ionicons name={catIcon as any} size={16} color={statusColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={c.title} numberOfLines={expanded ? undefined : 2}>{item.title}</Text>
            <Text style={c.meta}>
              {new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
              {formattedDate ? ` · Prévu le ${formattedDate}` : ""}
            </Text>
          </View>
          <View style={[c.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <View style={[c.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[c.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        {/* Badges */}
        <View style={c.badgeRow}>
          {item.createdByTenant && (
            <View style={c.myBadge}>
              <Ionicons name="person-outline" size={10} color="#8B5CF6" />
              <Text style={c.myBadgeText}>Ma demande</Text>
            </View>
          )}
          {retainedDevis && (
            <View style={c.artisanBadge}>
              <Ionicons name="hammer-outline" size={10} color="#F59E0B" />
              <Text style={c.artisanBadgeText}>Artisan retenu</Text>
            </View>
          )}
        </View>

        {/* Contenu déplié */}
        {expanded && (
          <View style={c.expandedBody}>
            {!!item.description && (
              <Text style={c.desc}>{item.description}</Text>
            )}
            {!!item.report && (
              <View style={c.reportBox}>
                <Ionicons name="document-text-outline" size={13} color="#8B5CF6" />
                <Text style={c.reportText}>{item.report}</Text>
              </View>
            )}

            {/* Artisan retenu → coordonnées */}
            {retainedDevis && (
              <View style={c.artisanCard}>
                <View style={c.artisanHeader}>
                  <View style={c.artisanAvatar}>
                    <Ionicons name="hammer" size={14} color="#F59E0B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={c.artisanLabel}>Artisan chargé des travaux</Text>
                    <Text style={c.artisanName}>{retainedDevis.contactName}</Text>
                    {retainedDevis.contactCompany ? (
                      <Text style={c.artisanCompany}>{retainedDevis.contactCompany}</Text>
                    ) : null}
                  </View>
                </View>
                <View style={c.artisanContacts}>
                  {retainedDevis.contactEmail ? (
                    <Pressable
                      style={c.contactBtn}
                      onPress={() => Linking.openURL(`mailto:${retainedDevis!.contactEmail}`)}
                    >
                      <Ionicons name="mail-outline" size={14} color="#60A5FA" />
                      <Text style={c.contactBtnText} numberOfLines={1}>{retainedDevis.contactEmail}</Text>
                    </Pressable>
                  ) : null}
                  {retainedDevis.contactPhone ? (
                    <Pressable
                      style={c.contactBtn}
                      onPress={() => Linking.openURL(`tel:${retainedDevis!.contactPhone}`)}
                    >
                      <Ionicons name="call-outline" size={14} color="#34D399" />
                      <Text style={c.contactBtnText}>{retainedDevis.contactPhone}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Chevron */}
        <View style={c.chevronRow}>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color="rgba(255,255,255,0.25)"
          />
        </View>
      </View>
    </Pressable>
  );
}

// ─── Modal création d'intervention locataire ──────────────────────────────────

function CreateModal({
  visible, onClose, propertyId, landlordId, tenantUserId,
}: {
  visible: boolean; onClose: () => void;
  propertyId: string; landlordId: string; tenantUserId: string;
}) {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<Category | "">("");
  const [title, setTitle]       = useState("");
  const [description, setDesc]  = useState("");
  const [date, setDate]         = useState("");
  const [saving, setSaving]     = useState(false);

  const reset = () => { setCategory(""); setTitle(""); setDesc(""); setDate(""); };

  const handleCreate = async () => {
    if (!category) { Alert.alert("Catégorie requise", "Choisissez une catégorie."); return; }
    if (!title.trim()) { Alert.alert("Titre requis", "Décrivez brièvement le problème."); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, "properties", propertyId, "interventions"), {
        propertyId,
        landlordId,
        status:          "new",
        title:           title.trim(),
        description:     description.trim(),
        priority:        "normal",
        category,
        scheduledDate:   date || null,
        devis:           [],
        devisStatus:     "none",
        createdBy:       tenantUserId,
        createdByTenant: true,
        tenantUserId,
        createdAt:       new Date().toISOString(),
        updatedAt:       new Date().toISOString(),
      });
      reset();
      onClose();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message ?? "Impossible de créer la demande.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => { if (!visible) reset(); }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      transparent={Platform.OS === "web"}
      presentationStyle={Platform.OS === "web" ? undefined : "pageSheet"}
      onRequestClose={onClose}
    >
      {/* Wrapper web : overlay centré 580px max */}
      <View style={Platform.OS === "web"
        ? { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 20 }
        : { flex: 1 }
      }>
      <View style={Platform.OS === "web"
        ? { width: "100%", maxWidth: 580, maxHeight: "90%", backgroundColor: COLORS.background, borderRadius: 20, overflow: "hidden" }
        : [m.root, { paddingTop: insets.top + 16 }]
      }>
        {/* Header */}
        <View style={m.header}>
          <Pressable onPress={onClose}><Text style={m.cancel}>Annuler</Text></Pressable>
          <Text style={m.headerTitle}>Demande d'intervention</Text>
          <Pressable onPress={handleCreate} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color="#8B5CF6" />
              : <Text style={[m.send, (!category || !title.trim()) && { opacity: 0.35 }]}>Envoyer</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={m.body} keyboardShouldPersistTaps="handled">
          {/* Bannière info */}
          <View style={m.infoBanner}>
            <Ionicons name="information-circle-outline" size={18} color="#60A5FA" />
            <Text style={m.infoText}>
              Votre demande sera transmise à votre bailleur, qui prendra en charge la coordination des travaux.
            </Text>
          </View>

          {/* Catégorie */}
          <Text style={m.label}>Catégorie *</Text>
          <View style={m.catGrid}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.id}
                style={[m.catChip, category === cat.id && m.catChipActive]}
                onPress={() => setCategory(cat.id)}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={15}
                  color={category === cat.id ? "#fff" : COLORS.textMuted}
                />
                <Text style={[m.catLabel, category === cat.id && m.catLabelActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Titre */}
          <Text style={m.label}>Problème rencontré *</Text>
          <TextInput
            style={m.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Ex : Fuite sous l'évier de la cuisine"
            placeholderTextColor={COLORS.textMuted}
            maxLength={120}
          />

          {/* Description */}
          <Text style={m.label}>Description (optionnel)</Text>
          <TextInput
            style={[m.input, m.textarea]}
            value={description}
            onChangeText={setDesc}
            placeholder="Précisez le problème, depuis quand, l'urgence…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          {/* Date souhaitée */}
          <Text style={m.label}>Date souhaitée d'intervention</Text>
          <DateInput
            value={date}
            onChange={setDate}
            placeholder="JJ/MM/AAAA"
            style={m.input}
          />

          <Text style={m.legal}>
            Votre bailleur sera notifié et vous contactera pour organiser l'intervention.
          </Text>
        </ScrollView>
      </View>
      </View>
    </Modal>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function TenantInterventions() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { user, rentalInfo } = useAuth();
  const paddingTop = Platform.OS === "web" ? 12 : insets.top + 12;

  const [interventions, setInterventions] = useState<PropertyIntervention[]>([]);
  const [loading, setLoading]             = useState(true);
  const [filter, setFilter]               = useState<FilterKey>("all");
  const [showCreate, setShowCreate]       = useState(false);

  // Infos logement pour la création
  const [landlordId, setLandlordId] = useState("");

  useEffect(() => {
    if (!rentalInfo?.propertyId) { setLoading(false); return; }

    // Récupérer le landlordId depuis le logement
    import("firebase/firestore").then(({ getDoc, doc: fdoc }) => {
      getDoc(fdoc(db, "properties", rentalInfo.propertyId)).then((snap) => {
        if (snap.exists()) setLandlordId(snap.data()?.landlordId ?? "");
      }).catch(() => {});
    });

    return onSnapshot(
      query(
        collection(db, "properties", rentalInfo.propertyId, "interventions"),
        orderBy("createdAt", "desc")
      ),
      (snap) => {
        setInterventions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PropertyIntervention)));
        setLoading(false);
      },
      (err) => { console.warn("[tenant/interventions]", err); setLoading(false); }
    );
  }, [rentalInfo?.propertyId]);

  const filtered = (() => {
    const base = interventions.filter((i) => i.status !== "cancelled");
    if (filter === "mine") return base.filter((i) => i.createdByTenant && i.tenantUserId === user?.uid);
    if (filter === "all") return base;
    return base.filter((i) => i.status === filter);
  })();

  const myCount    = interventions.filter((i) => i.createdByTenant && i.tenantUserId === user?.uid).length;
  const activeCount = interventions.filter((i) => i.status !== "completed" && i.status !== "cancelled").length;

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={{ flex: 1 }}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop }]}>
        <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={18} color="rgba(255,255,255,0.8)" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Interventions</Text>
          <Text style={s.subtitle}>
            {loading ? "Chargement…"
              : `${activeCount} en cours${myCount > 0 ? ` · ${myCount} de mes demandes` : ""}`}
          </Text>
        </View>
        {/* Bouton créer */}
        <Pressable style={s.createBtn} onPress={() => setShowCreate(true)}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={s.createBtnText}>Demander</Text>
        </Pressable>
      </View>

      {/* Bandeau info */}
      <View style={s.infoBand}>
        <Ionicons name="information-circle-outline" size={13} color="rgba(255,255,255,0.4)" />
        <Text style={s.infoBandText}>
          Vous pouvez soumettre une demande de travaux. Votre bailleur en prend la coordination.
        </Text>
      </View>

      {/* Filtres */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={s.filterBar} contentContainerStyle={s.filterContent}
      >
        {FILTER_TABS.map((tab) => {
          const isActive = filter === tab.key;
          const count = tab.key === "mine"
            ? myCount
            : tab.key === "all"
            ? interventions.filter((i) => i.status !== "cancelled").length
            : interventions.filter((i) => i.status === tab.key).length;

          return (
            <Pressable
              key={tab.key}
              style={[s.tab, isActive && s.tabActive]}
              onPress={() => setFilter(tab.key)}
            >
              <Text style={[s.tabText, isActive && s.tabTextActive]}>
                {tab.label}{count > 0 ? ` (${count})` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Contenu */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={COLORS.teal} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="construct-outline" size={52} color="rgba(255,255,255,0.15)" />
          <Text style={s.emptyTitle}>
            {filter === "mine" ? "Aucune demande de votre part"
              : interventions.length === 0 ? "Aucune intervention" : "Aucun résultat"}
          </Text>
          <Text style={s.emptyDesc}>
            {filter === "mine"
              ? "Utilisez le bouton \"Demander\" pour soumettre une demande de travaux."
              : interventions.length === 0
              ? "Les interventions planifiées par votre bailleur apparaîtront ici."
              : "Essayez un autre filtre."}
          </Text>
          {filter === "mine" && (
            <Pressable style={s.emptyCreateBtn} onPress={() => setShowCreate(true)}>
              <Ionicons name="add-circle-outline" size={18} color="#8B5CF6" />
              <Text style={s.emptyCreateBtnText}>Soumettre une demande</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
          {filtered.map((item) => <InterventionCard key={item.id} item={item} />)}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}

      {/* FAB créer */}
      <Pressable
        style={[s.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => setShowCreate(true)}
      >
        <Ionicons name="add" size={24} color="#fff" />
      </Pressable>

      {/* Modal création */}
      {rentalInfo?.propertyId && user?.uid && (
        <CreateModal
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          propertyId={rentalInfo.propertyId}
          landlordId={landlordId}
          tenantUserId={user.uid}
        />
      )}
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const c = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 14, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  cardTenant: {
    borderColor: "rgba(139,92,246,0.3)",
    backgroundColor: "rgba(139,92,246,0.07)",
  },
  rail:       { width: 4, alignSelf: "stretch" },
  body:       { flex: 1, padding: 14, gap: 8 },
  topRow:     { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconBox:    { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff", flex: 1 },
  meta:       { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.3)", marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, flexShrink: 0 },
  statusDot:  { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  badgeRow:   { flexDirection: "row", gap: 6 },
  myBadge:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(139,92,246,0.15)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  myBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#A78BFA" },
  artisanBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(245,158,11,0.15)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  artisanBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#FCD34D" },

  expandedBody: { gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)" },
  desc:        { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", lineHeight: 18 },
  reportBox:   { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 8, padding: 10, borderLeftWidth: 2, borderLeftColor: "#8B5CF6" },
  reportText:  { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", lineHeight: 17 },

  artisanCard: {
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)", padding: 12, gap: 10,
  },
  artisanHeader:  { flexDirection: "row", alignItems: "center", gap: 10 },
  artisanAvatar:  { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(245,158,11,0.2)", alignItems: "center", justifyContent: "center" },
  artisanLabel:   { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "rgba(245,158,11,0.7)", textTransform: "uppercase", letterSpacing: 0.5 },
  artisanName:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  artisanCompany: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)" },
  artisanContacts: { gap: 6 },
  contactBtn:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  contactBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)", flex: 1 },

  chevronRow: { alignItems: "flex-end" },
});

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  title:    { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", marginTop: 2 },
  createBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#8B5CF6", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  createBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },

  infoBand: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 6,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  infoBandText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.35)", lineHeight: 16 },

  filterBar:     { flexGrow: 0 },
  filterContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  tabActive:     { backgroundColor: "rgba(139,92,246,0.25)", borderColor: "rgba(139,92,246,0.4)" },
  tabText:       { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.4)" },
  tabTextActive: { color: "#C4B5FD", fontFamily: "Inter_600SemiBold" },

  list:   { padding: 16, gap: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.4)", textAlign: "center" },
  emptyDesc:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.25)", textAlign: "center", lineHeight: 19 },
  emptyCreateBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8,
    backgroundColor: "rgba(139,92,246,0.15)", borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 12,
    borderWidth: 1, borderColor: "rgba(139,92,246,0.3)",
  },
  emptyCreateBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#A78BFA" },

  fab: {
    position: "absolute", right: 20,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: "#8B5CF6", alignItems: "center", justifyContent: "center",
    shadowColor: "#8B5CF6", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
    elevation: 8,
  },
});

// ─── Styles modale création ───────────────────────────────────────────────────

const m = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: "#fff",
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  cancel:  { fontSize: 15, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  send:    { fontSize: 15, fontFamily: "Inter_700Bold", color: "#8B5CF6" },
  body:    { padding: 20, gap: 16 },

  infoBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "#BFDBFE",
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#1E40AF", lineHeight: 18 },

  label: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  input: {
    backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border,
  },
  textarea: { minHeight: 90, textAlignVertical: "top" },

  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border,
  },
  catChipActive: { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6" },
  catLabel:      { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  catLabelActive:{ color: "#fff", fontFamily: "Inter_600SemiBold" },

  legal: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, textAlign: "center", lineHeight: 16,
  },
});
