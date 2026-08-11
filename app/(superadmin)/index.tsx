import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable, ScrollView,
  RefreshControl, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl } from "@/lib/query-client";
import { CoPro, CoProStatus } from "@/shared/types";

type DemoUser = {
  id: string;
  email: string;
  maxCopros: number;
  maxMembersPerCopro: number;
  grantedAt: string;
  expiresAt?: string;
};

type DemoLink = {
  id: string;
  maxCopros: number;
  maxMembersPerCopro: number;
  demoExpiresInDays: number | null;
  usageLimit: number;
  usedCount: number;
  createdAt: string;
};

const FlatListAny = FlatList as any;

const STATUS_CONFIG: Record<CoProStatus, { label: string; bg: string; text: string }> = {
  pending: { label: "En attente", bg: "#FFFBEB", text: "#92400E" },
  active: { label: "Active", bg: "#D1FAE5", text: "#065F46" },
  suspended: { label: "Suspendue", bg: "#FEF2F2", text: "#991B1B" },
};

export default function SuperAdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [copros, setCopros] = useState<CoPro[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"copros" | "demo" | "activity" | "system">("copros");

  // Maintenance state
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [maintenanceEnd, setMaintenanceEnd] = useState("");
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [maintenanceLoaded, setMaintenanceLoaded] = useState(false);

  // Demo access state
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoEmail, setDemoEmail] = useState("");
  const [demoMaxCopros, setDemoMaxCopros] = useState(2);
  const [demoMaxMembers, setDemoMaxMembers] = useState(10);
  const [demoExpiresInDays, setDemoExpiresInDays] = useState<number | null>(null);
  const [demoGranting, setDemoGranting] = useState(false);

  // Activity state
  const [activityUsers, setActivityUsers] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // Demo link state
  const [demoLinks, setDemoLinks] = useState<DemoLink[]>([]);
  const [linkMaxCopros, setLinkMaxCopros] = useState(2);
  const [linkMaxMembers, setLinkMaxMembers] = useState(10);
  const [linkExpiresInDays, setLinkExpiresInDays] = useState<number | null>(30);
  const [linkUsageLimit, setLinkUsageLimit] = useState(1);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [linkGenerating, setLinkGenerating] = useState(false);

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const loadCopros = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(new URL("/api/superadmin/list-copros", getApiUrl()).toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setCopros(data.copros ?? []);
    } catch (e) {
      console.error("SuperAdmin load error:", e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadDemoUsers = useCallback(async () => {
    if (!user) return;
    setDemoLoading(true);
    try {
      const token = await user.getIdToken();
      const [resUsers, resLinks] = await Promise.all([
        fetch(new URL("/api/superadmin/list-demos", getApiUrl()).toString(), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(new URL("/api/superadmin/list-demo-links", getApiUrl()).toString(), { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const dataUsers = await resUsers.json();
      const dataLinks = await resLinks.json();
      setDemoUsers(dataUsers.demos ?? []);
      setDemoLinks(dataLinks.links ?? []);
    } catch (e) {
      console.error("load demos error:", e);
    } finally {
      setDemoLoading(false);
    }
  }, [user]);

  const handleGrantDemo = async () => {
    if (!demoEmail.trim() || !user) return;
    setDemoGranting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(new URL("/api/superadmin/grant-demo", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: demoEmail.trim().toLowerCase(),
          maxCopros: demoMaxCopros,
          maxMembersPerCopro: demoMaxMembers,
          ...(demoExpiresInDays ? { expiresInDays: demoExpiresInDays } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      Alert.alert("Accès accordé", `${demoEmail} peut maintenant utiliser l'app (${demoMaxCopros} copro${demoMaxCopros > 1 ? "s" : ""}, ${demoMaxMembers} membres/copro).`);
      setDemoEmail("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadDemoUsers();
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setDemoGranting(false);
    }
  };

  const handleRevokeDemo = (email: string) => {
    Alert.alert("Révoquer l'accès", `Supprimer l'accès démo de ${email} ?`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Révoquer", style: "destructive",
        onPress: async () => {
          if (!user) return;
          try {
            const token = await user.getIdToken();
            const res = await fetch(new URL("/api/superadmin/revoke-demo", getApiUrl()).toString(), {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Erreur");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            loadDemoUsers();
          } catch (e: any) {
            Alert.alert("Erreur", e.message);
          }
        },
      },
    ]);
  };

  const handleGenerateLink = async () => {
    if (!user) return;
    setLinkGenerating(true);
    setGeneratedLink(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(new URL("/api/superadmin/generate-demo-link", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          maxCopros: linkMaxCopros,
          maxMembersPerCopro: linkMaxMembers,
          demoExpiresInDays: linkExpiresInDays,
          usageLimit: linkUsageLimit,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setGeneratedLink(data.url);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadDemoUsers();
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setLinkGenerating(false);
    }
  };

  const handleDeleteLink = (token: string) => {
    Alert.alert("Supprimer ce lien ?", "Il ne sera plus utilisable.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive",
        onPress: async () => {
          if (!user) return;
          try {
            const idToken = await user.getIdToken();
            await fetch(new URL(`/api/superadmin/delete-demo-link/${token}`, getApiUrl()).toString(), {
              method: "DELETE",
              headers: { Authorization: `Bearer ${idToken}` },
            });
            loadDemoUsers();
          } catch (e: any) { Alert.alert("Erreur", e.message); }
        },
      },
    ]);
  };

  const handleSendReminders = async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(new URL("/api/cron/demo-reminders", getApiUrl()).toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      Alert.alert("Rappels envoyés", `${data.sent?.length ?? 0} email${(data.sent?.length ?? 0) > 1 ? "s" : ""} envoyé${(data.sent?.length ?? 0) > 1 ? "s" : ""}.\n${data.skipped?.length ?? 0} ignoré${(data.skipped?.length ?? 0) > 1 ? "s" : ""} (sans expiration ou déjà expirés).`);
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    }
  };

  const loadMaintenanceConfig = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, "appConfig", "maintenance"));
      if (snap.exists()) {
        const d = snap.data();
        setMaintenanceActive(d.active ?? false);
        setMaintenanceMessage(d.message ?? "");
        setMaintenanceEnd(d.estimatedEnd ?? "");
      }
      setMaintenanceLoaded(true);
    } catch (e) {
      console.error("load maintenance error:", e);
    }
  }, []);

  const handleSaveMaintenance = async (newActive?: boolean) => {
    setMaintenanceSaving(true);
    try {
      const active = newActive !== undefined ? newActive : maintenanceActive;
      await setDoc(doc(db, "appConfig", "maintenance"), {
        active,
        message: maintenanceMessage.trim(),
        estimatedEnd: maintenanceEnd.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: user?.email ?? "superadmin",
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        active ? "🔴 Maintenance activée" : "🟢 Maintenance désactivée",
        active
          ? "L'application affiche maintenant l'écran de maintenance pour tous les utilisateurs."
          : "L'application est de nouveau accessible normalement."
      );
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setMaintenanceSaving(false);
    }
  };

  const loadActivity = useCallback(async () => {
    if (!user) return;
    setActivityLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(new URL("/api/superadmin/recent-activity", getApiUrl()).toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setActivityUsers(data.users ?? []);
    } catch (e) {
      console.error("activity load error:", e);
    } finally {
      setActivityLoading(false);
    }
  }, [user]);

  useEffect(() => { loadCopros(); }, [loadCopros]);
  useEffect(() => { if (activeTab === "demo") loadDemoUsers(); }, [activeTab, loadDemoUsers]);
  useEffect(() => { if (activeTab === "activity") loadActivity(); }, [activeTab, loadActivity]);
  useEffect(() => { if (activeTab === "system" && !maintenanceLoaded) loadMaintenanceConfig(); }, [activeTab, maintenanceLoaded, loadMaintenanceConfig]);

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
    if (!user) return;
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
              const token = await user.getIdToken();
              const copro = copros.find((c) => c.id === coProId);

              if (newStatus === "active" && copro?.adminId) {
                // Active l'abonnement utilisateur via la route existante
                const res = await fetch(new URL("/api/activate-user-subscription", getApiUrl()).toString(), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId: copro.adminId, coProId }),
                });
                const data = await res.json();
                if (!data.activated && !data.expiresAt) {
                  // Fallback : update direct via superadmin route
                  await fetch(new URL("/api/superadmin/update-copro-status", getApiUrl()).toString(), {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ coProId, status: newStatus }),
                  });
                }
              } else {
                await fetch(new URL("/api/superadmin/update-copro-status", getApiUrl()).toString(), {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ coProId, status: newStatus }),
                });
              }

              setCopros((prev) =>
                prev.map((c) => (c.id === coProId ? { ...c, status: newStatus } : c))
              );

              if (newStatus === "active" && copro?.adminEmail && copro?.inviteCode) {
                const sent = await sendActivationEmail(copro);
                if (sent) {
                  Alert.alert("Abonnement activé", `Compte de ${copro.adminEmail} activé pour 1 an.\nEmail d'activation envoyé.\nCode : ${copro.inviteCode}`);
                } else {
                  Alert.alert("Activé — email non envoyé", `Abonnement activé mais l'email a échoué.\nCode d'invitation : ${copro.inviteCode}\n\nUtilisez "Renvoyer email" pour réessayer.`);
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

  const topBar = (
    <View style={[styles.topBar, { paddingTop: top + 16 }]}>
      <Pressable style={styles.backBtn} onPress={() => router.replace("/(app)")}>
        <Ionicons name="arrow-back" size={20} color="#fff" />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.pageTitle}>Super Admin</Text>
        <Text style={styles.pageSubtitle}>{user?.email}</Text>
      </View>
      <Pressable style={styles.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
      </Pressable>
    </View>
  );

  const tabs = (
    <View style={styles.tabRow}>
      <Pressable style={[styles.tab, activeTab === "copros" && styles.tabActive]} onPress={() => setActiveTab("copros")}>
        <Text style={[styles.tabText, activeTab === "copros" && styles.tabTextActive]}>Copros</Text>
      </Pressable>
      <Pressable style={[styles.tab, activeTab === "activity" && styles.tabActive]} onPress={() => setActiveTab("activity")}>
        <Ionicons name="pulse-outline" size={13} color={activeTab === "activity" ? "#fff" : COLORS.textMuted} />
        <Text style={[styles.tabText, activeTab === "activity" && styles.tabTextActive]}>Activité</Text>
      </Pressable>
      <Pressable style={[styles.tab, activeTab === "demo" && styles.tabActive]} onPress={() => setActiveTab("demo")}>
        <Text style={[styles.tabText, activeTab === "demo" && styles.tabTextActive]}>Démo</Text>
        {demoUsers.length > 0 && (
          <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{demoUsers.length}</Text></View>
        )}
      </Pressable>
      <Pressable style={[styles.tab, activeTab === "system" && styles.tabActive]} onPress={() => setActiveTab("system")}>
        <Ionicons name="settings-outline" size={13} color={activeTab === "system" ? "#fff" : COLORS.textMuted} />
        <Text style={[styles.tabText, activeTab === "system" && styles.tabTextActive]}>Système</Text>
      </Pressable>
    </View>
  );

  // ── Vue Activité récente ─────────────────────────────────────────────────
  if (activeTab === "activity") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={{ paddingBottom: bottom + 24 }}>
          {topBar}
          {tabs}
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={styles.listHeader}>Inscriptions récentes</Text>
              <Pressable onPress={loadActivity} style={{ padding: 6 }}>
                <Ionicons name="refresh-outline" size={18} color={COLORS.primary} />
              </Pressable>
            </View>
            {activityLoading && <ActivityIndicator style={{ marginVertical: 30 }} color={COLORS.primary} />}
            {!activityLoading && activityUsers.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={32} color={COLORS.border} />
                <Text style={styles.emptyText}>Aucune inscription pour le moment</Text>
              </View>
            )}
            {activityUsers.map((u) => {
              const isDemo = u.accessType === "demo";
              const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
              return (
                <View key={u.uid} style={[styles.demoUserCard, { marginBottom: 10 }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isDemo ? "#EFF6FF" : "#D1FAE5", alignItems: "center", justifyContent: "center", marginRight: 10 }}>
                    <Ionicons name={isDemo ? "link-outline" : "time-outline"} size={16} color={isDemo ? COLORS.primary : "#059669"} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.demoUserEmail} numberOfLines={1}>{u.displayName || u.email}</Text>
                    <Text style={styles.demoUserMeta} numberOfLines={1}>{u.email}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <View style={{ backgroundColor: isDemo ? "#EFF6FF" : "#D1FAE5", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: isDemo ? COLORS.primary : "#059669" }}>
                          {isDemo ? "Démo" : "Essai 30j"}
                        </Text>
                      </View>
                      <Text style={styles.demoUserDate}>{date}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Vue Système ─────────────────────────────────────────────────────────
  if (activeTab === "system") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={{ paddingBottom: bottom + 24 }}>
          {topBar}
          {tabs}

          {/* Card maintenance */}
          <View style={[styles.demoCard, { marginTop: 16 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: maintenanceActive ? "#FEF2F2" : "#F1F5F9", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="settings" size={18} color={maintenanceActive ? COLORS.danger : COLORS.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.demoTitle}>Mode maintenance</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted }}>
                  Bloque l'accès à tous les utilisateurs
                </Text>
              </View>
              {!maintenanceLoaded
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Switch
                    value={maintenanceActive}
                    onValueChange={(v) => {
                      setMaintenanceActive(v);
                      handleSaveMaintenance(v);
                    }}
                    trackColor={{ false: COLORS.border, true: "#FCA5A5" }}
                    thumbColor={maintenanceActive ? COLORS.danger : "#fff"}
                    ios_backgroundColor={COLORS.border}
                  />
              }
            </View>

            {maintenanceActive && (
              <View style={{ backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10, marginBottom: 4 }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.danger, textAlign: "center" }}>
                  🔴 Application en maintenance — visible par tous les utilisateurs
                </Text>
              </View>
            )}

            <Text style={styles.demoLabel}>Message affiché (optionnel)</Text>
            <TextInput
              style={[styles.demoInput, { height: 80, textAlignVertical: "top", paddingTop: 10 }]}
              placeholder={"L'application est temporairement indisponible pour une mise à jour. Merci de votre patience."}
              placeholderTextColor={COLORS.textMuted}
              value={maintenanceMessage}
              onChangeText={setMaintenanceMessage}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.demoLabel}>Retour prévu (optionnel)</Text>
            <TextInput
              style={styles.demoInput}
              placeholder="ex : aujourd'hui à 14h00"
              placeholderTextColor={COLORS.textMuted}
              value={maintenanceEnd}
              onChangeText={setMaintenanceEnd}
            />

            <Pressable
              style={[styles.demoGrantBtn, { backgroundColor: maintenanceActive ? COLORS.danger : COLORS.success, flexDirection: "row", gap: 8 }, maintenanceSaving && { opacity: 0.5 }]}
              onPress={() => handleSaveMaintenance()}
              disabled={maintenanceSaving}
            >
              {maintenanceSaving
                ? <ActivityIndicator size="small" color="#fff" />
                : <>
                    <Ionicons name={maintenanceActive ? "warning-outline" : "checkmark-circle-outline"} size={16} color="#fff" />
                    <Text style={styles.demoGrantBtnText}>
                      {maintenanceActive ? "Enregistrer (maintenance ON)" : "Enregistrer (maintenance OFF)"}
                    </Text>
                  </>
              }
            </Pressable>
          </View>

          {/* Info */}
          <View style={{ marginHorizontal: 16, padding: 14, backgroundColor: "#EFF6FF", borderRadius: 12, borderWidth: 1, borderColor: "#BFDBFE" }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.primary, marginBottom: 4 }}>
              ℹ️ Comportement
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 18 }}>
              • Le mode maintenance s'applique immédiatement à tous les utilisateurs.{"\n"}
              • Le super-admin (toi) peut toujours accéder à l'application normalement.{"\n"}
              • Dès que tu désactives la maintenance, l'accès est restauré instantanément.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }
  // ────────────────────────────────────────────────────────────────────────

  const header = (
    <View>
      {topBar}
      {tabs}

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

  if (activeTab === "demo") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={{ paddingBottom: bottom + 24 }}>
          {topBar}
          {tabs}

          {/* Formulaire d'octroi */}
          <View style={styles.demoCard}>
            <Text style={styles.demoTitle}>Accorder un accès démo</Text>

            <Text style={styles.demoLabel}>Email</Text>
            <TextInput
              style={styles.demoInput}
              placeholder="utilisateur@example.com"
              placeholderTextColor={COLORS.textMuted}
              value={demoEmail}
              onChangeText={setDemoEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.demoLabel}>Nb. de copropriétés max</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setDemoMaxCopros(Math.max(1, demoMaxCopros - 1))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{demoMaxCopros}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setDemoMaxCopros(Math.min(30, demoMaxCopros + 1))}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Text style={styles.demoLabel}>Nb. de membres max par copropriété</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setDemoMaxMembers(Math.max(1, demoMaxMembers - 1))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{demoMaxMembers}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setDemoMaxMembers(Math.min(100, demoMaxMembers + 1))}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Text style={styles.demoLabel}>Expiration (jours, optionnel)</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setDemoExpiresInDays(demoExpiresInDays !== null && demoExpiresInDays <= 7 ? null : Math.max(7, (demoExpiresInDays ?? 14) - 7))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{demoExpiresInDays ? `${demoExpiresInDays}j` : "∞"}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setDemoExpiresInDays((demoExpiresInDays ?? 0) + 7)}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Pressable
              style={[styles.demoGrantBtn, (!demoEmail.trim() || demoGranting) && { opacity: 0.5 }]}
              onPress={handleGrantDemo}
              disabled={!demoEmail.trim() || demoGranting}
            >
              {demoGranting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.demoGrantBtnText}>Accorder l'accès</Text>
              }
            </Pressable>
          </View>

          {/* Génération de lien démo */}
          <View style={styles.demoCard}>
            <Text style={styles.demoTitle}>Générer un lien démo</Text>
            <Text style={[styles.demoLabel, { marginBottom: 10, color: COLORS.textMuted, fontSize: 12 }]}>
              Partagez ce lien — la personne s'inscrit directement avec les limites définies.
            </Text>

            <Text style={styles.demoLabel}>Nb. de copropriétés max</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setLinkMaxCopros(Math.max(1, linkMaxCopros - 1))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{linkMaxCopros}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setLinkMaxCopros(Math.min(30, linkMaxCopros + 1))}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Text style={styles.demoLabel}>Nb. de membres max par copropriété</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setLinkMaxMembers(Math.max(1, linkMaxMembers - 1))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{linkMaxMembers}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setLinkMaxMembers(Math.min(100, linkMaxMembers + 1))}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Text style={styles.demoLabel}>Durée de l'accès (jours)</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setLinkExpiresInDays(linkExpiresInDays !== null && linkExpiresInDays <= 7 ? null : Math.max(7, (linkExpiresInDays ?? 14) - 7))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{linkExpiresInDays ? `${linkExpiresInDays}j` : "∞"}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setLinkExpiresInDays((linkExpiresInDays ?? 0) + 7)}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Text style={styles.demoLabel}>Nb. d'utilisations max</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setLinkUsageLimit(Math.max(1, linkUsageLimit - 1))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{linkUsageLimit}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setLinkUsageLimit(linkUsageLimit + 1)}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Pressable
              style={[styles.demoGrantBtn, { backgroundColor: COLORS.primary }, linkGenerating && { opacity: 0.5 }]}
              onPress={handleGenerateLink}
              disabled={linkGenerating}
            >
              {linkGenerating
                ? <ActivityIndicator size="small" color="#fff" />
                : <><Ionicons name="link-outline" size={16} color="#fff" /><Text style={styles.demoGrantBtnText}>Générer le lien</Text></>
              }
            </Pressable>

            {!!generatedLink && (
              <View style={{ marginTop: 12, backgroundColor: "#EFF6FF", borderRadius: 10, padding: 12, gap: 8 }}>
                <Text style={{ fontSize: 11, color: COLORS.primary, fontFamily: "Inter_600SemiBold" }}>Lien généré ✓</Text>
                <Text selectable style={{ fontSize: 12, color: COLORS.text, fontFamily: "Inter_500Medium" }} numberOfLines={2}>{generatedLink}</Text>
                <Pressable
                  style={{ backgroundColor: COLORS.primary, borderRadius: 8, paddingVertical: 8, alignItems: "center" }}
                  onPress={async () => {
                    await Clipboard.setStringAsync(generatedLink ?? "");
                    Alert.alert("Copié !", "Le lien a été copié dans le presse-papier.");
                  }}
                >
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Copier le lien</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Liste des liens générés */}
          {demoLinks.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
              <Text style={[styles.listHeader, { marginBottom: 8 }]}>Liens générés ({demoLinks.length})</Text>
              {demoLinks.map((l) => (
                <View key={l.id} style={[styles.demoUserCard, { marginBottom: 8 }]}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.demoUserMeta}>
                      {l.maxCopros} copro{l.maxCopros !== 1 ? "s" : ""} · {l.maxMembersPerCopro} membres/copro
                      {l.demoExpiresInDays ? ` · ${l.demoExpiresInDays}j` : " · ∞"}
                    </Text>
                    <Text style={styles.demoUserDate}>
                      {l.usedCount}/{l.usageLimit} utilisation{l.usageLimit !== 1 ? "s" : ""} · {new Date(l.createdAt).toLocaleDateString("fr-FR")}
                    </Text>
                  </View>
                  <Pressable style={styles.revokeBtn} onPress={() => handleDeleteLink(l.id)}>
                    <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {/* Liste des accès démo */}
          <View style={{ paddingHorizontal: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={styles.listHeader}>{demoUsers.length} accès démo actif{demoUsers.length !== 1 ? "s" : ""}</Text>
              <Pressable style={styles.reminderBtn} onPress={handleSendReminders}>
                <Ionicons name="mail-outline" size={14} color="#1D4ED8" />
                <Text style={styles.reminderBtnText}>Envoyer rappels</Text>
              </Pressable>
            </View>
            {demoLoading && <ActivityIndicator style={{ marginVertical: 20 }} color={COLORS.primary} />}
            {demoUsers.map((u) => (
              <View key={u.id} style={styles.demoUserCard}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.demoUserEmail}>{u.email}</Text>
                  <Text style={styles.demoUserMeta}>
                    {u.maxCopros} copro{u.maxCopros !== 1 ? "s" : ""} · {u.maxMembersPerCopro} membres/copro
                    {u.expiresAt ? ` · expire ${new Date(u.expiresAt).toLocaleDateString("fr-FR")}` : " · sans expiration"}
                  </Text>
                  <Text style={styles.demoUserDate}>
                    Accordé le {new Date(u.grantedAt).toLocaleDateString("fr-FR")}
                  </Text>
                </View>
                <Pressable style={styles.revokeBtn} onPress={() => handleRevokeDemo(u.email)}>
                  <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                </Pressable>
              </View>
            ))}
            {!demoLoading && demoUsers.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="person-add-outline" size={32} color={COLORS.border} />
                <Text style={styles.emptyText}>Aucun accès démo accordé</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

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
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center", marginRight: 10 },
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

  // Tabs
  tabRow: { flexDirection: "row", marginHorizontal: 16, marginBottom: 4, marginTop: 12, gap: 8 },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 12, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  tabTextActive: { color: "#fff" },
  tabBadge: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
  },
  tabBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: COLORS.primary },

  // Demo section
  demoCard: {
    margin: 16, backgroundColor: COLORS.surface,
    borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 8,
  },
  demoTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 4 },
  demoLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, marginTop: 4 },
  demoInput: {
    height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 14, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.background,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center",
  },
  stepBtnText: { fontSize: 20, fontFamily: "Inter_400Regular", color: COLORS.text, lineHeight: 24 },
  stepVal: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, minWidth: 48, textAlign: "center" },
  demoGrantBtn: {
    marginTop: 8, backgroundColor: COLORS.primary, borderRadius: 12,
    paddingVertical: 13, alignItems: "center",
  },
  demoGrantBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  demoUserCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 10, gap: 12,
  },
  demoUserEmail: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  demoUserMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  demoUserDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  revokeBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center",
  },
  reminderBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#EFF6FF", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  reminderBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#1D4ED8" },
});
