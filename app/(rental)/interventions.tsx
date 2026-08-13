import {
  View, Text, StyleSheet, Platform, ScrollView,
  Pressable, Modal, TextInput, Alert, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState, useCallback } from "react";
import {
  collection, query, where, onSnapshot, updateDoc, addDoc, doc,
  orderBy, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import type { RentalProperty, PropertyIntervention, RentalInterventionStatus } from "@/shared/types";
import { HamburgerButton } from "@/components/rental/RentalDrawer";
import {
  RENTAL_INTERVENTION_STATUS_LABELS,
  RENTAL_INTERVENTION_STATUS_COLORS,
} from "@/shared/types";

// ─── Types locaux ─────────────────────────────────────────────────────────────

type InterventionWithProperty = PropertyIntervention & { propertyLabel?: string };

interface PropertyOption {
  id: string;
  label: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const INTERVENTION_CATEGORIES = [
  { id: "plomberie",    label: "Plomberie",       icon: "water-outline" },
  { id: "electricite",  label: "Électricité",      icon: "flash-outline" },
  { id: "chauffage",    label: "Chauffage",        icon: "flame-outline" },
  { id: "serrurerie",   label: "Serrurerie",        icon: "key-outline" },
  { id: "menuiserie",   label: "Menuiserie",        icon: "hammer-outline" },
  { id: "toiture",      label: "Toiture",           icon: "umbrella-outline" },
  { id: "peinture",     label: "Peinture",          icon: "brush-outline" },
  { id: "nettoyage",    label: "Nettoyage",         icon: "sparkles-outline" },
  { id: "autre",        label: "Autre",             icon: "construct-outline" },
] as const;

type InterventionCategory = typeof INTERVENTION_CATEGORIES[number]["id"];

const STATUS_FLOW: RentalInterventionStatus[] = [
  "new", "scheduled", "in_progress", "completed",
];

const STATUS_NEXT_LABEL: Partial<Record<RentalInterventionStatus, string>> = {
  new:         "Planifier",
  scheduled:   "Démarrer",
  in_progress: "Terminer",
};

const STATUS_BG: Record<RentalInterventionStatus, string> = {
  new:         "#FEF2F2",
  assigned:    "#FFF7ED",
  scheduled:   "#EFF6FF",
  in_progress: "#F5F3FF",
  completed:   "#F0FDF4",
  cancelled:   "#F8FAFC",
};

// ─── Modale création ──────────────────────────────────────────────────────────

function CreateModal({
  visible, onClose, properties,
}: {
  visible: boolean;
  onClose: () => void;
  properties: PropertyOption[];
}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [propertyId, setPropertyId]   = useState("");
  const [category, setCategory]       = useState<InterventionCategory | "">("");
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [scheduledDate, setScheduled] = useState("");
  const [estimatedCost, setEstCost]   = useState("");
  const [saving, setSaving]           = useState(false);

  useEffect(() => {
    if (!visible) {
      setPropertyId(""); setCategory(""); setTitle("");
      setDescription(""); setScheduled(""); setEstCost("");
    }
    // Pré-sélectionner si 1 seul logement
    if (visible && properties.length === 1) {
      setPropertyId(properties[0].id);
    }
  }, [visible, properties]);

  const handleCreate = async () => {
    if (!propertyId) { Alert.alert("Logement manquant", "Sélectionnez un logement."); return; }
    if (!category)   { Alert.alert("Catégorie manquante", "Choisissez une catégorie."); return; }
    if (!title.trim()) { Alert.alert("Titre manquant", "Saisissez un titre."); return; }
    if (!user) return;

    setSaving(true);
    try {
      await addDoc(collection(db, "properties", propertyId, "interventions"), {
        propertyId,
        landlordId:    user.uid,
        status:        scheduledDate ? "scheduled" : "new",
        title:         title.trim(),
        description:   description.trim(),
        priority:      "normal",
        scheduledDate: scheduledDate || undefined,
        estimatedCost: estimatedCost ? parseFloat(estimatedCost) : undefined,
        createdBy:     user.uid,
        createdAt:     new Date().toISOString(),
        // category est stocké comme propriété libre non typée dans l'interface
        ...(category ? { category } : {}),
      });
      onClose();
    } catch {
      Alert.alert("Erreur", "Impossible de créer l'intervention.");
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
          <Text style={create.title}>Nouvelle intervention</Text>

          {/* Logement */}
          {properties.length > 1 && (
            <>
              <Text style={create.label}>Logement *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
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

          {/* Catégorie */}
          <Text style={create.label}>Catégorie *</Text>
          <View style={create.grid}>
            {INTERVENTION_CATEGORIES.map((c) => (
              <Pressable
                key={c.id}
                style={[create.catBtn, category === c.id && create.catBtnActive]}
                onPress={() => setCategory(c.id)}
              >
                <Ionicons
                  name={c.icon as any}
                  size={18}
                  color={category === c.id ? COLORS.primary : COLORS.textMuted}
                />
                <Text style={[create.catLabel, category === c.id && { color: COLORS.primary }]}>
                  {c.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Titre */}
          <Text style={create.label}>Titre *</Text>
          <TextInput
            style={create.input}
            placeholder="ex : Fuite robinet cuisine"
            placeholderTextColor={COLORS.textMuted}
            value={title}
            onChangeText={setTitle}
          />

          {/* Description */}
          <Text style={create.label}>Description</Text>
          <TextInput
            style={[create.input, { minHeight: 80, textAlignVertical: "top" }]}
            placeholder="Détails, accès, contexte…"
            placeholderTextColor={COLORS.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
          />

          {/* Date prévue */}
          <Text style={create.label}>Date prévue (JJ/MM/AAAA)</Text>
          <TextInput
            style={create.input}
            placeholder="ex : 15/08/2026"
            placeholderTextColor={COLORS.textMuted}
            value={scheduledDate}
            onChangeText={setScheduled}
            keyboardType="numeric"
          />

          {/* Coût estimé */}
          <Text style={create.label}>Coût estimé (€)</Text>
          <TextInput
            style={create.input}
            placeholder="ex : 250"
            placeholderTextColor={COLORS.textMuted}
            value={estimatedCost}
            onChangeText={setEstCost}
            keyboardType="numeric"
          />

          {/* Bouton */}
          <Pressable style={create.btn} onPress={handleCreate} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={create.btnText}>Créer l'intervention</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Modale détail ─────────────────────────────────────────────────────────────

function DetailModal({
  intervention,
  onClose,
}: {
  intervention: InterventionWithProperty;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [note, setNote]     = useState(intervention.report ?? "");
  const [cost, setCost]     = useState(
    intervention.finalCost != null ? String(intervention.finalCost) : ""
  );

  const statusCfg = {
    color: RENTAL_INTERVENTION_STATUS_COLORS[intervention.status],
    bg:    STATUS_BG[intervention.status],
    label: RENTAL_INTERVENTION_STATUS_LABELS[intervention.status],
  };
  const nextStatusFlow = STATUS_FLOW.indexOf(intervention.status);
  const nextStatus: RentalInterventionStatus | null =
    nextStatusFlow !== -1 && nextStatusFlow < STATUS_FLOW.length - 1
      ? STATUS_FLOW[nextStatusFlow + 1]
      : null;

  const cat = INTERVENTION_CATEGORIES.find((c) => c.id === (intervention as any).category)
    ?? INTERVENTION_CATEGORIES[INTERVENTION_CATEGORIES.length - 1];

  const save = async (newStatus?: RentalInterventionStatus) => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        report:    note.trim() || null,
        updatedAt: new Date().toISOString(),
      };
      if (cost) updates.finalCost = parseFloat(cost);
      if (newStatus) {
        updates.status = newStatus;
        if (newStatus === "completed") updates.completedDate = new Date().toISOString();
      }
      await updateDoc(
        doc(db, "properties", intervention.propertyId, "interventions", intervention.id),
        updates
      );
      onClose();
    } catch {
      Alert.alert("Erreur", "Impossible de sauvegarder.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      "Annuler l'intervention ?",
      "Cette action est irréversible.",
      [
        { text: "Non", style: "cancel" },
        { text: "Oui, annuler", style: "destructive", onPress: () => save("cancelled") },
      ]
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]}
          onPress={onClose}
        />
        <ScrollView
          style={[detail.sheet, { paddingBottom: insets.bottom + 20 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={detail.handle} />

          {/* En-tête */}
          <View style={detail.header}>
            <View style={[detail.catIcon, { backgroundColor: statusCfg.bg }]}>
              <Ionicons name={cat.icon as any} size={20} color={statusCfg.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={detail.catLabel} numberOfLines={1}>{intervention.title}</Text>
              {intervention.propertyLabel ? (
                <Text style={detail.propLabel}>{intervention.propertyLabel}</Text>
              ) : null}
            </View>
            <View style={[detail.badge, { backgroundColor: statusCfg.bg }]}>
              <Text style={[detail.badgeText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
            </View>
          </View>

          {/* Description */}
          {intervention.description ? (
            <Text style={detail.desc}>{intervention.description}</Text>
          ) : null}

          {/* Infos */}
          <View style={detail.infoGrid}>
            {intervention.scheduledDate ? (
              <View style={detail.infoCell}>
                <Ionicons name="calendar-outline" size={14} color={COLORS.textMuted} />
                <Text style={detail.infoText}>Date : {intervention.scheduledDate}</Text>
              </View>
            ) : null}
            {intervention.estimatedCost != null ? (
              <View style={detail.infoCell}>
                <Ionicons name="receipt-outline" size={14} color={COLORS.textMuted} />
                <Text style={detail.infoText}>Estimé : {intervention.estimatedCost} €</Text>
              </View>
            ) : null}
          </View>

          {/* Rapport / note */}
          <Text style={detail.noteLabel}>Rapport d'intervention</Text>
          <TextInput
            style={detail.noteInput}
            placeholder="Notes, observations, travaux effectués…"
            placeholderTextColor={COLORS.textMuted}
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={4}
          />

          {/* Coût final */}
          <Text style={detail.noteLabel}>Coût final (€)</Text>
          <TextInput
            style={detail.noteInput}
            placeholder="Montant réel de l'intervention"
            placeholderTextColor={COLORS.textMuted}
            value={cost}
            onChangeText={setCost}
            keyboardType="numeric"
          />

          {/* Actions */}
          <View style={detail.actions}>
            <Pressable style={detail.saveBtn} onPress={() => save()} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={detail.saveBtnText}>Enregistrer</Text>
              )}
            </Pressable>

            {nextStatus && (
              <Pressable
                style={[detail.nextBtn, {
                  borderColor: RENTAL_INTERVENTION_STATUS_COLORS[nextStatus],
                }]}
                onPress={() => save(nextStatus)}
                disabled={saving}
              >
                <Text style={[detail.nextBtnText, {
                  color: RENTAL_INTERVENTION_STATUS_COLORS[nextStatus],
                }]}>
                  {STATUS_NEXT_LABEL[intervention.status]}
                </Text>
              </Pressable>
            )}

            {intervention.status !== "cancelled" && intervention.status !== "completed" && (
              <Pressable style={detail.cancelBtn} onPress={handleCancel} disabled={saving}>
                <Text style={detail.cancelBtnText}>Annuler l'intervention</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </View>
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

    const propQ = query(
      collection(db, "properties"),
      where("landlordId", "==", user.uid)
    );

    const unsubProps = onSnapshot(propQ, (propSnap) => {
      unsubInterventions.forEach((u) => u());
      unsubInterventions = [];

      const props = propSnap.docs.map((d) => ({
        ...(d.data() as RentalProperty),
        id: d.id,
      }));

      setProperties(props.map((p) => ({
        id: p.id,
        label: [p.address, p.city].filter(Boolean).join(", "),
      })));

      if (props.length === 0) {
        setInterventions([]);
        setLoading(false);
        return;
      }

      const intMap = new Map<string, InterventionWithProperty[]>();
      let resolved = 0;

      props.forEach((prop) => {
        const intQ = query(
          collection(db, "properties", prop.id, "interventions"),
          orderBy("createdAt", "desc")
        );

        const propLabel = [prop.address, prop.city].filter(Boolean).join(", ");
        const unsub = onSnapshot(intQ, (snap) => {
          intMap.set(
            prop.id,
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<PropertyIntervention, "id">),
              propertyLabel: propLabel,
            }))
          );

          const all = Array.from(intMap.values())
            .flat()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setInterventions(all);
          resolved++;
          if (resolved >= props.length) setLoading(false);
        });

        unsubInterventions.push(unsub);
      });
    });

    return () => {
      unsubProps();
      unsubInterventions.forEach((u) => u());
    };
  }, [user]);

  useEffect(() => {
    const unsub = loadData();
    return unsub;
  }, [loadData]);

  const filtered = interventions.filter((i) => {
    if (filter === "active")    return i.status !== "completed" && i.status !== "cancelled";
    if (filter === "completed") return i.status === "completed" || i.status === "cancelled";
    return true;
  });

  const activeCount = interventions.filter(
    (i) => i.status !== "completed" && i.status !== "cancelled"
  ).length;

  return (
    <View style={[styles.root, { paddingTop }]}>
      {/* Header */}
      <View style={styles.header}>
        <HamburgerButton />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.title}>Interventions</Text>
          <Text style={styles.subtitle}>
            {loading ? "Chargement…" : `${activeCount} en cours · ${interventions.length} total`}
          </Text>
        </View>
        <Pressable style={styles.addBtn} onPress={() => setShowCreate(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Filtres */}
      <View style={styles.filterBar}>
        {(["active", "completed", "all"] as const).map((f) => (
          <Pressable
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f === "active" ? "En cours" : f === "completed" ? "Terminées" : "Tout"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Contenu */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="construct-outline" size={56} color={COLORS.textMuted} style={{ opacity: 0.4 }} />
          <Text style={styles.emptyTitle}>
            {interventions.length === 0 ? "Aucune intervention" : "Aucun résultat"}
          </Text>
          <Text style={styles.emptyDesc}>
            {interventions.length === 0
              ? "Planifiez et suivez vos interventions sur vos logements."
              : "Essayez un autre filtre."}
          </Text>
          {interventions.length === 0 && (
            <Pressable style={styles.ctaBtn} onPress={() => setShowCreate(true)}>
              <Text style={styles.ctaBtnText}>Créer une intervention</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
          {filtered.map((item) => {
            const color = RENTAL_INTERVENTION_STATUS_COLORS[item.status];
            const bg    = STATUS_BG[item.status];
            const label = RENTAL_INTERVENTION_STATUS_LABELS[item.status];
            const cat   = INTERVENTION_CATEGORIES.find((c) => c.id === (item as any).category)
              ?? INTERVENTION_CATEGORIES[INTERVENTION_CATEGORIES.length - 1];

            return (
              <Pressable
                key={item.id}
                style={styles.card}
                onPress={() => setSelected(item)}
              >
                <View style={[styles.catDot, { backgroundColor: bg }]}>
                  <Ionicons name={cat.icon as any} size={18} color={color} />
                </View>

                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: bg }]}>
                      <Text style={[styles.statusText, { color }]}>{label}</Text>
                    </View>
                  </View>
                  {item.propertyLabel ? (
                    <Text style={styles.cardProp} numberOfLines={1}>
                      <Ionicons name="home-outline" size={11} color={COLORS.textMuted} /> {item.propertyLabel}
                    </Text>
                  ) : null}
                  {item.scheduledDate ? (
                    <Text style={styles.cardDate}>
                      <Ionicons name="calendar-outline" size={11} color={COLORS.textMuted} /> {item.scheduledDate}
                    </Text>
                  ) : (
                    <Text style={styles.cardDate}>
                      {new Date(item.createdAt).toLocaleDateString("fr-FR", {
                        day: "numeric", month: "short",
                      })}
                    </Text>
                  )}
                </View>

                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Modales */}
      <CreateModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        properties={properties}
      />
      {selected && (
        <DetailModal
          intervention={selected}
          onClose={() => setSelected(null)}
        />
      )}
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

  filterBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingHorizontal: 16, paddingVertical: 10, gap: 8,
  },
  filterTab: {
    paddingHorizontal: 16, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: "#F8F8F8",
  },
  filterTabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterTabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  filterTabTextActive: { color: "#fff" },

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
  catDot: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  cardBody: { flex: 1, gap: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text, flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  cardProp: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  cardDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "center" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 },
  ctaBtn: {
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
    backgroundColor: "#FAFAFA", marginBottom: 16,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  catBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: "#F8F8F8",
  },
  catBtnActive: { borderColor: COLORS.primary, backgroundColor: "#EEF2FF" },
  catLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: "#F8F8F8",
  },
  chipActive: { borderColor: COLORS.primary, backgroundColor: "#EEF2FF" },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.primary },
  btn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: "center", marginTop: 8,
  },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

const detail = StyleSheet.create({
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
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  catIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  catLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  propLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  desc: {
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    lineHeight: 22, backgroundColor: "#F8F8F8", borderRadius: 10, padding: 14,
    marginBottom: 12,
  },
  infoGrid: { flexDirection: "row", gap: 16, marginBottom: 16 },
  infoCell: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoText: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary },

  noteLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 6 },
  noteInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    minHeight: 80, textAlignVertical: "top", marginBottom: 16,
  },

  actions: { gap: 10, marginTop: 4 },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  nextBtn: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 13, alignItems: "center" },
  nextBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cancelBtn: { borderRadius: 12, borderWidth: 1, borderColor: "#EF4444", paddingVertical: 13, alignItems: "center" },
  cancelBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#EF4444" },
});
