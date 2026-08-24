import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot,
  orderBy, query, Timestamp, updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import {
  Entretien, EntretienEquipement, EntretienPeriodicite, EntretienStatut, EntretienVisit,
  ENTRETIEN_EQUIPEMENT_ICONS, ENTRETIEN_EQUIPEMENT_LABELS,
  ENTRETIEN_PERIODICITE_DAYS, ENTRETIEN_PERIODICITE_LABELS,
  ENTRETIEN_STATUT_CONFIG, getEntretienStatut,
} from "@/shared/types";
import { wa, wConfirm } from "@/shared/dialogs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatShort(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function calcNextDate(lastVisit: string, periodicite: EntretienPeriodicite): string {
  const days = ENTRETIEN_PERIODICITE_DAYS[periodicite];
  const d = new Date(lastVisit);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

/** Auto-formate une saisie en JJ/MM/AAAA au fur et à mesure (gère backspace) */
function formatDateInput(raw: string, prev: string = ""): string {
  if (raw.length < prev.length) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

/** JJ/MM/AAAA (ou JJ-MM-AAAA) → AAAA-MM-JJ (ISO) pour Firestore */
function displayToIso(display: string): string {
  const sep = display.includes("/") ? "/" : "-";
  const parts = display.split(sep);
  if (parts.length !== 3 || parts[2].length !== 4) return "";
  return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
}

/** AAAA-MM-JJ (ISO) → JJ/MM/AAAA pour l'affichage */
function isoToDisplayDate(iso: string): string {
  if (!iso || iso.length < 10) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Aujourd'hui au format JJ/MM/AAAA */
function todayDisplay(): string {
  return isoToDisplayDate(new Date().toISOString().split("T")[0]);
}

const ALL_EQUIPEMENTS: EntretienEquipement[] = [
  "ascenseur", "vmc", "chaufferie", "portail", "interphone",
  "extincteurs", "desenfumage", "toiture", "facade",
  "espaces_verts", "piscine", "video_surveillance", "divers",
];

const ALL_PERIODICITES: EntretienPeriodicite[] = [
  "mensuel", "trimestriel", "semestriel", "annuel", "biennal",
];

// ─── Composant StatutBadge ─────────────────────────────────────────────────────

function StatutBadge({ statut }: { statut: EntretienStatut }) {
  const cfg = ENTRETIEN_STATUT_CONFIG[statut];
  return (
    <View style={[styles.statutBadge, { backgroundColor: cfg.bg }]}>
      <Ionicons name={cfg.icon as any} size={12} color={cfg.color} />
      <Text style={[styles.statutBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

// ─── Composant EntretienCard ───────────────────────────────────────────────────

function EntretienCard({
  entretien,
  onPress,
  onLogVisit,
}: {
  entretien: Entretien;
  onPress: () => void;
  onLogVisit: () => void;
}) {
  const statut = getEntretienStatut(entretien);
  const cfg = ENTRETIEN_STATUT_CONFIG[statut];
  const icon = ENTRETIEN_EQUIPEMENT_ICONS[entretien.equipement];
  const lastVisit = entretien.lastVisitDate ? formatShort(entretien.lastVisitDate) : null;
  const nextVisit = entretien.nextVisitDate ? formatShort(entretien.nextVisitDate) : null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      onPress={onPress}
    >
      <View style={[styles.cardAccent, { backgroundColor: cfg.color }]} />
      <View style={styles.cardMain}>
        <View style={styles.cardHeader}>
          <View style={[styles.cardIconWrap, { backgroundColor: cfg.bg }]}>
            <Ionicons name={icon as any} size={20} color={cfg.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>{entretien.label}</Text>
            {entretien.prestataire ? (
              <Text style={styles.cardSub} numberOfLines={1}>{entretien.prestataire}</Text>
            ) : null}
          </View>
          <StatutBadge statut={statut} />
        </View>

        <View style={styles.cardDates}>
          <View style={styles.cardDateItem}>
            <Text style={styles.cardDateLabel}>Dernière visite</Text>
            <Text style={[styles.cardDateValue, !lastVisit && styles.cardDateNone]}>
              {lastVisit ?? "Non renseignée"}
            </Text>
          </View>
          <View style={styles.cardDateDivider} />
          <View style={styles.cardDateItem}>
            <Text style={styles.cardDateLabel}>Prochaine visite</Text>
            <Text style={[styles.cardDateValue, statut === "retard" && { color: COLORS.danger }, !nextVisit && styles.cardDateNone]}>
              {nextVisit ?? "Non planifiée"}
            </Text>
          </View>
          <View style={styles.cardDateDivider} />
          <View style={styles.cardDateItem}>
            <Text style={styles.cardDateLabel}>Périodicité</Text>
            <Text style={styles.cardDateValue}>{ENTRETIEN_PERIODICITE_LABELS[entretien.periodicite]}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.cardVisitsCount}>
            {entretien.visits.length} visite{entretien.visits.length !== 1 ? "s" : ""} enregistrée{entretien.visits.length !== 1 ? "s" : ""}
          </Text>
          <Pressable style={styles.logBtn} onPress={onLogVisit}>
            <Ionicons name="add-circle-outline" size={14} color={COLORS.primary} />
            <Text style={styles.logBtnText}>Enregistrer une visite</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Modal Ajout/Édition équipement ───────────────────────────────────────────

interface EntretienForm {
  label: string;
  equipement: EntretienEquipement;
  periodicite: EntretienPeriodicite;
  prestataire: string;
  prestatairePhone: string;
  notes: string;
  lastVisitDate: string;
}

const EMPTY_FORM: EntretienForm = {
  label: "",
  equipement: "ascenseur",
  periodicite: "annuel",
  prestataire: "",
  prestatairePhone: "",
  notes: "",
  lastVisitDate: "",
};

function EquipementModal({
  visible,
  initial,
  onClose,
  onSave,
  saving,
}: {
  visible: boolean;
  initial?: Partial<EntretienForm>;
  onClose: () => void;
  onSave: (form: EntretienForm) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<EntretienForm>({ ...EMPTY_FORM, ...initial });
  const set = (k: keyof EntretienForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (visible) setForm({ ...EMPTY_FORM, ...initial });
  }, [visible]);

  const canSave = form.label.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.modalClose}>
            <Ionicons name="close" size={22} color={COLORS.text} />
          </Pressable>
          <Text style={styles.modalTitle}>{initial?.label ? "Modifier l'équipement" : "Nouvel équipement"}</Text>
          <Pressable
            style={[styles.modalSaveBtn, !canSave && { opacity: 0.4 }]}
            onPress={() => canSave && !saving && onSave(form)}
            disabled={!canSave || saving}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.modalSaveBtnText}>Enregistrer</Text>
            }
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
          {/* Nom */}
          <Text style={styles.fieldLabel}>Nom de l'équipement *</Text>
          <TextInput
            style={styles.input}
            value={form.label}
            onChangeText={set("label")}
            placeholder="Ex: Ascenseur bâtiment A, VMC RdC…"
            placeholderTextColor={COLORS.textMuted}
          />

          {/* Type */}
          <Text style={styles.fieldLabel}>Type d'équipement</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {ALL_EQUIPEMENTS.map((eq) => {
              const active = form.equipement === eq;
              return (
                <Pressable
                  key={eq}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    set("equipement")(eq);
                    if (!form.label || form.label === ENTRETIEN_EQUIPEMENT_LABELS[form.equipement]) {
                      set("label")(ENTRETIEN_EQUIPEMENT_LABELS[eq]);
                    }
                  }}
                >
                  <Ionicons
                    name={ENTRETIEN_EQUIPEMENT_ICONS[eq] as any}
                    size={13}
                    color={active ? "#fff" : COLORS.textSecondary}
                  />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {ENTRETIEN_EQUIPEMENT_LABELS[eq]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Périodicité */}
          <Text style={styles.fieldLabel}>Périodicité</Text>
          <View style={styles.periodiciteGrid}>
            {ALL_PERIODICITES.map((p) => {
              const active = form.periodicite === p;
              return (
                <Pressable
                  key={p}
                  style={[styles.periodiciteBtn, active && styles.periodiciteBtnActive]}
                  onPress={() => set("periodicite")(p)}
                >
                  <Text style={[styles.periodiciteBtnText, active && styles.periodiciteBtnTextActive]}>
                    {ENTRETIEN_PERIODICITE_LABELS[p]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Prestataire */}
          <Text style={styles.fieldLabel}>Prestataire</Text>
          <TextInput
            style={styles.input}
            value={form.prestataire}
            onChangeText={set("prestataire")}
            placeholder="Nom de la société (optionnel)"
            placeholderTextColor={COLORS.textMuted}
          />
          <TextInput
            style={[styles.input, { marginTop: 8 }]}
            value={form.prestatairePhone}
            onChangeText={set("prestatairePhone")}
            placeholder="Téléphone prestataire (optionnel)"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="phone-pad"
          />

          {/* Dernière visite */}
          <Text style={styles.fieldLabel}>Date de la dernière visite connue</Text>
          <TextInput
            style={styles.input}
            value={form.lastVisitDate}
            onChangeText={(v) => set("lastVisitDate")(formatDateInput(v, form.lastVisitDate))}
            placeholder="JJ/MM/AAAA (optionnel)"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="number-pad"
            maxLength={10}
          />
          <Text style={styles.fieldHint}>
            Ex : 15-03-2024. La prochaine date sera calculée automatiquement.
          </Text>

          {/* Notes */}
          <Text style={styles.fieldLabel}>Notes (contrat, référence…)</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            value={form.notes}
            onChangeText={set("notes")}
            placeholder="Numéro de contrat, remarques importantes…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={3}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Modal Enregistrement visite ───────────────────────────────────────────────

interface VisitForm {
  date: string;
  technicianName: string;
  notes: string;
}

function VisitModal({
  visible,
  entretienLabel,
  onClose,
  onSave,
  saving,
}: {
  visible: boolean;
  entretienLabel: string;
  onClose: () => void;
  onSave: (form: VisitForm) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<VisitForm>({ date: todayDisplay(), technicianName: "", notes: "" });
  const set = (k: keyof VisitForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (visible) setForm({ date: todayDisplay(), technicianName: "", notes: "" });
  }, [visible]);

  const canSave = form.date.length === 10;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.modalClose}>
            <Ionicons name="close" size={22} color={COLORS.text} />
          </Pressable>
          <Text style={styles.modalTitle} numberOfLines={1}>Visite — {entretienLabel}</Text>
          <Pressable
            style={[styles.modalSaveBtn, !canSave && { opacity: 0.4 }]}
            onPress={() => canSave && !saving && onSave(form)}
            disabled={!canSave || saving}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.modalSaveBtnText}>Valider</Text>
            }
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.fieldLabel}>Date de la visite *</Text>
          <TextInput
            style={styles.input}
            value={form.date}
            onChangeText={(v) => set("date")(formatDateInput(v, form.date))}
            placeholder="JJ/MM/AAAA"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="number-pad"
            maxLength={10}
          />

          <Text style={styles.fieldLabel}>Nom du technicien</Text>
          <TextInput
            style={styles.input}
            value={form.technicianName}
            onChangeText={set("technicianName")}
            placeholder="Prénom Nom (optionnel)"
            placeholderTextColor={COLORS.textMuted}
          />

          <Text style={styles.fieldLabel}>Observations / Rapport</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            value={form.notes}
            onChangeText={set("notes")}
            placeholder="RAS, anomalies constatées, pièces changées…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={4}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Modal Détail équipement ───────────────────────────────────────────────────

function DetailModal({
  visible,
  entretien,
  isAdmin,
  onClose,
  onEdit,
  onDelete,
  onDeleteVisit,
}: {
  visible: boolean;
  entretien: Entretien | null;
  isAdmin: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteVisit: (visitId: string) => void;
}) {
  if (!entretien) return null;
  const statut = getEntretienStatut(entretien);
  const cfg = ENTRETIEN_STATUT_CONFIG[statut];
  const sortedVisits = [...entretien.visits].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.modalClose}>
            <Ionicons name="close" size={22} color={COLORS.text} />
          </Pressable>
          <Text style={styles.modalTitle} numberOfLines={1}>{entretien.label}</Text>
          {isAdmin && (
            <Pressable style={styles.editHeaderBtn} onPress={onEdit}>
              <Text style={styles.editHeaderBtnText}>Modifier</Text>
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
          {/* Statut */}
          <View style={[styles.detailStatutBanner, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.detailStatutTitle, { color: cfg.color }]}>{cfg.label}</Text>
              {entretien.nextVisitDate && (
                <Text style={[styles.detailStatutSub, { color: cfg.color }]}>
                  {statut === "retard"
                    ? `Prévue le ${formatDate(entretien.nextVisitDate)}`
                    : `Prochaine le ${formatDate(entretien.nextVisitDate)}`
                  }
                </Text>
              )}
            </View>
          </View>

          {/* Infos */}
          <View style={styles.detailInfoCard}>
            <InfoRow icon="repeat-outline" label="Périodicité" value={ENTRETIEN_PERIODICITE_LABELS[entretien.periodicite]} />
            <InfoRow icon="calendar-outline" label="Dernière visite" value={entretien.lastVisitDate ? formatDate(entretien.lastVisitDate) : "Non renseignée"} />
            {entretien.prestataire && (
              <InfoRow icon="briefcase-outline" label="Prestataire" value={entretien.prestataire} />
            )}
            {entretien.prestatairePhone && (
              <InfoRow icon="call-outline" label="Téléphone" value={entretien.prestatairePhone} />
            )}
            {entretien.notes && (
              <InfoRow icon="document-text-outline" label="Notes" value={entretien.notes} multiline />
            )}
          </View>

          {/* Historique */}
          <Text style={styles.sectionTitle}>Historique des visites ({sortedVisits.length})</Text>

          {sortedVisits.length === 0 ? (
            <View style={styles.emptyVisits}>
              <Ionicons name="time-outline" size={28} color={COLORS.border} />
              <Text style={styles.emptyVisitsText}>Aucune visite enregistrée</Text>
            </View>
          ) : (
            sortedVisits.map((v, i) => (
              <View key={v.id} style={[styles.visitRow, i > 0 && { borderTopWidth: 1, borderTopColor: COLORS.border }]}>
                <View style={styles.visitDotCol}>
                  <View style={[styles.visitDot, { backgroundColor: i === 0 ? COLORS.success : COLORS.border }]} />
                  {i < sortedVisits.length - 1 && <View style={styles.visitLine} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.visitDate}>{formatDate(v.date)}</Text>
                  {v.technicianName && (
                    <Text style={styles.visitTech}>{v.technicianName}</Text>
                  )}
                  {v.notes && (
                    <Text style={styles.visitNotes}>{v.notes}</Text>
                  )}
                  <Text style={styles.visitBy}>Ajouté par {v.addedByName}</Text>
                </View>
                {isAdmin && (
                  <Pressable
                    style={styles.visitDeleteBtn}
                    onPress={() => wConfirm(
                      "Supprimer cette visite",
                      "Cette action est irréversible.",
                      () => onDeleteVisit(v.id),
                      "Supprimer"
                    )}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                  </Pressable>
                )}
              </View>
            ))
          )}

          {isAdmin && (
            <Pressable style={styles.deleteEquipBtn} onPress={onDelete}>
              <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
              <Text style={styles.deleteEquipBtnText}>Supprimer cet équipement</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function InfoRow({ icon, label, value, multiline }: { icon: string; label: string; value: string; multiline?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={16} color={COLORS.textMuted} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoRowLabel}>{label}</Text>
        <Text style={[styles.infoRowValue, multiline && { lineHeight: 20 }]}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Screen principal ──────────────────────────────────────────────────────────

const FlatListAny = FlatList as any;

export default function EntretienScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { currentCopro, currentRole } = useCoPro();

  const isAdmin = currentRole === "admin";
  const canEdit = currentRole === "admin" || currentRole === "conseil";

  const [entretiens, setEntretiens] = useState<Entretien[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [equipModalVisible, setEquipModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Entretien | null>(null);
  const [visitModalTarget, setVisitModalTarget] = useState<Entretien | null>(null);
  const [detailTarget, setDetailTarget] = useState<Entretien | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Chargement Firestore ──────────────────────────────────────────────────
  useEffect(() => {
    if (!currentCopro) return;
    const q = query(
      collection(db, "copros", currentCopro.id, "entretiens"),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const items: Entretien[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          coProId: currentCopro.id,
          equipement: data.equipement ?? "divers",
          label: data.label ?? "",
          prestataire: data.prestataire ?? undefined,
          prestatairePhone: data.prestatairePhone ?? undefined,
          periodicite: data.periodicite ?? "annuel",
          lastVisitDate: data.lastVisitDate ?? undefined,
          nextVisitDate: data.nextVisitDate ?? undefined,
          notes: data.notes ?? undefined,
          visits: (data.visits ?? []) as EntretienVisit[],
          createdBy: data.createdBy ?? "",
          createdByName: data.createdByName ?? "",
          createdAt: data.createdAt instanceof Timestamp
            ? data.createdAt.toDate().toISOString()
            : data.createdAt ?? "",
          updatedAt: data.updatedAt,
        } as Entretien;
      });
      setEntretiens(items);
      setLoading(false);
    });
    return () => unsub();
  }, [currentCopro?.id]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const ok = entretiens.filter((e) => getEntretienStatut(e) === "ok").length;
    const retard = entretiens.filter((e) => getEntretienStatut(e) === "retard").length;
    const bientot = entretiens.filter((e) => getEntretienStatut(e) === "bientot").length;
    return { ok, retard, bientot, total: entretiens.length };
  }, [entretiens]);

  // ── Sauvegarde équipement ─────────────────────────────────────────────────
  const handleSaveEquipement = useCallback(async (form: EntretienForm) => {
    if (!currentCopro || !user) return;
    setSaving(true);
    try {
      // Convertir JJ-MM-AAAA → AAAA-MM-JJ pour Firestore
      const lastVisitIso = form.lastVisitDate ? displayToIso(form.lastVisitDate) : "";
      const nextVisitDate = lastVisitIso && lastVisitIso.length === 10
        ? calcNextDate(lastVisitIso, form.periodicite)
        : undefined;

      const data: Record<string, unknown> = {
        equipement: form.equipement,
        label: form.label.trim(),
        periodicite: form.periodicite,
        prestataire: form.prestataire.trim() || null,
        prestatairePhone: form.prestatairePhone.trim() || null,
        notes: form.notes.trim() || null,
        lastVisitDate: lastVisitIso || null,
        nextVisitDate: nextVisitDate ?? null,
        updatedAt: new Date().toISOString(),
      };

      if (editTarget) {
        await updateDoc(doc(db, "copros", currentCopro.id, "entretiens", editTarget.id), data);
      } else {
        await addDoc(collection(db, "copros", currentCopro.id, "entretiens"), {
          ...data,
          visits: [],
          createdBy: user.uid,
          createdByName: user.displayName ?? user.email ?? "—",
          createdAt: Timestamp.now(),
        });
      }
      setEquipModalVisible(false);
      setEditTarget(null);
    } catch (e) {
      wa("Erreur", "Impossible de sauvegarder.");
    } finally {
      setSaving(false);
    }
  }, [currentCopro, user, editTarget]);

  // ── Enregistrer une visite ────────────────────────────────────────────────
  const handleSaveVisit = useCallback(async (form: VisitForm) => {
    if (!currentCopro || !user || !visitModalTarget) return;
    setSaving(true);
    try {
      // Convertir JJ-MM-AAAA → AAAA-MM-JJ pour Firestore
      const dateIso = displayToIso(form.date) || form.date;
      const visitId = `visit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newVisit: EntretienVisit = {
        id: visitId,
        date: dateIso,
        technicianName: form.technicianName.trim() || undefined,
        notes: form.notes.trim() || undefined,
        addedBy: user.uid,
        addedByName: user.displayName ?? user.email ?? "—",
        createdAt: new Date().toISOString(),
      };

      const nextVisitDate = calcNextDate(dateIso, visitModalTarget.periodicite);
      const updatedVisits = [...visitModalTarget.visits, newVisit];

      await updateDoc(doc(db, "copros", currentCopro.id, "entretiens", visitModalTarget.id), {
        visits: updatedVisits,
        lastVisitDate: dateIso,
        nextVisitDate,
        updatedAt: new Date().toISOString(),
      });

      // Met à jour detailTarget si le modal détail est ouvert
      if (detailTarget?.id === visitModalTarget.id) {
        setDetailTarget({
          ...visitModalTarget,
          visits: updatedVisits,
          lastVisitDate: dateIso,
          nextVisitDate,
        });
      }

      setVisitModalTarget(null);
    } catch (e) {
      wa("Erreur", "Impossible d'enregistrer la visite.");
    } finally {
      setSaving(false);
    }
  }, [currentCopro, user, visitModalTarget, detailTarget]);

  // ── Supprimer une visite ─────────────────────────────────────────────────
  const handleDeleteVisit = useCallback(async (visitId: string) => {
    if (!currentCopro || !detailTarget) return;
    const updatedVisits = detailTarget.visits.filter((v) => v.id !== visitId);
    const sorted = [...updatedVisits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const lastVisitDate = sorted[0]?.date ?? null;
    const nextVisitDate = lastVisitDate ? calcNextDate(lastVisitDate, detailTarget.periodicite) : null;
    try {
      await updateDoc(doc(db, "copros", currentCopro.id, "entretiens", detailTarget.id), {
        visits: updatedVisits,
        lastVisitDate,
        nextVisitDate,
        updatedAt: new Date().toISOString(),
      });
      setDetailTarget({ ...detailTarget, visits: updatedVisits, lastVisitDate: lastVisitDate ?? undefined, nextVisitDate: nextVisitDate ?? undefined });
    } catch {
      wa("Erreur", "Impossible de supprimer la visite.");
    }
  }, [currentCopro, detailTarget]);

  // ── Supprimer un équipement ───────────────────────────────────────────────
  const handleDeleteEntretien = useCallback(() => {
    if (!currentCopro || !detailTarget) return;
    wConfirm(
      "Supprimer cet équipement",
      `Supprimer "${detailTarget.label}" et tout son historique ? Cette action est irréversible.`,
      async () => {
        try {
          await deleteDoc(doc(db, "copros", currentCopro.id, "entretiens", detailTarget.id));
          setDetailTarget(null);
        } catch {
          wa("Erreur", "Impossible de supprimer.");
        }
      },
      "Supprimer"
    );
  }, [currentCopro, detailTarget]);

  const top = Platform.OS === "web" ? 67 : insets.top;

  // ── Render ────────────────────────────────────────────────────────────────
  const header = (
    <View>
      <View style={[styles.header, { paddingTop: top + 16 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Carnet d'entretien</Text>
          <Text style={styles.headerSub}>{currentCopro?.name ?? ""}</Text>
        </View>
        {canEdit && (
          <Pressable
            style={styles.addBtn}
            onPress={() => { setEditTarget(null); setEquipModalVisible(true); }}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        )}
      </View>

      {/* Bandeau stats */}
      {entretiens.length > 0 && (
        <View style={styles.statsRow}>
          <StatPill color={COLORS.success} icon="checkmark-circle" label="À jour" value={stats.ok} />
          <StatPill color={COLORS.warning} icon="time" label="Bientôt dû" value={stats.bientot} />
          <StatPill color={COLORS.danger} icon="warning" label="En retard" value={stats.retard} />
          <StatPill color={COLORS.textMuted} icon="help-circle" label="Total" value={stats.total} />
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      {loading ? (
        <View style={[styles.root, { justifyContent: "center", alignItems: "center" }]}>
          {header}
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        </View>
      ) : (
        <FlatListAny
          data={entretiens}
          keyExtractor={(e: Entretien) => e.id}
          renderItem={({ item }: { item: Entretien }) => (
            <EntretienCard
              entretien={item}
              onPress={() => setDetailTarget(item)}
              onLogVisit={() => canEdit ? setVisitModalTarget(item) : setDetailTarget(item)}
            />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="clipboard-outline" size={44} color={COLORS.border} />
              <Text style={styles.emptyTitle}>Aucun équipement suivi</Text>
              <Text style={styles.emptyDesc}>
                {canEdit
                  ? "Appuyez sur + pour ajouter votre premier équipement (ascenseur, VMC, chaufferie…)"
                  : "Le syndic n'a pas encore renseigné le carnet d'entretien."}
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modal équipement */}
      <EquipementModal
        visible={equipModalVisible}
        initial={editTarget ? {
          label: editTarget.label,
          equipement: editTarget.equipement,
          periodicite: editTarget.periodicite,
          prestataire: editTarget.prestataire ?? "",
          prestatairePhone: editTarget.prestatairePhone ?? "",
          notes: editTarget.notes ?? "",
          lastVisitDate: isoToDisplayDate(editTarget.lastVisitDate ?? ""),
        } : undefined}
        onClose={() => { setEquipModalVisible(false); setEditTarget(null); }}
        onSave={handleSaveEquipement}
        saving={saving}
      />

      {/* Modal visite */}
      <VisitModal
        visible={!!visitModalTarget}
        entretienLabel={visitModalTarget?.label ?? ""}
        onClose={() => setVisitModalTarget(null)}
        onSave={handleSaveVisit}
        saving={saving}
      />

      {/* Modal détail */}
      <DetailModal
        visible={!!detailTarget}
        entretien={detailTarget}
        isAdmin={isAdmin}
        onClose={() => setDetailTarget(null)}
        onEdit={() => {
          setEditTarget(detailTarget);
          setDetailTarget(null);
          setEquipModalVisible(true);
        }}
        onDelete={handleDeleteEntretien}
        onDeleteVisit={handleDeleteVisit}
      />
    </View>
  );
}

function StatPill({ color, icon, label, value }: { color: string; icon: string; label: string; value: number }) {
  return (
    <View style={styles.statPill}>
      <Ionicons name={icon as any} size={14} color={color} />
      <Text style={[styles.statPillValue, { color }]}>{value}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    backgroundColor: COLORS.dark,
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: {
    fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff",
  },
  headerSub: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)", marginTop: 1,
  },
  addBtn: {
    width: 40, height: 40, borderRadius: 13,
    backgroundColor: COLORS.primary,
    alignItems: "center", justifyContent: "center",
  },

  statsRow: {
    flexDirection: "row", backgroundColor: COLORS.dark,
    paddingHorizontal: 16, paddingBottom: 16, gap: 8,
  },
  statPill: {
    flex: 1, alignItems: "center", backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 12, paddingVertical: 10, gap: 2,
  },
  statPillValue: {
    fontSize: 16, fontFamily: "Inter_700Bold",
  },
  statPillLabel: {
    fontSize: 10, fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.45)", textAlign: "center",
  },

  // Cards
  card: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 16, borderWidth: 1, borderColor: COLORS.border,
    overflow: "hidden",
    flexDirection: "row",
  },
  cardAccent: {
    width: 4, borderTopLeftRadius: 16, borderBottomLeftRadius: 16,
  },
  cardMain: { flex: 1, padding: 14 },
  cardHeader: {
    flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12,
  },
  cardIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: {
    fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text,
  },
  cardSub: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1,
  },

  statutBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  statutBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  cardDates: {
    flexDirection: "row", backgroundColor: COLORS.surfaceAlt,
    borderRadius: 10, overflow: "hidden",
  },
  cardDateItem: {
    flex: 1, alignItems: "center", paddingVertical: 8,
  },
  cardDateDivider: { width: 1, backgroundColor: COLORS.border },
  cardDateLabel: {
    fontSize: 10, fontFamily: "Inter_500Medium", color: COLORS.textMuted,
  },
  cardDateValue: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginTop: 2,
  },
  cardDateNone: { color: COLORS.textMuted, fontFamily: "Inter_400Regular" },

  cardFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  cardVisitsCount: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted,
  },
  logBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: "rgba(37,99,235,0.08)", borderRadius: 8,
  },
  logBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.primary },

  // Empty
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  emptyDesc: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, textAlign: "center", lineHeight: 19,
  },

  // Modal communs
  modalRoot: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingTop: Platform.OS === "ios" ? 14 : 14,
  },
  modalClose: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center",
  },
  modalTitle: {
    flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text,
  },
  modalSaveBtn: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    alignItems: "center", justifyContent: "center", minWidth: 90,
  },
  modalSaveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  editHeaderBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 10,
  },
  editHeaderBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.primary },

  modalBody: { padding: 16, gap: 0, paddingBottom: 40 },

  // Fields
  fieldLabel: {
    fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary,
    marginTop: 16, marginBottom: 6,
  },
  fieldHint: {
    fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 4,
  },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1,
    borderColor: COLORS.border, padding: 12, fontSize: 14,
    fontFamily: "Inter_400Regular", color: COLORS.text,
  },
  inputMulti: { minHeight: 90, textAlignVertical: "top" },

  chipRow: { gap: 8, paddingVertical: 2 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: COLORS.surface, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  chipTextActive: { color: "#fff" },

  periodiciteGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  periodiciteBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: COLORS.surface, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  periodiciteBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  periodiciteBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.text },
  periodiciteBtnTextActive: { color: "#fff" },

  // Détail
  detailStatutBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, padding: 14, marginBottom: 4,
  },
  detailStatutTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  detailStatutSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  detailInfoCard: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 14, gap: 12, marginVertical: 12,
  },
  infoRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  infoRowLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  infoRowValue: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, marginTop: 1 },

  sectionTitle: {
    fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 8,
  },

  // Visites
  visitRow: {
    flexDirection: "row", gap: 12, paddingVertical: 12,
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 12, marginBottom: 8,
  },
  visitDotCol: { alignItems: "center", paddingTop: 3 },
  visitDot: { width: 10, height: 10, borderRadius: 5 },
  visitLine: { width: 2, flex: 1, backgroundColor: COLORS.border, marginTop: 4 },
  visitDate: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  visitTech: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textSecondary, marginTop: 2 },
  visitNotes: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, marginTop: 4, lineHeight: 19 },
  visitBy: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 4 },
  visitDeleteBtn: { padding: 4 },

  emptyVisits: { alignItems: "center", paddingVertical: 24, gap: 8 },
  emptyVisitsText: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  deleteEquipBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 24, paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: "rgba(239,68,68,0.06)",
    borderRadius: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.15)",
    justifyContent: "center",
  },
  deleteEquipBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.danger },
});
