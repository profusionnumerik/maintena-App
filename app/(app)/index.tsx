import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert, FlatList, Platform, Pressable, RefreshControl,
  StyleSheet, Text, TextInput, View,
} from "react-native";
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
import { CoPro, CoProStatus, Intervention, Signalement, STATUS_LABELS, CATEGORY_LABELS } from "@/shared/types";


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
}: {
  copro: CoPro;
  isActive: boolean;
  onPress: () => void;
  alertCount: number;
}) {
  const chip = STATUS_CHIP[copro.status];

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        isActive && styles.cardActive,
        pressed && { opacity: 0.85 },
      ]}
      onPress={onPress}
      testID={`copro-card-${copro.id}`}
    >
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
        <Ionicons name="arrow-forward-circle" size={20} color={isActive ? "rgba(255,255,255,0.7)" : COLORS.textMuted} />
        <Text style={[styles.cardCta, isActive && styles.cardCtaActive]}>Voir les interventions</Text>
      </View>
    </Pressable>
  );
}

function InterventionRow({ item, onPress }: { item: Intervention; onPress: () => void }) {
  const statusColors: Record<string, string> = {
    planifie: COLORS.warning,
    en_cours: COLORS.primary,
    termine: COLORS.success,
  };
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]} onPress={onPress}>
      <View style={[styles.rowDot, { backgroundColor: statusColors[item.status] ?? COLORS.textMuted }]} />
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.rowMeta}>
          {CATEGORY_LABELS[item.category]} · {new Date(item.date).toLocaleDateString("fr-FR")}
        </Text>
      </View>
      {item.photos && item.photos.length > 0 && (
        <Ionicons name="image-outline" size={14} color={COLORS.textMuted} />
      )}
      <Ionicons name="chevron-forward" size={16} color={COLORS.border} />
    </Pressable>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <View style={[styles.statCard, { borderTopColor: color }]}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { currentCopro, copros, switchCoPro, currentRole, refreshCoPros, userSubscription } = useCoPro();
  const { interventions, stats, isLoading } = useInterventions();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const isAdmin = currentRole === "admin";
  const allSignalements = useAllAdminSignalements(isAdmin ? copros : []);

  const filteredCopros = searchQuery.trim()
    ? copros.filter((c) => {
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.city ?? "").toLowerCase().includes(q) ||
          (c.address ?? "").toLowerCase().includes(q)
        );
      })
    : copros;

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;
  const canAdd = currentRole === "admin" || currentRole === "prestataire";
  const recent = interventions.slice(0, 8);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshCoPros();
    setRefreshing(false);
  };

  const handleCoproPress = (copro: CoPro) => {
    switchCoPro(copro.id);
    router.navigate("/(app)/interventions");
  };

  const handleLogout = () =>
    Alert.alert("Déconnexion", "Voulez-vous vous déconnecter ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Déconnecter", style: "destructive", onPress: () => logout() },
    ]);

  if (isAdmin) {
    const subExpires = userSubscription?.expiresAt
      ? new Date(userSubscription.expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
      : null;

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
          {filteredCopros.length !== copros.length
            ? `${filteredCopros.length} résultat${filteredCopros.length !== 1 ? "s" : ""} sur ${copros.length}`
            : `${copros.length} copropriété${copros.length !== 1 ? "s" : ""} gérée${copros.length !== 1 ? "s" : ""}`}
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
      <View style={[styles.header, { paddingTop: top + 16, paddingBottom: 20 }]}>
        <View style={{ flex: 1 }}>
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

      <View style={styles.statsGrid}>
        <StatCard label="Total" value={stats.total} icon="construct" color={COLORS.primary} />
        <StatCard label="Terminées" value={stats.done} icon="checkmark-circle" color={COLORS.success} />
        <StatCard label="En cours" value={stats.inProgress} icon="time" color={COLORS.warning} />
        <StatCard
          label="Note moy."
          value={stats.ratedCount > 0 ? `${stats.avgRating.toFixed(1)}/4` : "—"}
          icon="star"
          color="#F59E0B"
        />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Interventions récentes</Text>
        {interventions.length > 8 && (
          <Pressable onPress={() => router.push("/(app)/interventions")}>
            <Text style={styles.seeAll}>Voir tout</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatListAny
        data={recent}
        keyExtractor={(i: Intervention) => i.id}
        renderItem={({ item }: { item: Intervention }) => (
          <InterventionRow item={item} onPress={() => router.push(`/intervention/${item.id}`)} />
        )}
        ListHeaderComponent={dashHeader}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Ionicons name="construct-outline" size={36} color={COLORS.border} />
              <Text style={styles.emptyTitle}>Aucune intervention</Text>
              <Text style={styles.emptyDesc}>Appuyez sur + pour ajouter la première intervention</Text>
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
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.06)",
  },
  cardCta: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  cardCtaActive: { color: "rgba(255,255,255,0.75)" },

  coProName: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.5 },
  coProAddress: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", marginTop: 2 },

  statsGrid: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 16, gap: 10 },
  statCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 12, alignItems: "center", gap: 4,
    borderTopWidth: 3, borderWidth: 1, borderColor: COLORS.border,
  },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.text },
  statLabel: { fontSize: 10, fontFamily: "Inter_500Medium", color: COLORS.textMuted, textAlign: "center" },

  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 24, paddingBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, backgroundColor: COLORS.surface,
    borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  rowDot: { width: 8, height: 8, borderRadius: 4 },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },

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
});
