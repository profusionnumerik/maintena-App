import * as Haptics from "expo-haptics";
import { useState, useEffect } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { collection, getDocs, updateDoc, doc, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl } from "@/lib/query-client";
import { CoPro, CoProStatus } from "@/shared/types";

const FlatListAny = FlatList as any;

const STATUS_CONFIG: Record<CoProStatus, { label: string; bg: string; text: string }> = {
  pending: { label: "En attente", bg: "#FFFBEB", text: "#92400E" },
  active: { label: "Active", bg: "#D1FAE5", text: "#065F46" },
  suspended: { label: "Suspendue", bg: "#FEF2F2", text: "#991B1B" },
};

export default function SuperAdminScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [copros, setCopros] = useState<CoPro[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const loadCopros = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "copros"), orderBy("createdAt", "desc")));
      setCopros(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CoPro, "id">) })));
    } catch (e) {
      console.error("SuperAdmin load error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCopros(); }, []);

  const sendActivationEmail = async (copro: CoPro): Promise<boolean> => {
    try {
      const apiUrl = new URL("/api/send-activation-email", getApiUrl()).toString();
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminEmail: copro.adminEmail,
          coProName: copro.name,
          inviteCode: copro.inviteCode,
        }),
      });
      const data = await res.json();
      return !!data.sent;
    } catch (e) {
      console.warn("Email send failed:", e);
      return false;
    }
  };

  const handleResendEmail = async (coProId: string) => {
    const copro = copros.find((c) => c.id === coProId);
    if (!copro) return;
    setUpdatingId(coProId);
    const sent = await sendActivationEmail(copro);
    setUpdatingId(null);
    if (sent) {
      Alert.alert("Email envoyé", `Code d'invitation renvoyé à ${copro.adminEmail}`);
    } else {
      Alert.alert("Erreur", `Impossible d'envoyer l'email. Code : ${copro.inviteCode}`);
    }
  };

  const handleStatusChange = async (coProId: string, newStatus: CoProStatus) => {
    const labels: Record<CoProStatus, string> = {
      pending: "mettre en attente",
      active: "activer",
      suspended: "suspendre",
    };
    Alert.alert(
      "Confirmer",
      `Voulez-vous ${labels[newStatus]} cette copropriété ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Confirmer",
          onPress: async () => {
            setUpdatingId(coProId);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              const copro = copros.find((c) => c.id === coProId);

              if (newStatus === "active" && copro?.adminId) {
                const apiUrl = new URL("/api/activate-user-subscription", getApiUrl()).toString();
                const res = await fetch(apiUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId: copro.adminId, coProId }),
                });
                const data = await res.json();
                if (!data.activated && !data.expiresAt) {
                  await updateDoc(doc(db, "copros", coProId), { status: newStatus });
                }
              } else {
                await updateDoc(doc(db, "copros", coProId), { status: newStatus });
              }

              setCopros((prev) =>
                prev.map((c) => (c.id === coProId ? { ...c, status: newStatus } : c))
              );

              if (newStatus === "active" && copro?.adminEmail && copro?.inviteCode) {
                const sent = await sendActivationEmail(copro);
                if (sent) {
                  Alert.alert(
                    "Abonnement activé",
                    `Compte de ${copro.adminEmail} activé pour 1 an.\nEmail d'activation envoyé.\nCode : ${copro.inviteCode}`
                  );
                } else {
                  Alert.alert(
                    "Activé — email non envoyé",
                    `Abonnement activé mais l'email a échoué.\nCode d'invitation : ${copro.inviteCode}\n\nUtilisez "Renvoyer email" pour réessayer.`
                  );
                }
              }
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e: any) {
              Alert.alert("Erreur", e.message);
            } finally {
              setUpdatingId(null);
            }
          },
        },
      ]
    );
  };

  const filtered = copros.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.adminEmail.toLowerCase().includes(search.toLowerCase())
  );

  const counts = {
    total: copros.length,
    active: copros.filter((c) => c.status === "active").length,
    pending: copros.filter((c) => c.status === "pending").length,
    suspended: copros.filter((c) => c.status === "suspended").length,
  };

  const header = (
    <View>
      <View style={[styles.topBar, { paddingTop: top + 16 }]}>
        <View>
          <Text style={styles.pageTitle}>Super Admin</Text>
          <Text style={styles.pageSubtitle}>{user?.email}</Text>
        </View>
        <Pressable style={styles.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{counts.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: "#D1FAE5" }]}>
          <Text style={[styles.statVal, { color: COLORS.success }]}>{counts.active}</Text>
          <Text style={styles.statLabel}>Actives</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: "#FFFBEB" }]}>
          <Text style={[styles.statVal, { color: COLORS.warning }]}>{counts.pending}</Text>
          <Text style={styles.statLabel}>En attente</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: "#FEF2F2" }]}>
          <Text style={[styles.statVal, { color: COLORS.danger }]}>{counts.suspended}</Text>
          <Text style={styles.statLabel}>Suspendues</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher une copropriété..."
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <Text style={styles.listHeader}>
        {filtered.length} copropriété{filtered.length !== 1 ? "s" : ""}
      </Text>
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatListAny
        data={filtered}
        keyExtractor={(c: CoPro) => c.id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadCopros} tintColor={COLORS.primary} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 24 }]}
        renderItem={({ item }: { item: CoPro }) => {
          const sc = STATUS_CONFIG[item.status ?? "pending"];
          const isUpdating = updatingId === item.id;
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  {item.address ? (
                    <Text style={styles.cardAddr}>{item.address}</Text>
                  ) : null}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                  {isUpdating
                    ? <ActivityIndicator size="small" color={sc.text} />
                    : <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
                  }
                </View>
              </View>

              <View style={styles.cardMeta}>
                <View style={styles.metaRow}>
                  <Ionicons name="person-outline" size={13} color={COLORS.textMuted} />
                  <Text style={styles.metaText}>{item.adminEmail}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={13} color={COLORS.textMuted} />
                  <Text style={styles.metaText}>
                    {new Date(item.createdAt).toLocaleDateString("fr-FR")}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="key-outline" size={13} color={COLORS.textMuted} />
                  <Text style={styles.metaCode}>{item.inviteCode}</Text>
                </View>
              </View>

              <View style={styles.actions}>
                {item.status !== "active" && (
                  <Pressable
                    style={[styles.actionBtn, styles.actionActivate]}
                    onPress={() => handleStatusChange(item.id, "active")}
                    disabled={isUpdating}
                  >
                    <Ionicons name="checkmark-circle-outline" size={15} color="#065F46" />
                    <Text style={styles.actionActivateText}>Activer</Text>
                  </Pressable>
                )}
                {item.status === "active" && (
                  <Pressable
                    style={[styles.actionBtn, styles.actionEmail]}
                    onPress={() => handleResendEmail(item.id)}
                    disabled={isUpdating}
                  >
                    <Ionicons name="mail-outline" size={15} color="#1D4ED8" />
                    <Text style={styles.actionEmailText}>Renvoyer email</Text>
                  </Pressable>
                )}
                {item.status !== "pending" && (
                  <Pressable
                    style={[styles.actionBtn, styles.actionPending]}
                    onPress={() => handleStatusChange(item.id, "pending")}
                    disabled={isUpdating}
                  >
                    <Ionicons name="time-outline" size={15} color="#92400E" />
                    <Text style={styles.actionPendingText}>En attente</Text>
                  </Pressable>
                )}
                {item.status !== "suspended" && (
                  <Pressable
                    style={[styles.actionBtn, styles.actionSuspend]}
                    onPress={() => handleStatusChange(item.id, "suspended")}
                    disabled={isUpdating}
                  >
                    <Ionicons name="ban-outline" size={15} color="#991B1B" />
                    <Text style={styles.actionSuspendText}>Suspendre</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={32} color={COLORS.border} />
              <Text style={styles.emptyText}>Aucune copropriété</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  topBar: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.dark,
  },
  pageTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  pageSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", marginTop: 2 },
  logoutBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  statBox: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 10, alignItems: "center", gap: 2,
    borderWidth: 1, borderColor: COLORS.border,
  },
  statVal: { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text },
  statLabel: { fontSize: 10, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, backgroundColor: COLORS.surface,
    borderRadius: 14, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, height: 44, marginBottom: 4,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text },
  listHeader: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted,
    paddingHorizontal: 20, paddingBottom: 8,
  },
  listContent: { paddingHorizontal: 16, gap: 10 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 16,
    padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardHeaderLeft: { flex: 1, gap: 2, marginRight: 10 },
  cardName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  cardAddr: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, minWidth: 80, alignItems: "center" },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  cardMeta: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  metaCode: { fontSize: 12, fontFamily: "Inter_700Bold", color: COLORS.primary, letterSpacing: 2 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  actionActivate: { backgroundColor: "#D1FAE5" },
  actionActivateText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#065F46" },
  actionEmail: { backgroundColor: "#EFF6FF" },
  actionEmailText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#1D4ED8" },
  actionPending: { backgroundColor: "#FFFBEB" },
  actionPendingText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E" },
  actionSuspend: { backgroundColor: "#FEF2F2" },
  actionSuspendText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#991B1B" },
  empty: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 15, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
});
