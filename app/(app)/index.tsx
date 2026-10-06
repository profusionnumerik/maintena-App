import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { wConfirm } from "@/shared/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  collection, limit, onSnapshot, orderBy, query, Timestamp as FirestoreTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { useInterventions } from "@/context/InterventionsContext";
import { CoPro, CoProStatus, Intervention, Signalement, STATUS_LABELS, CATEGORY_LABELS, CATEGORY_ICONS } from "@/shared/types";


const MONTHS_CAL = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAYS_CAL   = ["L","M","M","J","V","S","D"];
const CAL_DOT: Record<string, string> = { planifie: "#F59E0B", en_cours: "#3B82F6", termine: "#10B981" };

const STATUS_CONFIG: Record<string, { dot: string; bg: string; text: string }> = {
  planifie: { dot: "#F59E0B", bg: "#FEF3C7", text: "#92400E" },
  en_cours: { dot: "#3B82F6", bg: "#EFF6FF", text: "#1D4ED8" },
  termine:  { dot: "#10B981", bg: "#ECFDF5", text: "#065F46" },
};

const STATUS_CHIP: Record<CoProStatus, { label: string; color: string; bg: string }> = {
  active:    { label: "Active",     color: COLORS.success,  bg: "rgba(16,185,129,0.1)" },
  pending:   { label: "En attente", color: COLORS.warning,  bg: "rgba(245,158,11,0.1)" },
  suspended: { label: "Suspendue",  color: COLORS.danger,   bg: "rgba(239,68,68,0.1)"  },
};

function useAllAdminSignalements(copros: CoPro[]) {
  const [allSignalements, setAllSignalements] = useState<Record<string, Signalement[]>>({});
  const coProIds = copros.map((c) => c.id).join(",");

  useEffect(() => {
    if (copros.length === 0) { setAllSignalements({}); return; }
    const unsubscribers = copros.map((copro) =>
      onSnapshot(
        query(collection(db, "copros", copro.id, "signalements"), orderBy("createdAt", "desc"), limit(30)),
        (snap) => {
          const AUTO_DELETE_MS = 30 * 24 * 60 * 60 * 1000;
          const cutoff = Date.now() - AUTO_DELETE_MS;
          const mapped = snap.docs
            .map((d) => {
              const data = d.data();
              const createdAt = data.createdAt instanceof FirestoreTimestamp
                ? data.createdAt.toDate().toISOString()
                : data.createdAt ?? new Date().toISOString();
              if (data.acknowledged && new Date(createdAt).getTime() < cutoff) return null;
              return {
                id: d.id, coProId: copro.id,
                message: data.message ?? "", uid: data.uid ?? "",
                displayName: data.displayName ?? "",
                senderName: data.senderName ?? data.displayName ?? "",
                apartmentNumber: data.apartmentNumber ?? "",
                photos: data.photos ?? (data.photoUrl ? [data.photoUrl] : undefined),
                photoUrl: data.photoUrl ?? (data.photos?.[0]) ?? undefined,
                createdAt, read: data.read ?? false,
                acknowledged: data.acknowledged ?? false,
              } as Signalement;
            })
            .filter((s): s is Signalement => s !== null && !s.acknowledged);
          setAllSignalements((prev) => ({ ...prev, [copro.id]: mapped }));
        }
      )
    );
    return () => unsubscribers.forEach((u) => u());
  }, [coProIds]);

  return allSignalements;
}

const FlatListAny = FlatList as any;

function CoproCard({
  copro,
  isActive,
  onPress,
  alertCount,
  trialDaysLeft,
}: {
  copro: CoPro;
  isActive: boolean;
  onPress: () => void;
  alertCount: number;
  trialDaysLeft?: number;
}) {
  const chip = trialDaysLeft !== undefined
    ? { label: `Essai · ${trialDaysLeft}j`, color: "#7C3AED", bg: "rgba(124,58,237,0.1)" }
    : STATUS_CHIP[copro.status];

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        isActive && styles.cardActive,
        pressed && { transform: [{ scale: 0.985 }] },
      ]}
      onPress={onPress}
      testID={`copro-card-${copro.id}`}
    >
      <View style={[styles.cardAccent, { backgroundColor: isActive ? "rgba(255,255,255,0.35)" : COLORS.primary }]} />
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, isActive && { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Ionicons name="business" size={22} color={isActive ? "#fff" : COLORS.primary} />
        </View>
        <View style={styles.cardTitleWrap}>
          <Text style={[styles.cardName, isActive && styles.cardNameActive]} numberOfLines={1}>
            {copro.name}
          </Text>
          {copro.address ? (
            <Text style={[styles.cardAddress, isActive && styles.cardAddressActive]} numberOfLines={1}>
              {copro.address}
            </Text>
          ) : copro.city ? (
            <Text style={[styles.cardAddress, isActive && styles.cardAddressActive]} numberOfLines={1}>
              {copro.postalCode} {copro.city}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {alertCount > 0 && (
            <View style={styles.sigBadge}>
              <Text style={styles.sigBadgeText}>{alertCount}</Text>
            </View>
          )}
          <View style={[styles.statusChip, { backgroundColor: chip.bg }]}>
            <Text style={[styles.statusChipText, { color: chip.color }]}>{chip.label}</Text>
          </View>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <Text style={[styles.cardCta, isActive && styles.cardCtaActive]}>Voir les interventions</Text>
        <Ionicons name="chevron-forward" size={16} color={isActive ? "rgba(255,255,255,0.6)" : COLORS.textMuted} />
      </View>
    </Pressable>
  );
}

function InterventionRow({ item, onPress, showCoProName }: { item: Intervention; onPress: () => void; showCoProName?: boolean }) {
  const sc = STATUS_CONFIG[item.status] ?? { dot: COLORS.textMuted, bg: COLORS.border, text: COLORS.textMuted };
  const catIcon = (CATEGORY_ICONS[item.category] ?? "construct") as any;
  const catColors = (COLORS.categoryColors as any)[item.category] ?? { bg: "#F1F5F9", text: "#334155" };

  const todayStr    = new Date().toISOString().split("T")[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const isOverdue   = item.status !== "termine" && item.date < todayStr;
  const dateLabel   = item.date === todayStr    ? "Aujourd'hui"
                    : item.date === tomorrowStr  ? "Demain"
                    : new Date(item.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.985 }] }]}
      onPress={onPress}
    >
      <View style={[styles.rowAccent, { backgroundColor: sc.dot }]} />
      <View style={[styles.rowIconWrap, { backgroundColor: catColors.bg }]}>
        <Ionicons name={catIcon} size={16} color={catColors.text} />
      </View>
      <View style={styles.rowContent}>
        {showCoProName && item.coProName ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 }}>
            <Ionicons name="business-outline" size={10} color={COLORS.primary} />
            <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: COLORS.primary }} numberOfLines={1}>
              {item.coProName}
            </Text>
          </View>
        ) : null}
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
          <View style={[styles.rowStatusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.rowStatusText, { color: sc.text }]}>{STATUS_LABELS[item.status]}</Text>
          </View>
        </View>
        <View style={styles.rowBottomMeta}>
          <View style={[styles.rowCatChip, { backgroundColor: catColors.bg }]}>
            <Text style={[styles.rowCatText, { color: catColors.text }]}>{CATEGORY_LABELS[item.category]}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="calendar-outline" size={11} color={isOverdue ? "#EF4444" : item.date === tomorrowStr ? "#D97706" : COLORS.textMuted} />
            <Text style={[styles.rowDate, isOverdue && styles.rowDateOverdue, item.date === tomorrowStr && !isOverdue && styles.rowDateTomorrow]}>{dateLabel}</Text>
          </View>
          {item.photos && item.photos.length > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Ionicons name="image-outline" size={11} color={COLORS.textMuted} />
              <Text style={styles.rowPhotoCount}>{item.photos.length}</Text>
            </View>
          )}
        </View>
        {isOverdue && item.assignedToName && (
          <View style={styles.rowChangePrest}>
            <Ionicons name="swap-horizontal-outline" size={10} color="#EF4444" />
            <Text style={styles.rowChangePrestText}>Prestataire à relancer ou remplacer</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={15} color={COLORS.border} />
    </Pressable>
  );
}

function StatCard({ label, value, icon, color, onPress }: { label: string; value: string | number; icon: string; color: string; onPress?: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.statCard, { borderTopColor: color }, pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {onPress && <Ionicons name="chevron-forward" size={12} color={color} style={{ position: "absolute", top: 10, right: 10, opacity: 0.5 }} />}
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { currentCopro, copros, roleMap, switchCoPro, currentRole, refreshCoPros, userSubscription, joinCoPro } = useCoPro();
  const { interventions, stats, isLoading } = useInterventions();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const isConseil = currentRole === "conseil";
  const [viewMode, setViewMode]       = useState<"list" | "calendar">("list");
  const [calYear, setCalYear]         = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth]       = useState(() => new Date().getMonth());
  const [calSelected, setCalSelected] = useState<number | null>(() => new Date().getDate());

  const prevCalMonth = () => { setCalSelected(null); if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); };
  const nextCalMonth = () => { setCalSelected(null); if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); };

  const calPrefix = `${calYear}-${String(calMonth + 1).padStart(2, "0")}`;
  const calByDay = useMemo(() => {
    const map: Record<number, typeof interventions> = {};
    for (const iv of interventions) {
      if (!iv.date.startsWith(calPrefix)) continue;
      const d = parseInt(iv.date.split("-")[2], 10);
      if (!map[d]) map[d] = [];
      map[d].push(iv);
    }
    return map;
  }, [interventions, calPrefix]);

  const calOffset      = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const calCells: (number | null)[] = ([] as (number | null)[]).concat(
    Array<null>(calOffset).fill(null),
    Array.from({ length: calDaysInMonth }, (_, i) => i + 1),
  );
  while (calCells.length % 7 !== 0) calCells.push(null);
  const calRows: (number | null)[][] = [];
  for (let i = 0; i < calCells.length; i += 7) calRows.push(calCells.slice(i, i + 7));
  const calSelectedItems = calSelected ? (calByDay[calSelected] ?? []) : [];

  const isAdmin = currentRole === "admin" || currentRole === "co-admin";

  // Copros où l'utilisateur a un rôle de gestion (admin/co-admin/collaborateur)
  const ADMIN_ROLES: (string | undefined)[] = ["admin", "co-admin", "collaborateur"];
  const managedCopros = copros.filter((c) => ADMIN_ROLES.includes(roleMap[c.id]));

  const allSignalements = useAllAdminSignalements(isAdmin ? managedCopros : []);

  const filteredCopros = searchQuery.trim()
    ? managedCopros.filter((c) => {
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.city ?? "").toLowerCase().includes(q) ||
          (c.address ?? "").toLowerCase().includes(q)
        );
      })
    : managedCopros;

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;
  const canAdd = currentRole === "admin" || currentRole === "collaborateur";

  // Prochaines interventions en haut (date ≥ aujourd'hui, croissant), passées en bas (décroissant)
  const todayStr = new Date().toISOString().split("T")[0];
  const upcoming = interventions
    .filter((i) => i.date.split("T")[0] >= todayStr && i.status !== "termine")
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = interventions
    .filter((i) => i.date.split("T")[0] < todayStr || i.status === "termine")
    .sort((a, b) => b.date.localeCompare(a.date));
  const recent = [...upcoming, ...past].slice(0, 5);

  const tomorrowStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  })();
  const tomorrowInterventions = interventions.filter(
    (i) => i.date === tomorrowStr && i.status !== "termine"
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshCoPros();
    setRefreshing(false);
  };

  const handleCoproPress = (copro: CoPro) => {
    switchCoPro(copro.id);
    router.navigate("/(app)/interventions");
  };

  const handleLogout = () => {
    wConfirm("Déconnexion", "Voulez-vous vous déconnecter ?", logout, "Déconnecter");
  };

  if (isAdmin) {
    const subExpires = userSubscription?.expiresAt
      ? new Date(userSubscription.expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
      : null;

    const trialDaysLeft = userSubscription?.status === "trialing" && userSubscription.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(userSubscription.trialEndsAt).getTime() - Date.now()) / 86_400_000))
      : undefined;

    const totalUnread = Object.values(allSignalements).reduce((sum, arr) => sum + arr.length, 0);

    const adminHeader = (
      <View>
        <View style={[styles.header, { paddingTop: top + 16 }]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={styles.pageTitle}>Mes copropriétés</Text>
              {totalUnread > 0 && (
                <View style={styles.sigBadge}>
                  <Text style={styles.sigBadgeText}>{totalUnread}</Text>
                </View>
              )}
            </View>
            {subExpires && (
              <Text style={styles.subNote}>Abonnement jusqu'au {subExpires}</Text>
            )}
          </View>
          <View style={styles.headerActions}>
            <Pressable
              style={styles.addBtn}
              onPress={() => router.push("/(onboarding)/create")}
              testID="add-copro-btn"
            >
              <Ionicons name="add" size={22} color="#fff" />
            </Pressable>
            <Pressable style={styles.logoutBtn} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={20} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Rechercher par nom ou ville…"
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
            </Pressable>
          )}
        </View>

        <Text style={styles.listMeta}>
          {filteredCopros.length !== managedCopros.length
            ? `${filteredCopros.length} résultat${filteredCopros.length !== 1 ? "s" : ""} sur ${managedCopros.length}`
            : `${managedCopros.length} copropriété${managedCopros.length !== 1 ? "s" : ""} gérée${managedCopros.length !== 1 ? "s" : ""}`}
          {totalUnread > 0 && !searchQuery ? ` · ${totalUnread} alerte${totalUnread > 1 ? "s" : ""} en attente` : ""}
        </Text>
      </View>
    );

    return (
      <View style={styles.root}>
        <FlatListAny
          data={filteredCopros}
          keyExtractor={(c: CoPro) => c.id}
          renderItem={({ item }: { item: CoPro }) => (
            <CoproCard
              copro={item}
              isActive={item.id === currentCopro?.id}
              onPress={() => handleCoproPress(item)}
              alertCount={allSignalements[item.id]?.length ?? 0}
              trialDaysLeft={item.status === "pending" ? trialDaysLeft : undefined}
            />
          )}
          ListHeaderComponent={adminHeader}
          ListEmptyComponent={
            !refreshing ? (
              <View style={styles.emptyState}>
                <Ionicons name={searchQuery ? "search-outline" : "business-outline"} size={36} color={COLORS.border} />
                <Text style={styles.emptyTitle}>
                  {searchQuery ? "Aucun résultat" : "Aucune copropriété"}
                </Text>
                <Text style={styles.emptyDesc}>
                  {searchQuery
                    ? `Aucune copropriété ne correspond à "${searchQuery}"`
                    : "Appuyez sur + pour ajouter votre première copropriété"}
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={[styles.list, { paddingBottom: bottom + 16 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
          }
          showsVerticalScrollIndicator={false}
        />
      </View>
    );
  }

  const dashHeader = (
    <View>
      <View style={[styles.header, { paddingTop: top + 16, paddingBottom: copros.length > 1 ? 12 : 20 }]}>
        <View style={{ flex: 1 }}>
          {user?.displayName ? (
            <Text style={styles.greeting}>Bonjour, {user.displayName.split(" ")[0]}</Text>
          ) : null}
          <Text style={styles.coProName}>{currentCopro?.name ?? "—"}</Text>
          {currentCopro?.address ? (
            <Text style={styles.coProAddress}>{currentCopro.address}</Text>
          ) : currentCopro?.city ? (
            <Text style={styles.coProAddress}>{currentCopro.postalCode} {currentCopro.city}</Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          {canAdd && (
            <Pressable style={styles.addBtn} onPress={() => router.push("/add")}>
              <Ionicons name="add" size={22} color="#fff" />
            </Pressable>
          )}
          <Pressable style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
      </View>

      {/* Sélecteur de résidence si le prestataire est dans plusieurs copros */}
      {copros.length > 1 && (
        <View style={styles.coproSelectorWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.coproSelectorScroll}
          >
            {copros.map((c) => {
              const active = c.id === currentCopro?.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    switchCoPro(c.id);
                    router.push("/(app)/interventions");
                  }}
                  style={[styles.coproPill, active && styles.coproPillActive]}
                >
                  <Text style={[styles.coproPillText, active && styles.coproPillTextActive]} numberOfLines={1}>
                    {c.name}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={styles.joinPill}
              onPress={() => router.push("/(onboarding)/join")}
            >
              <Ionicons name="add-circle-outline" size={14} color={COLORS.primary} />
              <Text style={styles.joinPillText}>Rejoindre</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {copros.length <= 1 && (
        <Pressable
          style={styles.joinBannerBtn}
          onPress={() => router.push("/(onboarding)/join")}
        >
          <Ionicons name="enter-outline" size={15} color={COLORS.primary} />
          <Text style={styles.joinBannerText}>Rejoindre une autre résidence</Text>
        </Pressable>
      )}

      {tomorrowInterventions.length > 0 && (
        <Pressable
          style={styles.tomorrowBanner}
          onPress={() => router.push("/(app)/interventions?tab=interventions&status=planifie")}
        >
          <View style={styles.tomorrowBannerIcon}>
            <Ionicons name="alarm-outline" size={16} color="#D97706" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tomorrowBannerTitle}>
              {tomorrowInterventions.length === 1
                ? "1 intervention prévue demain"
                : `${tomorrowInterventions.length} interventions prévues demain`}
            </Text>
            <Text style={styles.tomorrowBannerSub} numberOfLines={1}>
              {tomorrowInterventions.map(i => i.title).join(", ")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color="#D97706" />
        </Pressable>
      )}

      {stats.overdue > 0 && (isAdmin || isConseil) && (
        <Pressable
          style={styles.overdueBanner}
          onPress={() => router.push("/(app)/interventions?tab=interventions")}
        >
          <View style={styles.overdueBannerIcon}>
            <Ionicons name="warning-outline" size={16} color="#EF4444" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.overdueBannerTitle}>
              {stats.overdue === 1
                ? "1 intervention en retard"
                : `${stats.overdue} interventions en retard`}
            </Text>
            <Text style={styles.overdueBannerSub}>
              Date dépassée — intervention(s) non réalisée(s)
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color="#EF4444" />
        </Pressable>
      )}

      <View style={styles.statsGrid}>
        <StatCard
          label="Total" value={stats.total} icon="construct" color={COLORS.primary}
          onPress={() => router.push("/(app)/interventions?tab=interventions")}
        />
        <StatCard
          label="Terminées" value={stats.done} icon="checkmark-circle" color={COLORS.success}
          onPress={() => router.push("/(app)/interventions?tab=interventions&status=termine")}
        />
        <StatCard
          label="En cours" value={stats.inProgress} icon="time" color={COLORS.warning}
          onPress={() => router.push("/(app)/interventions?tab=interventions&status=en_cours")}
        />
        <StatCard
          label="Maintenances" value={(stats as any).recurringGroups ?? 0} icon="repeat" color="#8B5CF6"
          onPress={() => router.push("/(app)/interventions?tab=maintenances")}
        />
      </View>

      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={styles.sectionDot} />
          <Text style={styles.sectionTitle}>
            {viewMode === "list" ? "Interventions récentes" : "Planning"}
          </Text>
          {viewMode === "list" && recent.length > 0 && (
            <View style={styles.sectionCount}>
              <Text style={styles.sectionCountText}>{recent.length}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {isConseil && (
            <View style={styles.viewToggle}>
              <Pressable
                style={[styles.viewToggleBtn, viewMode === "list" && styles.viewToggleBtnActive]}
                onPress={() => setViewMode("list")}
              >
                <Ionicons name="list" size={13} color={viewMode === "list" ? "#fff" : COLORS.textMuted} />
              </Pressable>
              <Pressable
                style={[styles.viewToggleBtn, viewMode === "calendar" && styles.viewToggleBtnActive]}
                onPress={() => setViewMode("calendar")}
              >
                <Ionicons name="calendar" size={13} color={viewMode === "calendar" ? "#fff" : COLORS.textMuted} />
              </Pressable>
            </View>
          )}
          {viewMode === "list" && isConseil && (
            <Pressable onPress={() => router.push("/(app)/calendrier")} style={styles.seeAllBtn}>
              <Text style={styles.seeAll}>Voir tout</Text>
              <Ionicons name="chevron-forward" size={13} color={COLORS.primary} />
            </Pressable>
          )}
          {viewMode === "list" && !isConseil && (
            <Pressable onPress={() => router.push("/(app)/interventions")} style={styles.seeAllBtn}>
              <Text style={styles.seeAll}>Voir tout</Text>
              <Ionicons name="chevron-forward" size={13} color={COLORS.primary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Grille calendrier — mode conseil */}
      {viewMode === "calendar" && (
        <View style={styles.calContainer}>
          <View style={styles.calMonthNav}>
            <Pressable onPress={prevCalMonth} hitSlop={10} style={styles.calNavBtn}>
              <Ionicons name="chevron-back" size={18} color={COLORS.text} />
            </Pressable>
            <Text style={styles.calMonthTitle}>{MONTHS_CAL[calMonth]} {calYear}</Text>
            <Pressable onPress={nextCalMonth} hitSlop={10} style={styles.calNavBtn}>
              <Ionicons name="chevron-forward" size={18} color={COLORS.text} />
            </Pressable>
          </View>
          <View style={styles.calDaysRow}>
            {DAYS_CAL.map((d, i) => (
              <Text key={i} style={[styles.calDayLabel, i >= 5 && { color: "#EF4444" }]}>{d}</Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {calRows.map((row, ri) => (
              <View key={ri} style={styles.calGridRow}>
                {row.map((day, ci) => {
                  if (!day) return <View key={ci} style={styles.calCell} />;
                  const iso        = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const isTodayCell = iso === todayStr;
                  const isSelected  = day === calSelected;
                  const dayItems    = calByDay[day] ?? [];
                  const dots        = [...new Set(dayItems.map(iv => CAL_DOT[iv.status] ?? "#94A3B8"))].slice(0, 3);
                  return (
                    <Pressable
                      key={ci}
                      style={[styles.calCell, isTodayCell && styles.calCellToday, isSelected && styles.calCellSelected]}
                      onPress={() => setCalSelected(day === calSelected ? null : day)}
                    >
                      <Text style={[
                        styles.calCellText,
                        isTodayCell && styles.calCellTextToday,
                        isSelected  && styles.calCellTextSelected,
                        (ci === 5 || ci === 6) && !isSelected && !isTodayCell && { color: "#EF4444" },
                      ]}>{day}</Text>
                      {dots.length > 0 && (
                        <View style={styles.calDotsRow}>
                          {dots.map((c, di) => (
                            <View key={di} style={[styles.calDot, { backgroundColor: isSelected ? "#fff" : c }]} />
                          ))}
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
          <View style={[styles.sectionHeader, { paddingTop: 10, paddingBottom: 6, borderTopWidth: 1, borderTopColor: COLORS.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={styles.sectionDot} />
              <Text style={styles.sectionTitle}>
                {calSelected
                  ? `${calSelected} ${MONTHS_CAL[calMonth]}${calSelectedItems.length > 0 ? ` · ${calSelectedItems.length} intervention${calSelectedItems.length > 1 ? "s" : ""}` : ""}`
                  : "Sélectionnez un jour"}
              </Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatListAny
        data={viewMode === "calendar" ? calSelectedItems : recent}
        keyExtractor={(i: Intervention) => i.id}
        renderItem={({ item }: { item: Intervention }) => (
          <InterventionRow item={item} onPress={() => router.push(`/intervention/${item.id}`)} showCoProName={copros.length > 1} />
        )}
        ListHeaderComponent={dashHeader}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Ionicons
                name={viewMode === "calendar" ? (calSelected ? "calendar-outline" : "finger-print-outline") : "construct-outline"}
                size={36}
                color={COLORS.border}
              />
              <Text style={styles.emptyTitle}>
                {viewMode === "calendar" ? (calSelected ? "Aucune intervention" : "Sélectionnez un jour") : "Aucune intervention"}
              </Text>
              <Text style={styles.emptyDesc}>
                {viewMode === "calendar"
                  ? (calSelected ? "Aucune intervention ce jour" : "Touchez un jour du calendrier pour voir ses interventions")
                  : "Appuyez sur + pour ajouter la première intervention"}
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 16 }]}
        refreshControl={<RefreshControl refreshing={isLoading} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  list: { paddingBottom: 24 },

  header: {
    backgroundColor: COLORS.dark, paddingHorizontal: 20,
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
    paddingBottom: 24,
  },
  pageTitle: {
    fontSize: 26, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.5,
  },
  subNote: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.45)", marginTop: 4,
  },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginTop: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 10 : 7,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    paddingVertical: 0,
  },
  listMeta: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  addBtn: {
    width: 42, height: 42, borderRadius: 14,
    backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center",
  },
  logoutBtn: {
    width: 42, height: 42, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center",
  },

  card: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: "hidden",
  },
  cardAccent: {
    position: "absolute", left: 0, top: 0, bottom: 0, width: 5,
    borderTopLeftRadius: 18, borderBottomLeftRadius: 18,
  },
  cardJoined: {
    borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
    borderBottomWidth: 0, marginBottom: 0,
  },
  cardActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 14 },
  cardIcon: {
    width: 44, height: 44, borderRadius: 13,
    backgroundColor: "rgba(37,99,235,0.1)", alignItems: "center", justifyContent: "center",
  },
  cardTitleWrap: { flex: 1 },
  cardName: {
    fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text,
  },
  cardNameActive: { color: "#fff" },
  cardAddress: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, marginTop: 2,
  },
  cardAddressActive: { color: "rgba(255,255,255,0.65)" },

  statusChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  statusChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  cardFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.06)",
  },
  cardCta: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  cardCtaActive: { color: "rgba(255,255,255,0.75)" },

  greeting: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)", marginBottom: 2 },
  coProName: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.5 },
  coProAddress: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", marginTop: 2 },

  coproSelectorWrap: { backgroundColor: COLORS.dark, paddingBottom: 14 },
  coproSelectorScroll: { paddingHorizontal: 16, gap: 8 },
  coproPill: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  coproPillActive: {
    backgroundColor: COLORS.primary, borderColor: COLORS.primary,
  },
  coproPillText: {
    fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)", maxWidth: 140,
  },
  coproPillTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  joinPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: "rgba(37,99,235,0.12)", borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(37,99,235,0.25)",
  },
  joinPillText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },

  joinBannerBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: COLORS.dark,
  },
  joinBannerText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, paddingTop: 16, gap: 10 },
  statCard: {
    flexBasis: "47%", flexGrow: 1,
    backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, alignItems: "center", gap: 4,
    borderTopWidth: 3, borderWidth: 1, borderColor: COLORS.border,
  },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.text },
  statLabel: { fontSize: 10, fontFamily: "Inter_500Medium", color: COLORS.textMuted, textAlign: "center" },

  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10,
  },
  sectionDot: {
    width: 4, height: 18, borderRadius: 2, backgroundColor: COLORS.primary,
  },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  sectionCount: {
    backgroundColor: "rgba(37,99,235,0.1)", borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  sectionCountText: { fontSize: 12, fontFamily: "Inter_700Bold", color: COLORS.primary },
  seeAllBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, backgroundColor: COLORS.surface,
    borderRadius: 14, paddingVertical: 13, paddingRight: 14, paddingLeft: 0,
    marginBottom: 8, borderWidth: 1, borderColor: COLORS.border,
    overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  rowAccent: { width: 4, alignSelf: "stretch", borderRadius: 0 },
  rowIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    alignItems: "center", justifyContent: "center", marginLeft: 10,
  },
  rowContent: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5 },
  rowTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  rowStatusBadge: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  rowStatusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowBottomMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowCatChip: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  rowCatText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  rowDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  rowDateOverdue: { color: "#EF4444", fontFamily: "Inter_600SemiBold" },
  rowDateTomorrow: { color: "#D97706", fontFamily: "Inter_600SemiBold" },
  rowPhotoCount: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  tomorrowBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginTop: 14, marginBottom: 2,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
  },
  tomorrowBannerIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: "rgba(245,158,11,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  tomorrowBannerTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#92400E" },
  tomorrowBannerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#B45309", marginTop: 1 },

  emptyState: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  emptyDesc: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted,
    textAlign: "center", paddingHorizontal: 40,
  },

  coproCardWrap: { marginBottom: 4 },
  coproAlertSection: {
    marginHorizontal: 16, marginTop: 0, marginBottom: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderTopWidth: 0,
    borderColor: "rgba(217,119,6,0.35)",
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
    overflow: "hidden",
  },
  coproAlertHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 11,
    backgroundColor: "rgba(245,158,11,0.1)",
  },
  coproAlertIconWrap: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: "rgba(245,158,11,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  coproAlertTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#92400E", flex: 1 },
  coproAlertToggle: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: "rgba(245,158,11,0.15)",
    alignItems: "center", justifyContent: "center",
  },

  sigBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  sigBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  sigRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingHorizontal: 14,
  },
  sigRowAck: { opacity: 0.7 },
  sigIcon: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  sigIconAlert: { backgroundColor: "rgba(245,158,11,0.15)" },
  sigIconAck: { backgroundColor: "rgba(16,185,129,0.12)" },
  sigFromName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, flex: 1 },
  sigAppt: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  sigDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  sigMsg: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 17 },
  sigThumbWrap: { position: "relative", borderRadius: 8, overflow: "hidden" },
  sigThumb: { width: 160, height: 110, borderRadius: 8 },
  sigThumbZoom: {
    position: "absolute", bottom: 5, right: 5,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, padding: 3,
  },
  sigAckChip: {
    flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start",
    backgroundColor: "#D1FAE5", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  sigAckChipText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: COLORS.success },
  sigAckBtn: {
    flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start",
    backgroundColor: "#EFF6FF", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
    borderWidth: 1, borderColor: "#BFDBFE",
  },
  sigAckBtnText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: COLORS.primary },

  overdueBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginTop: 14, marginBottom: 2,
    backgroundColor: "rgba(239,68,68,0.07)",
    borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.22)",
  },
  overdueBannerIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: "rgba(239,68,68,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  overdueBannerTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#B91C1C" },
  overdueBannerSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#DC2626", marginTop: 1 },

  rowChangePrest: {
    flexDirection: "row", alignItems: "center", gap: 4,
    marginTop: 5,
  },
  rowChangePrestText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "#EF4444" },

  viewToggle: {
    flexDirection: "row", gap: 2,
    backgroundColor: COLORS.border, borderRadius: 8, padding: 2,
  },
  viewToggleBtn: {
    width: 28, height: 28, borderRadius: 6,
    alignItems: "center", justifyContent: "center",
  },
  viewToggleBtnActive: { backgroundColor: COLORS.primary },

  calContainer: {
    backgroundColor: COLORS.surface, borderRadius: 16,
    marginHorizontal: 16, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border, overflow: "hidden",
  },
  calMonthNav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  calNavBtn: { padding: 6 },
  calMonthTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text },
  calDaysRow: {
    flexDirection: "row", paddingHorizontal: 8, paddingTop: 8, paddingBottom: 2,
  },
  calDayLabel: {
    flex: 1, textAlign: "center", fontSize: 10,
    fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, textTransform: "uppercase",
  },
  calGrid: { paddingHorizontal: 8, paddingBottom: 8 },
  calGridRow: { flexDirection: "row" },
  calCell: {
    flex: 1, aspectRatio: 1,
    alignItems: "center", justifyContent: "center",
    borderRadius: 9, margin: 2, gap: 2,
  },
  calCellToday:        { borderWidth: 1.5, borderColor: COLORS.primary },
  calCellSelected:     { backgroundColor: COLORS.primary },
  calCellText:         { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.text },
  calCellTextToday:    { color: COLORS.primary, fontFamily: "Inter_700Bold" },
  calCellTextSelected: { color: "#fff", fontFamily: "Inter_700Bold" },
  calDotsRow: { flexDirection: "row", gap: 2, alignItems: "center", height: 5 },
  calDot:     { width: 4, height: 4, borderRadius: 2 },
});
