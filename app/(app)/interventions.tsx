import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState, useMemo, useCallback } from "react";
import {
  FlatList, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { wa, wConfirm } from "@/shared/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useInterventions } from "@/context/InterventionsContext";
import { useCoPro } from "@/context/CoProContext";
import { getApiUrl } from "@/lib/query-client";
import { auth } from "@/lib/firebase";
import {
  ALL_CATEGORIES, Category, CATEGORY_ICONS, CATEGORY_LABELS,
  Intervention, Status, STATUS_LABELS,
} from "@/shared/types";

const VISIBLE_CHIPS = 5;
const FlatListAny = FlatList as any;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { bg: string; text: string; dot: string; defaultOpen: boolean }> = {
  planifie: { bg: "#FFFBEB", text: "#92400E", dot: COLORS.warning,  defaultOpen: true  },
  en_cours: { bg: "#EFF6FF", text: "#1E40AF", dot: COLORS.primary,  defaultOpen: true  },
  termine:  { bg: "#D1FAE5", text: "#065F46", dot: COLORS.success,  defaultOpen: false },
};

// ── Maintenance helpers ───────────────────────────────────────────────────────

type MaintenanceStatus = "fait" | "a_venir" | "en_retard";

const MAINT_STATUS: Record<MaintenanceStatus, { bg: string; text: string; dot: string; label: string }> = {
  fait:      { bg: "#D1FAE5", text: "#065F46", dot: "#10B981", label: "Fait" },
  a_venir:   { bg: "#FFFBEB", text: "#92400E", dot: "#F59E0B", label: "À venir" },
  en_retard: { bg: "#FEE2E2", text: "#991B1B", dot: "#EF4444", label: "En retard" },
};

interface MaintenanceGroup {
  groupId: string;
  title: string;
  category: Category;
  technician?: string;
  frequency: string;
  lastDoneDate?: string;
  nextDueDate?: string;
  totalItems: number;
  doneItems: number;
  status: MaintenanceStatus;
  nextItemId: string;
  providerEmail?: string;
  providerName?: string;
  invitedProviderEmail?: string;
  invitedProviderName?: string;
}

function inferFrequency(items: Intervention[]): string {
  if (items.length < 2) return "Ponctuelle";
  const sorted = [...items].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86_400_000;
    gaps.push(gap);
  }
  const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (medianGap <= 8)   return "Hebdomadaire";
  if (medianGap <= 20)  return "Bi-mensuelle";
  if (medianGap <= 40)  return "Mensuelle";
  if (medianGap <= 100) return "Trimestrielle";
  if (medianGap <= 200) return "Semestrielle";
  return "Annuelle";
}

// ── Flat list types (interventions tab) ───────────────────────────────────────

type SectionHeader = { _t: "sh"; status: Status; total: number };
type GroupHeader   = { _t: "gh"; groupId: string; status: Status; title: string; category: Category; count: number; latestDate: string; earliestDate: string };
type ItemRow       = { _t: "item"; data: Intervention; inGroup: boolean };
type FlatItem = SectionHeader | GroupHeader | ItemRow;

// ── Maintenance group card ────────────────────────────────────────────────────

function MaintenanceGroupCard({ group, onPress, onRemind, isAdmin }: {
  group: MaintenanceGroup;
  onPress: () => void;
  onRemind?: () => void;
  isAdmin?: boolean;
}) {
  const sc = MAINT_STATUS[group.status];
  const iconName = (CATEGORY_ICONS[group.category] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;
  const colors = (COLORS.categoryColors as any)[group.category] ?? { bg: "#F1F5F9", text: "#334155" };
  const pct = group.totalItems > 0 ? Math.round((group.doneItems / group.totalItems) * 100) : 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.maintCard, pressed && { opacity: 0.82 }]}
      onPress={onPress}
    >
      <View style={styles.maintCardTop}>
        <View style={[styles.maintIcon, { backgroundColor: colors.bg }]}>
          <Ionicons name={iconName} size={22} color={colors.text} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.maintTitle} numberOfLines={1}>{group.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={styles.maintFreqBadge}>
              <Ionicons name="repeat" size={10} color={COLORS.teal} />
              <Text style={styles.maintFreqText}>{group.frequency}</Text>
            </View>
            {group.technician ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Ionicons name="business-outline" size={11} color={COLORS.textMuted} />
                <Text style={styles.maintCompany} numberOfLines={1}>{group.technician}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={[styles.maintStatusBadge, { backgroundColor: sc.bg }]}>
          <View style={[styles.maintStatusDot, { backgroundColor: sc.dot }]} />
          <Text style={[styles.maintStatusText, { color: sc.text }]}>{sc.label}</Text>
        </View>
      </View>

      <View style={styles.maintDates}>
        <View style={styles.maintDateItem}>
          <Text style={styles.maintDateLabel}>Dernière réalisation</Text>
          <Text style={[styles.maintDateValue, !group.lastDoneDate && styles.maintDateEmpty]}>
            {group.lastDoneDate
              ? new Date(group.lastDoneDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
              : "—"}
          </Text>
        </View>
        <View style={styles.maintDateDivider} />
        <View style={styles.maintDateItem}>
          <Text style={styles.maintDateLabel}>Prochaine prévue</Text>
          <Text style={[
            styles.maintDateValue,
            !group.nextDueDate && styles.maintDateEmpty,
            group.status === "en_retard" && { color: "#EF4444" },
          ]}>
            {group.nextDueDate
              ? new Date(group.nextDueDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
              : "—"}
          </Text>
        </View>
      </View>

      <View style={styles.maintProgress}>
        <View style={styles.maintProgressBar}>
          <View style={[
            styles.maintProgressFill,
            { width: `${pct}%` as any, backgroundColor: group.status === "fait" ? "#10B981" : sc.dot },
          ]} />
        </View>
        <Text style={styles.maintProgressText}>
          {group.doneItems}/{group.totalItems} effectuée{group.doneItems !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Bouton rappel — admin uniquement, si prestataire connu et maintenance non terminée */}
      {isAdmin && onRemind && group.status !== "fait" && group.providerEmail && (
        <Pressable
          style={({ pressed }) => [styles.reminderBtn, pressed && { opacity: 0.75 }]}
          onPress={(e) => { e.stopPropagation?.(); onRemind(); }}
        >
          <Ionicons name="notifications-outline" size={14} color="#D97706" />
          <Text style={styles.reminderBtnText}>Envoyer un rappel au prestataire</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

// ── Intervention card (one-time) ──────────────────────────────────────────────

function InterventionCard({ item, onPress, compact }: { item: Intervention; onPress: () => void; compact?: boolean }) {
  const sc = STATUS_CONFIG[item.status];
  const iconName = (CATEGORY_ICONS[item.category] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;
  const colors = (COLORS.categoryColors as any)[item.category] ?? { bg: "#F1F5F9", text: "#334155" };
  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        compact && styles.cardCompact,
        { borderLeftColor: sc.dot },
        pressed && { transform: [{ scale: 0.985 }] },
      ]}
      onPress={onPress}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, compact && styles.cardTitleCompact]} numberOfLines={compact ? 1 : 2}>
          {item.title}
        </Text>
        {(item as any).providerStatus === "refused" ? (
          <View style={[styles.statusBadge, { backgroundColor: "#FEF2F2", flexDirection: "row", alignItems: "center", gap: 4 }]}>
            <Ionicons name="close-circle" size={11} color="#DC2626" />
            <Text style={[styles.statusText, { color: "#DC2626" }]}>Refusée</Text>
          </View>
        ) : !compact ? (
          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: sc.dot }]} />
            <Text style={[styles.statusText, { color: sc.text }]}>{STATUS_LABELS[item.status]}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cardMeta}>
        <View style={[styles.catBadge, { backgroundColor: colors.bg }]}>
          <Ionicons name={iconName} size={11} color={colors.text} />
          <Text style={[styles.catText, { color: colors.text }]}>{CATEGORY_LABELS[item.category]}</Text>
        </View>
        <Text style={styles.metaSep}>·</Text>
        <Text style={styles.cardDate}>
          {new Date(item.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
        </Text>
        {item.technician ? (
          <>
            <Text style={styles.metaSep}>·</Text>
            <Ionicons name="person-outline" size={11} color={COLORS.textMuted} />
            <Text style={styles.techName} numberOfLines={1}>{item.technician}</Text>
          </>
        ) : null}
        {item.photos && item.photos.length > 0 ? (
          <>
            <Text style={styles.metaSep}>·</Text>
            <Ionicons name="image-outline" size={11} color={COLORS.textMuted} />
            <Text style={styles.photoCount}>{item.photos.length}</Text>
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

// ── Status section header ─────────────────────────────────────────────────────

function StatusSectionHeader({
  status, total, isOpen, onToggle,
}: { status: Status; total: number; isOpen: boolean; onToggle: () => void }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <Pressable
      style={[styles.sectionHeader, { borderLeftColor: cfg.dot, backgroundColor: cfg.bg }]}
      onPress={() => { Haptics.selectionAsync(); onToggle(); }}
    >
      <View style={styles.sectionHeaderLeft}>
        <View style={[styles.sectionDot, { backgroundColor: cfg.dot }]} />
        <Text style={[styles.sectionLabel, { color: cfg.text }]}>{STATUS_LABELS[status]}</Text>
        <View style={[styles.sectionCount, { backgroundColor: cfg.dot + "22" }]}>
          <Text style={[styles.sectionCountText, { color: cfg.text }]}>{total}</Text>
        </View>
      </View>
      <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={cfg.text} />
    </Pressable>
  );
}

// ── Recurrence group header ───────────────────────────────────────────────────

function RecurrenceGroupHeader({
  item, isOpen, onToggle,
}: { item: GroupHeader; isOpen: boolean; onToggle: () => void }) {
  const iconName = (CATEGORY_ICONS[item.category] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;
  const colors = (COLORS.categoryColors as any)[item.category] ?? { bg: "#F1F5F9", text: "#334155" };
  const dateFrom = new Date(item.earliestDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  const dateTo   = new Date(item.latestDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <Pressable
      style={({ pressed }) => [styles.groupHeader, pressed && { opacity: 0.85 }]}
      onPress={() => { Haptics.selectionAsync(); onToggle(); }}
    >
      <View style={[styles.groupIconWrap, { backgroundColor: colors.bg }]}>
        <Ionicons name={iconName} size={16} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.groupTitle} numberOfLines={1}>{item.title}</Text>
        <View style={styles.groupMeta}>
          <View style={styles.groupCountBadge}>
            <Ionicons name="repeat" size={10} color={COLORS.teal} />
            <Text style={styles.groupCountText}>{item.count} passage{item.count > 1 ? "s" : ""}</Text>
          </View>
          <Text style={styles.groupDateRange}>{dateFrom} → {dateTo}</Text>
        </View>
      </View>
      <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={COLORS.textMuted} />
    </Pressable>
  );
}

// ── Category picker modal ─────────────────────────────────────────────────────

function CategoryModal({
  visible, categories, selected, onSelect, onClose, insetBottom,
}: {
  visible: boolean; categories: Category[]; selected: Category | "all";
  onSelect: (cat: Category | "all") => void; onClose: () => void; insetBottom: number;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose} />
      <View style={[styles.modalSheet, { paddingBottom: insetBottom + 16 }]}>
        <View style={styles.modalHandle} />
        <Text style={styles.modalTitle}>Filtrer par catégorie</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          <Pressable
            style={[styles.modalCatRow, selected === "all" && styles.modalCatRowActive]}
            onPress={() => { Haptics.selectionAsync(); onSelect("all"); onClose(); }}
          >
            <View style={[styles.modalCatIcon, selected === "all" && { backgroundColor: COLORS.primary }]}>
              <Ionicons name="apps" size={18} color={selected === "all" ? "#fff" : COLORS.textMuted} />
            </View>
            <Text style={[styles.modalCatLabel, selected === "all" && styles.modalCatLabelActive]}>
              Toutes les catégories
            </Text>
            {selected === "all" && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
          </Pressable>
          {categories.map((cat) => {
            const isActive = selected === cat;
            const iconName = (CATEGORY_ICONS[cat] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;
            const colors = (COLORS.categoryColors as any)[cat] ?? { bg: "#F1F5F9", text: "#334155" };
            return (
              <Pressable
                key={cat}
                style={[styles.modalCatRow, isActive && styles.modalCatRowActive]}
                onPress={() => { Haptics.selectionAsync(); onSelect(cat); onClose(); }}
              >
                <View style={[styles.modalCatIcon, { backgroundColor: isActive ? COLORS.primary : colors.bg }]}>
                  <Ionicons name={iconName} size={18} color={isActive ? "#fff" : colors.text} />
                </View>
                <Text style={[styles.modalCatLabel, isActive && styles.modalCatLabelActive]}>
                  {CATEGORY_LABELS[cat]}
                </Text>
                {isActive && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function InterventionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { interventions, isLoading } = useInterventions();
  const { currentCopro, currentRole, categoryFilter, copros } = useCoPro();

  const isAdmin        = currentRole === "admin";
  const isPrestataire  = currentRole === "prestataire";
  const isProprietaire = currentRole === "propriétaire";
  const canAdd         = isAdmin || isPrestataire;
  const hasMultipleCopros     = isAdmin && copros.length > 1;
  const isFilteredPrestataire = isPrestataire && !!categoryFilter;

  const [activeTab,       setActiveTab]       = useState<"maintenances" | "interventions">("maintenances");
  const [search,          setSearch]          = useState("");
  const [catFilter,       setCatFilter]       = useState<Category | "all">("all");
  const [catModalVisible, setCatModalVisible] = useState(false);
  const [openStatuses,    setOpenStatuses]    = useState<Set<Status>>(() => new Set<Status>(["planifie", "en_cours"]));
  const [openGroups,      setOpenGroups]      = useState<Set<string>>(new Set<string>());
  const [sendingReminder, setSendingReminder] = useState<string | null>(null); // groupId en cours

  const top    = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const handleSendReminder = useCallback(async (group: MaintenanceGroup) => {
    if (!group.providerEmail || !currentCopro) return;
    wConfirm(
      "Envoyer un rappel ?",
      `Un email de rappel sera envoyé à ${group.providerName ?? group.providerEmail} pour la maintenance "${group.title}".`,
      async () => {
        setSendingReminder(group.groupId);
        try {
          const apiBase = getApiUrl();
          const currentUser = auth.currentUser;
          if (!apiBase || !currentUser) throw new Error("Non configuré");
          const idToken = await currentUser.getIdToken();
          const res = await fetch(`${apiBase}/api/remind-maintenance`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
              coProId: currentCopro.id,
              interventionId: group.nextItemId,
              providerEmail: group.providerEmail,
              providerName: group.providerName ?? "",
              coProName: currentCopro.name,
              title: group.title,
              nextDate: group.nextDueDate,
            }),
          });
          if (!res.ok) throw new Error("Erreur serveur");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          wa("Rappel envoyé ✓", `Email envoyé à ${group.providerEmail}`);
        } catch {
          wa("Erreur", "Impossible d'envoyer le rappel. Vérifiez votre connexion.");
        } finally {
          setSendingReminder(null);
        }
      },
      "Envoyer",
      false,
    );
  }, [currentCopro]);

  const enabledCategories: Category[] = useMemo(() => {
    const disabled = currentCopro?.disabledCategories ?? [];
    return ALL_CATEGORIES.filter((c) => !disabled.includes(c));
  }, [currentCopro?.disabledCategories]);

  const visibleChips = enabledCategories.slice(0, VISIBLE_CHIPS);
  const hasMore      = enabledCategories.length > VISIBLE_CHIPS;
  const selectedLabel = catFilter === "all" ? "Tout" : CATEGORY_LABELS[catFilter as Category];

  // Base filter (search + category)
  const filtered = useMemo(() => {
    return interventions.filter((i) => {
      const matchCat = catFilter === "all" || i.category === catFilter;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        i.title.toLowerCase().includes(q) ||
        (i.technician ?? "").toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [interventions, search, catFilter]);

  // Maintenances tab: items belonging to a recurrence group
  const maintenanceItems = useMemo(() => filtered.filter(i => !!i.recurrenceGroupId), [filtered]);

  // Interventions tab: one-time items (no recurrence group)
  const interventionItems = useMemo(() => filtered.filter(i => !i.recurrenceGroupId), [filtered]);

  // Build maintenance group summaries
  const maintenanceGroups = useMemo<MaintenanceGroup[]>(() => {
    const groups = new Map<string, Intervention[]>();
    for (const item of maintenanceItems) {
      const arr = groups.get(item.recurrenceGroupId!) ?? [];
      arr.push(item);
      groups.set(item.recurrenceGroupId!, arr);
    }
    const result: MaintenanceGroup[] = [];
    const now = new Date();
    for (const [groupId, items] of groups) {
      items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const done    = items.filter(i => i.status === "termine");
      const pending = items.filter(i => i.status !== "termine");
      let status: MaintenanceStatus;
      if (pending.length === 0) {
        status = "fait";
      } else if (pending.some(i => new Date(i.date) < now)) {
        status = "en_retard";
      } else {
        status = "a_venir";
      }
      const lastDone  = done.length > 0 ? done[done.length - 1] : undefined;
      const nextDue   = pending.length > 0 ? pending[0] : undefined;
      const latest    = items[items.length - 1];
      result.push({
        groupId,
        title: latest.title,
        category: latest.category,
        technician: latest.technician,
        frequency: inferFrequency(items),
        lastDoneDate: lastDone?.date,
        nextDueDate: nextDue?.date,
        totalItems: items.length,
        doneItems: done.length,
        status,
        nextItemId: nextDue?.id ?? lastDone?.id ?? items[0].id,
        providerEmail: latest.invitedProvider?.email,
        providerName: latest.invitedProvider?.name ?? latest.technician,
      });
    }
    const order: Record<MaintenanceStatus, number> = { en_retard: 0, a_venir: 1, fait: 2 };
    return result.sort((a, b) => order[a.status] - order[b.status]);
  }, [maintenanceItems]);

  // Build flat data for interventions FlatList
  const flatData = useMemo<FlatItem[]>(() => {
    const result: FlatItem[] = [];
    const statusOrder: Status[] = ["planifie", "en_cours", "termine"];
    for (const status of statusOrder) {
      const items = interventionItems.filter(i => i.status === status);
      if (items.length === 0) continue;
      result.push({ _t: "sh", status, total: items.length });
      if (!openStatuses.has(status)) continue;
      items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      for (const item of items) {
        result.push({ _t: "item", data: item, inGroup: false });
      }
    }
    return result;
  }, [interventionItems, openStatuses, openGroups]);

  const toggleStatus = useCallback((status: Status) => {
    setOpenStatuses(prev => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });
  }, []);

  const renderIntervention = useCallback(({ item }: { item: FlatItem }) => {
    if (item._t === "sh") {
      return (
        <StatusSectionHeader
          status={item.status}
          total={item.total}
          isOpen={openStatuses.has(item.status)}
          onToggle={() => toggleStatus(item.status)}
        />
      );
    }
    if (item._t === "gh") {
      return (
        <RecurrenceGroupHeader
          item={item}
          isOpen={openGroups.has(item.groupId)}
          onToggle={() => {
            setOpenGroups(prev => {
              const next = new Set(prev);
              next.has(item.groupId) ? next.delete(item.groupId) : next.add(item.groupId);
              return next;
            });
          }}
        />
      );
    }
    return (
      <View style={item.inGroup ? styles.inGroupItem : undefined}>
        {item.inGroup && <View style={styles.inGroupLine} />}
        <InterventionCard
          item={item.data}
          compact={item.inGroup}
          onPress={() => router.push(`/intervention/${item.data.id}`)}
        />
      </View>
    );
  }, [openStatuses, openGroups, toggleStatus, router]);

  // ── Shared search bar ──────────────────────────────────────────────────────

  const searchBar = (
    <View style={styles.searchWrap}>
      <Ionicons name="search-outline" size={16} color={COLORS.textMuted} />
      <TextInput
        style={styles.searchInput}
        placeholder="Rechercher..."
        placeholderTextColor={COLORS.textMuted}
        value={search}
        onChangeText={setSearch}
        returnKeyType="search"
      />
      {search.length > 0 && (
        <Pressable onPress={() => setSearch("")}>
          <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
        </Pressable>
      )}
    </View>
  );

  // ── Maintenance list header ────────────────────────────────────────────────

  const maintHeader = (
    <View>
      {searchBar}
      {maintenanceGroups.length > 0 && (
        <Text style={styles.resultCount}>
          {maintenanceGroups.length} contrat{maintenanceGroups.length !== 1 ? "s" : ""} de maintenance
        </Text>
      )}
    </View>
  );

  // ── Interventions list header ──────────────────────────────────────────────

  const interventionsHeader = (
    <View>
      {isProprietaire && (
        <View style={styles.bannerRow}>
          <Ionicons name="eye-outline" size={13} color={COLORS.primary} />
          <Text style={styles.bannerText}>Consultation uniquement</Text>
        </View>
      )}
      {isFilteredPrestataire && categoryFilter && (
        <View style={[styles.bannerRow, styles.bannerPurple]}>
          <Ionicons name="lock-closed" size={13} color="#7C3AED" />
          <Text style={[styles.bannerText, { color: "#7C3AED" }]}>
            Vue limitée · {CATEGORY_LABELS[categoryFilter]}
          </Text>
        </View>
      )}
      {searchBar}
      {!isFilteredPrestataire && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <Pressable
            style={[styles.catChip, catFilter === "all" && styles.catChipActive]}
            onPress={() => { Haptics.selectionAsync(); setCatFilter("all"); }}
          >
            <Ionicons name="apps" size={12} color={catFilter === "all" ? "#fff" : COLORS.textMuted} />
            <Text style={[styles.catChipText, catFilter === "all" && styles.catChipTextActive]}>Tout</Text>
          </Pressable>
          {enabledCategories.map((cat) => {
            const isActive = catFilter === cat;
            const iconName = (CATEGORY_ICONS[cat] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;
            return (
              <Pressable
                key={cat}
                style={[styles.catChip, isActive && styles.catChipActive]}
                onPress={() => { Haptics.selectionAsync(); setCatFilter(cat); }}
              >
                <Ionicons name={iconName} size={12} color={isActive ? "#fff" : COLORS.textMuted} />
                <Text style={[styles.catChipText, isActive && styles.catChipTextActive]} numberOfLines={1}>
                  {CATEGORY_LABELS[cat]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <Text style={styles.resultCount}>
        {interventionItems.length} intervention{interventionItems.length !== 1 ? "s" : ""}
        {catFilter !== "all" && <Text style={{ color: COLORS.primary }}> · {selectedLabel}</Text>}
      </Text>
    </View>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* Fixed top bar */}
      <View style={[styles.topBar, { paddingTop: top + 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitle}>Interventions</Text>
          {currentCopro?.name ? (
            hasMultipleCopros ? (
              <Pressable style={styles.coProSwitcher} onPress={() => router.navigate("/(app)")}>
                <Text style={styles.coProSubtitle} numberOfLines={1}>{currentCopro.name}</Text>
                <Ionicons name="swap-horizontal" size={13} color={COLORS.primary} />
              </Pressable>
            ) : (
              <Text style={styles.coProSubtitle}>{currentCopro.name}</Text>
            )
          ) : null}
        </View>
      </View>

      {/* Tab switcher */}
      <View style={styles.tabSwitcher}>
        <Pressable
          style={[styles.tabBtn, activeTab === "maintenances" && styles.tabBtnActive]}
          onPress={() => { Haptics.selectionAsync(); setActiveTab("maintenances"); }}
        >
          <Ionicons
            name="repeat-outline" size={15}
            color={activeTab === "maintenances" ? COLORS.primary : COLORS.textMuted}
          />
          <Text style={[styles.tabBtnText, activeTab === "maintenances" && styles.tabBtnTextActive]}>
            Maintenances
          </Text>
          {maintenanceGroups.some(g => g.status === "en_retard") && (
            <View style={[styles.tabBadge, { backgroundColor: "#EF4444" }]}>
              <Text style={styles.tabBadgeText}>
                {maintenanceGroups.filter(g => g.status === "en_retard").length}
              </Text>
            </View>
          )}
        </Pressable>
        <Pressable
          style={[styles.tabBtn, activeTab === "interventions" && styles.tabBtnActive]}
          onPress={() => { Haptics.selectionAsync(); setActiveTab("interventions"); }}
        >
          <Ionicons
            name="construct-outline" size={15}
            color={activeTab === "interventions" ? COLORS.primary : COLORS.textMuted}
          />
          <Text style={[styles.tabBtnText, activeTab === "interventions" && styles.tabBtnTextActive]}>
            Interventions
          </Text>
          {interventionItems.filter(i => i.status === "planifie" || i.status === "en_cours").length > 0 && (
            <View style={[styles.tabBadge, { backgroundColor: COLORS.primary }]}>
              <Text style={styles.tabBadgeText}>
                {interventionItems.filter(i => i.status !== "termine").length}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Maintenances tab */}
      {activeTab === "maintenances" && (
        <FlatListAny
          data={maintenanceGroups}
          keyExtractor={(g: MaintenanceGroup) => g.groupId}
          renderItem={({ item }: { item: MaintenanceGroup }) => (
            <MaintenanceGroupCard
              group={item}
              isAdmin={isAdmin}
              onPress={() => router.push(`/intervention/${item.nextItemId}`)}
              onRemind={() => handleSendReminder(item)}
            />
          )}
          ListHeaderComponent={maintHeader}
          ListEmptyComponent={!isLoading ? (
            <View style={styles.empty}>
              <Ionicons name="repeat-outline" size={42} color={COLORS.border} />
              <Text style={styles.emptyTitle}>Aucune maintenance programmée</Text>
              <Text style={styles.emptyDesc}>
                Les interventions récurrentes apparaissent ici automatiquement.
              </Text>
            </View>
          ) : null}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 80 }]}
          refreshControl={<RefreshControl refreshing={isLoading} tintColor={COLORS.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Interventions tab */}
      {activeTab === "interventions" && (
        <FlatListAny
          data={flatData}
          keyExtractor={(item: FlatItem, idx: number) =>
            item._t === "sh" ? `sh-${item.status}`
            : item._t === "gh" ? `gh-${item.groupId}`
            : `item-${item.data.id}-${idx}`
          }
          renderItem={renderIntervention}
          ListHeaderComponent={interventionsHeader}
          ListEmptyComponent={!isLoading ? (
            <View style={styles.empty}>
              <Ionicons name="search" size={32} color={COLORS.border} />
              <Text style={styles.emptyTitle}>Aucune intervention</Text>
              {catFilter !== "all" && (
                <Pressable onPress={() => setCatFilter("all")} style={styles.resetBtn}>
                  <Text style={styles.resetBtnText}>Effacer le filtre</Text>
                </Pressable>
              )}
            </View>
          ) : null}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 80 }]}
          refreshControl={<RefreshControl refreshing={isLoading} tintColor={COLORS.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB — add intervention (admin/prestataire only, on interventions tab) */}
      {canAdd && activeTab === "interventions" && (
        <Pressable
          style={[styles.fab, { bottom: bottom + 20 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/add"); }}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      )}

      <CategoryModal
        visible={catModalVisible}
        categories={enabledCategories}
        selected={catFilter}
        onSelect={setCatFilter}
        onClose={() => setCatModalVisible(false)}
        insetBottom={bottom}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  topBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  pageTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: COLORS.text },
  coProSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  coProSwitcher: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },

  tabSwitcher: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingHorizontal: 16,
  },
  tabBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 12, paddingHorizontal: 10, marginRight: 4,
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomColor: COLORS.primary },
  tabBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  tabBtnTextActive: { color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  tabBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
    backgroundColor: "#F59E0B",
  },
  tabBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },

  // Maintenance cards
  maintCard: {
    backgroundColor: COLORS.surface, borderRadius: 16,
    padding: 16, marginHorizontal: 16, marginTop: 10,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2, gap: 12,
  },
  maintCardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  maintIcon: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  maintTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text },
  maintFreqBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(14,186,170,0.1)", borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  maintFreqText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.teal },
  maintCompany: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, maxWidth: 120 },
  maintStatusBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  maintStatusDot: { width: 6, height: 6, borderRadius: 3 },
  maintStatusText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  maintDates: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.background, borderRadius: 12, padding: 12,
  },
  maintDateItem: { flex: 1, gap: 3 },
  maintDateLabel: { fontSize: 10, fontFamily: "Inter_500Medium", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.4 },
  maintDateValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  maintDateEmpty: { color: COLORS.textMuted },
  maintDateDivider: { width: 1, height: 32, backgroundColor: COLORS.border, marginHorizontal: 12 },
  maintProgress: { flexDirection: "row", alignItems: "center", gap: 10 },
  maintProgressBar: {
    flex: 1, height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: "hidden",
  },
  maintProgressFill: { height: 6, borderRadius: 3 },
  maintProgressText: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted, minWidth: 90, textAlign: "right" },

  reminderBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FFFBEB", borderRadius: 10,
    borderWidth: 1, borderColor: "#FDE68A",
    paddingHorizontal: 12, paddingVertical: 8,
    alignSelf: "flex-start",
  },
  reminderBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#D97706" },

  // Intervention cards
  card: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 16, marginHorizontal: 16, marginTop: 8,
    borderWidth: 1, borderLeftWidth: 4, borderColor: COLORS.border,
    overflow: "hidden",
  },
  cardCompact: { marginHorizontal: 4, borderRadius: 10, padding: 11 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  cardMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5 },
  metaSep: { fontSize: 11, color: COLORS.textMuted },
  catBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
  },
  catText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  photoCount: { fontSize: 11, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  cardTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text, lineHeight: 20 },
  cardTitleCompact: { fontSize: 13 },
  cardDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  techName: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, maxWidth: 110 },

  // Section headers
  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 16, marginTop: 20, marginBottom: 4,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 14, borderLeftWidth: 4, borderWidth: 1, borderColor: "transparent",
  },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionDot: { width: 9, height: 9, borderRadius: 5 },
  sectionLabel: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sectionCount: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  sectionCountText: { fontSize: 12, fontFamily: "Inter_700Bold" },

  groupHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginTop: 6, marginBottom: 2,
    paddingHorizontal: 14, paddingVertical: 11,
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    borderLeftWidth: 3, borderLeftColor: COLORS.teal,
  },
  groupIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  groupTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  groupMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupCountBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(14,186,170,0.12)", borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  groupCountText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.teal },
  groupDateRange: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  inGroupItem: { position: "relative", paddingLeft: 28 },
  inGroupLine: {
    position: "absolute", left: 28, top: 0, bottom: 0,
    width: 2, backgroundColor: "rgba(14,186,170,0.2)",
  },

  // Search & filters
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text },

  filterRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: 16,
    marginTop: 10, marginBottom: 2,
  },
  catChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  catChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  catChipMore: { borderColor: COLORS.primary },
  catChipText: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  catChipTextActive: { color: "#fff" },

  resultCount: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted,
    paddingHorizontal: 20, marginTop: 8, marginBottom: 4,
  },

  bannerRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: "rgba(37,99,235,0.07)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  bannerPurple: { backgroundColor: "rgba(124,58,237,0.07)" },
  bannerText: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.primary, flex: 1 },

  listContent: { paddingTop: 4, flexGrow: 1 },

  // Empty state
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "center" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
  resetBtn: {
    marginTop: 4, paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  resetBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },

  // FAB
  fab: {
    position: "absolute", right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: "center", justifyContent: "center",
    shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },

  // Category modal
  modalOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalSheet: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingTop: 12, marginTop: "auto",
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border,
    alignSelf: "center", marginBottom: 14,
  },
  modalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 12 },
  modalCatRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalCatRowActive: { backgroundColor: "rgba(37,99,235,0.05)", borderRadius: 10 },
  modalCatIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center",
  },
  modalCatLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text },
  modalCatLabelActive: { fontFamily: "Inter_600SemiBold", color: COLORS.primary },
});
