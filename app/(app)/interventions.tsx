import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState, useMemo, useCallback } from "react";
import {
  FlatList, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useInterventions } from "@/context/InterventionsContext";
import { useCoPro } from "@/context/CoProContext";
import {
  ALL_CATEGORIES, Category, CATEGORY_ICONS, CATEGORY_LABELS,
  Intervention, Status, STATUS_LABELS, EntryType,
} from "@/shared/types";

const VISIBLE_CHIPS = 5;
const FlatListAny = FlatList as any;

const STATUS_CONFIG: Record<Status, { bg: string; text: string; dot: string; icon: keyof typeof Ionicons.glyphMap; defaultOpen: boolean }> = {
  planifie:  { bg: "#FFFBEB", text: "#92400E", dot: COLORS.warning,  icon: "calendar-outline",     defaultOpen: true  },
  en_cours:  { bg: "#EFF6FF", text: "#1E40AF", dot: COLORS.primary,  icon: "play-circle-outline",  defaultOpen: true  },
  termine:   { bg: "#D1FAE5", text: "#065F46", dot: COLORS.success,  icon: "checkmark-circle-outline", defaultOpen: false },
};

type SectionHeader = { _t: "sh"; status: Status; total: number };
type GroupHeader   = { _t: "gh"; groupId: string; status: Status; title: string; category: Category; count: number; latestDate: string; earliestDate: string };
type ItemRow       = { _t: "item"; data: Intervention; inGroup: boolean };
type FlatItem = SectionHeader | GroupHeader | ItemRow;

function InterventionCard({ item, onPress, compact }: { item: Intervention; onPress: () => void; compact?: boolean }) {
  const sc = STATUS_CONFIG[item.status];
  const iconName = (CATEGORY_ICONS[item.category] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;
  const colors = (COLORS.categoryColors as any)[item.category] ?? { bg: "#F1F5F9", text: "#334155" };
  return (
    <Pressable
      style={({ pressed }) => [styles.card, compact && styles.cardCompact, pressed && { opacity: 0.8 }]}
      onPress={onPress}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardMeta}>
          <View style={[styles.catBadge, { backgroundColor: colors.bg }]}>
            <Ionicons name={iconName} size={11} color={colors.text} />
            <Text style={[styles.catText, { color: colors.text }]}>{CATEGORY_LABELS[item.category]}</Text>
          </View>
          {!compact && (
            <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
              <View style={[styles.statusDot, { backgroundColor: sc.dot }]} />
              <Text style={[styles.statusText, { color: sc.text }]}>{STATUS_LABELS[item.status]}</Text>
            </View>
          )}
          {item.recurrenceIndex != null && item.recurrenceTotal != null && (
            <View style={styles.recBadge}>
              <Ionicons name="repeat" size={9} color={COLORS.teal} />
              <Text style={styles.recBadgeText}>{item.recurrenceIndex + 1}/{item.recurrenceTotal}</Text>
            </View>
          )}
        </View>
        {item.photos && item.photos.length > 0 && (
          <View style={styles.photoIndicator}>
            <Ionicons name="image-outline" size={13} color={COLORS.textMuted} />
            <Text style={styles.photoCount}>{item.photos.length}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.cardTitle, compact && styles.cardTitleCompact]} numberOfLines={2}>{item.title}</Text>
      {!compact && item.description ? (
        <Text style={styles.cardDesc} numberOfLines={1}>{item.description}</Text>
      ) : null}
      <View style={styles.cardFooter}>
        <Text style={styles.cardDate}>
          {new Date(item.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
        </Text>
        {item.technician ? (
          <View style={styles.techRow}>
            <Ionicons name="person-outline" size={12} color={COLORS.textMuted} />
            <Text style={styles.techName}>{item.technician}</Text>
          </View>
        ) : null}
        {item.rating ? (
          <Text style={styles.rating}>{"★".repeat(item.rating)}{"☆".repeat(4 - item.rating)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function StatusSectionHeader({
  status, total, isOpen, onToggle,
}: { status: Status; total: number; isOpen: boolean; onToggle: () => void }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <Pressable
      style={[styles.sectionHeader, { borderLeftColor: cfg.dot }]}
      onPress={() => { Haptics.selectionAsync(); onToggle(); }}
    >
      <View style={[styles.sectionHeaderLeft]}>
        <View style={[styles.sectionDot, { backgroundColor: cfg.dot }]} />
        <Text style={[styles.sectionLabel, { color: cfg.text }]}>{STATUS_LABELS[status]}</Text>
        <View style={[styles.sectionCount, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.sectionCountText, { color: cfg.text }]}>{total}</Text>
        </View>
      </View>
      <Ionicons
        name={isOpen ? "chevron-up" : "chevron-down"}
        size={16}
        color={COLORS.textMuted}
      />
    </Pressable>
  );
}

function RecurrenceGroupHeader({
  item, isOpen, onToggle,
}: { item: GroupHeader; isOpen: boolean; onToggle: () => void }) {
  const iconName = (CATEGORY_ICONS[item.category] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;
  const colors = (COLORS.categoryColors as any)[item.category] ?? { bg: "#F1F5F9", text: "#334155" };
  const cfg = STATUS_CONFIG[item.status];
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
      <Ionicons
        name={isOpen ? "chevron-up" : "chevron-down"}
        size={16}
        color={COLORS.textMuted}
      />
    </Pressable>
  );
}

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


export default function InterventionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { interventions, isLoading } = useInterventions();
  const { currentCopro, currentRole, categoryFilter, copros } = useCoPro();

  const isAdmin        = currentRole === "admin";
  const isPrestataire  = currentRole === "prestataire";
  const isProprietaire = currentRole === "propriétaire";
  const canAdd         = isAdmin || isPrestataire;
  const hasMultipleCopros      = isAdmin && copros.length > 1;
  const isFilteredPrestataire  = isPrestataire && !!categoryFilter;

  const [search,             setSearch]             = useState("");
  const [catFilter,          setCatFilter]          = useState<Category | "all">("all");
  const [catModalVisible,    setCatModalVisible]    = useState(false);

  const [openStatuses, setOpenStatuses] = useState<Set<Status>>(
    () => new Set<Status>(["planifie", "en_cours"])
  );

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set<string>());

  const top    = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const enabledCategories: Category[] = useMemo(() => {
    const disabled = currentCopro?.disabledCategories ?? [];
    return ALL_CATEGORIES.filter((c) => !disabled.includes(c));
  }, [currentCopro?.disabledCategories]);

  const visibleChips = enabledCategories.slice(0, VISIBLE_CHIPS);
  const hasMore      = enabledCategories.length > VISIBLE_CHIPS;
  const selectedLabel = catFilter === "all" ? "Tout" : CATEGORY_LABELS[catFilter as Category];

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

  const flatData = useMemo<FlatItem[]>(() => {
    const result: FlatItem[] = [];
    const statusOrder: Status[] = ["planifie", "en_cours", "termine"];

    for (const status of statusOrder) {
      const items = filtered.filter(i => i.status === status);
      if (items.length === 0) continue;

      result.push({ _t: "sh", status, total: items.length });

      if (!openStatuses.has(status)) continue;

      const groups = new Map<string, Intervention[]>();
      const ungrouped: Intervention[] = [];

      for (const item of items) {
        if (item.recurrenceGroupId) {
          const arr = groups.get(item.recurrenceGroupId) ?? [];
          arr.push(item);
          groups.set(item.recurrenceGroupId, arr);
        } else {
          ungrouped.push(item);
        }
      }

      ungrouped.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      for (const item of ungrouped) {
        result.push({ _t: "item", data: item, inGroup: false });
      }

      for (const [groupId, groupItems] of groups) {
        groupItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latest   = groupItems[0];
        const earliest = groupItems[groupItems.length - 1];
        result.push({
          _t: "gh",
          groupId,
          status,
          title: latest.title,
          category: latest.category,
          count: groupItems.length,
          latestDate: latest.date,
          earliestDate: earliest.date,
        });
        if (openGroups.has(groupId)) {
          for (const item of groupItems) {
            result.push({ _t: "item", data: item, inGroup: true });
          }
        }
      }
    }
    return result;
  }, [filtered, openStatuses, openGroups]);

  const toggleStatus = useCallback((status: Status) => {
    setOpenStatuses(prev => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((groupId: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }, []);

  const renderItem = useCallback(({ item }: { item: FlatItem }) => {
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
          onToggle={() => toggleGroup(item.groupId)}
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
  }, [openStatuses, openGroups, toggleStatus, toggleGroup, router]);

  const header = (
    <View>
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
        {canAdd && (
          <Pressable style={styles.addBtn} onPress={() => router.push("/add")}>
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        )}
      </View>

      {isProprietaire && (
        <View style={styles.proprietaireBanner}>
          <Ionicons name="eye-outline" size={13} color={COLORS.primary} />
          <Text style={styles.proprietaireBannerText}>
            Consultation uniquement
          </Text>
        </View>
      )}

      {isFilteredPrestataire && categoryFilter && (
        <View style={styles.filterBanner}>
          <Ionicons name="lock-closed" size={13} color="#7C3AED" />
          <Text style={styles.filterBannerText}>
            Vue limitée · {CATEGORY_LABELS[categoryFilter]}
          </Text>
        </View>
      )}

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

      {!isFilteredPrestataire && (
        <View style={styles.filterRow}>
          <Pressable
            style={[styles.catChip, catFilter === "all" && styles.catChipActive]}
            onPress={() => { Haptics.selectionAsync(); setCatFilter("all"); }}
          >
            <Ionicons name="apps" size={12} color={catFilter === "all" ? "#fff" : COLORS.textMuted} />
            <Text style={[styles.catChipText, catFilter === "all" && styles.catChipTextActive]}>Tout</Text>
          </Pressable>

          {visibleChips.map((cat) => {
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

          {hasMore && (
            <Pressable
              style={[
                styles.catChip, styles.catChipMore,
                !visibleChips.includes(catFilter as Category) && catFilter !== "all" && styles.catChipActive,
              ]}
              onPress={() => { Haptics.selectionAsync(); setCatModalVisible(true); }}
            >
              <Ionicons
                name="grid-outline"
                size={12}
                color={!visibleChips.includes(catFilter as Category) && catFilter !== "all" ? "#fff" : COLORS.primary}
              />
              <Text style={[
                styles.catChipText,
                { color: !visibleChips.includes(catFilter as Category) && catFilter !== "all" ? "#fff" : COLORS.primary },
              ]}>
                {!visibleChips.includes(catFilter as Category) && catFilter !== "all"
                  ? selectedLabel
                  : `+${enabledCategories.length - VISIBLE_CHIPS}`}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <Text style={styles.resultCount}>
        {filtered.length} résultat{filtered.length !== 1 ? "s" : ""}
        {catFilter !== "all" && (
          <Text style={{ color: COLORS.primary }}> · {selectedLabel}</Text>
        )}
      </Text>
    </View>
  );

  const empty = (
    <View style={styles.empty}>
      <Ionicons name="search" size={32} color={COLORS.border} />
      <Text style={styles.emptyText}>Aucune intervention trouvée</Text>
      {catFilter !== "all" && (
        <Pressable onPress={() => setCatFilter("all")} style={styles.resetBtn}>
          <Text style={styles.resetBtnText}>Effacer le filtre</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatListAny
        data={flatData}
        keyExtractor={(item: FlatItem, idx: number) =>
          item._t === "sh" ? `sh-${item.status}`
          : item._t === "gh" ? `gh-${item.groupId}`
          : `item-${item.data.id}`
        }
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={!isLoading ? empty : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={isLoading} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      />

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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  pageTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: COLORS.text },
  coProSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  coProSwitcher: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  addBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center",
  },

  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text },

  proprietaireBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: "rgba(37,99,235,0.07)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  proprietaireBannerText: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.primary, flex: 1 },

  filterBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: "rgba(124,58,237,0.07)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  filterBannerText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#7C3AED", flex: 1 },

  filterRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: 16,
    marginTop: 10, marginBottom: 2, flexWrap: "nowrap",
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

  listContent: { paddingTop: 4 },

  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderLeftWidth: 3,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionCount: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  sectionCountText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  groupHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginTop: 6, marginBottom: 2,
    paddingHorizontal: 14, paddingVertical: 11,
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    borderLeftWidth: 3, borderLeftColor: COLORS.teal,
  },
  groupIconWrap: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
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

  card: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, marginHorizontal: 16, marginTop: 6,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardCompact: { marginHorizontal: 4, borderRadius: 10, padding: 11, borderLeftWidth: 0 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  cardMeta: { flexDirection: "row", gap: 6, flexWrap: "wrap", flex: 1 },
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
  recBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8,
    backgroundColor: "rgba(14,186,170,0.1)",
  },
  recBadgeText: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: COLORS.teal },
  photoIndicator: { flexDirection: "row", alignItems: "center", gap: 3 },
  photoCount: { fontSize: 11, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  progBadge: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 3 },
  cardTitleCompact: { fontSize: 13, marginBottom: 2 },
  cardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginBottom: 4 },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  cardDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  techRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  techName: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  rating: { fontSize: 12, color: COLORS.warning },

  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 32, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
  resetBtn: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  resetBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },

  sigSection: { marginTop: 10, marginHorizontal: 16 },

  sigPanel: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, overflow: "hidden",
  },
  sigPanelHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12,
  },
  sigPanelHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  sigPanelTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  sigPanelBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  sigPanelBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sigPanelEmpty: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  sigPanelEmptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  sigSubHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: COLORS.background,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  sigSubHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  sigSubDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.primary },
  sigSubTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  sigSubCount: {
    fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted,
    backgroundColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 1,
  },

  sigCard: {
    marginHorizontal: 10, marginBottom: 6,
    backgroundColor: "#FFFDF5", borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
    padding: 12, gap: 6,
  },
  sigCardAck: { backgroundColor: "#F0FDF4", borderColor: "rgba(16,185,129,0.2)" },
  sigCardOwn: { backgroundColor: "rgba(37,99,235,0.04)", borderColor: "rgba(37,99,235,0.15)" },
  sigCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  sigAvatarWrap: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  sigAvatarOwn: { backgroundColor: "rgba(37,99,235,0.1)" },
  sigName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  ownBadge: {
    fontSize: 9, fontFamily: "Inter_600SemiBold", color: COLORS.primary,
    backgroundColor: "rgba(37,99,235,0.1)",
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1,
  },
  sigAppt: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  sigDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  sigAckBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  sigAckText: { fontSize: 10, fontFamily: "Inter_500Medium", color: COLORS.success },
  sigMessage: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.text },
  sigPhoto: { width: 160, height: 110, borderRadius: 8 },
  sigPhotoZoom: {
    position: "absolute", bottom: 4, right: 4,
    backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 10,
    padding: 3,
  },

  sigNewBtn: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 14, paddingVertical: 11,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  sigNewBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },

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

  signalSheetScroll: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingTop: 12,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
  },
  signalHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  signalIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.12)", alignItems: "center", justifyContent: "center",
  },
  signalSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 3 },
  signalRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  signalInputSmall: {
    height: 44, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.background, paddingHorizontal: 12,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
  },
  signalInput: {
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.background, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    minHeight: 90, marginBottom: 10,
  },
  signalPhotoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  signalPhotoBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.primary,
    backgroundColor: "rgba(37,99,235,0.05)",
  },
  signalPhotoBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },
  signalThumb: { width: 64, height: 64, borderRadius: 10 },
  signalThumbRemove: { position: "absolute", top: -6, right: -6 },
  signalSendBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 14, height: 50,
  },
  signalSendBtnDisabled: { opacity: 0.45 },
  signalSendBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
