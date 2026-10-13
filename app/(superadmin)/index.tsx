import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, ScrollView,
  RefreshControl, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { arrayRemove, arrayUnion, doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { getApiUrl } from "@/lib/query-client";
import { CoPro, CoProStatus } from "@/shared/types";

type Trial = {
  id: string;
  type: "copro" | "rental";
  name: string;
  email: string;
  adminId: string;
  trialEndsAt: string;
  daysLeft: number;
  status: "active" | "expired" | "converted";
  createdAt: string;
};

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
  const { user, logout, isSuperAdmin, isCollaborator, previewRole, setPreviewRole } = useAuth();
  const { setPreviewCoproRole, setPreviewCoPro } = useCoPro();
  const [copros, setCopros] = useState<CoPro[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"copros" | "demo" | "activity" | "system" | "trials">("copros");

  // Invitations salarié state
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteResult, setInviteResult] = useState<{ token: string; status: string; targetEmail: string; employerName: string | null; createdAt: string; expiresAt: string } | null>(null);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviteResetting, setInviteResetting] = useState(false);

  const handleSearchInvite = async () => {
    const tok = inviteSearch.trim().toUpperCase();
    if (!tok) return;
    setInviteSearching(true);
    setInviteResult(null);
    try {
      const snap = await getDoc(doc(db, "salarie_invites", tok));
      if (!snap.exists()) { Alert.alert("Introuvable", "Aucune invitation trouvée pour ce code."); return; }
      const d = snap.data();
      setInviteResult({ token: tok, status: d.status, targetEmail: d.targetEmail, employerName: d.employerName ?? d.inviterName ?? null, createdAt: d.createdAt, expiresAt: d.expiresAt });
    } catch { Alert.alert("Erreur", "Impossible de rechercher."); }
    finally { setInviteSearching(false); }
  };

  const handleResetInvite = async () => {
    if (!inviteResult) return;
    setInviteResetting(true);
    try {
      await setDoc(doc(db, "salarie_invites", inviteResult.token), { status: "pending" }, { merge: true });
      setInviteResult((prev) => prev ? { ...prev, status: "pending" } : prev);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { Alert.alert("Erreur", "Impossible de remettre en attente."); }
    finally { setInviteResetting(false); }
  };

  // Trials state
  const [trials, setTrials] = useState<Trial[]>([]);
  const [trialsLoading, setTrialsLoading] = useState(false);
  const [trialsFilter, setTrialsFilter] = useState<"all" | "active" | "expired" | "converted">("all");
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [discountModal, setDiscountModal] = useState<Trial | null>(null);
  const [discountPercent, setDiscountPercent] = useState(20);
  const [discountExtraDays, setDiscountExtraDays] = useState(0);
  const [discountMessage, setDiscountMessage] = useState("");
  const [discountSending, setDiscountSending] = useState(false);

  // Collaborators state
  const [collaboratorEmails, setCollaboratorEmails] = useState<string[]>([]);
  const [newCollaboratorEmail, setNewCollaboratorEmail] = useState("");
  const [collaboratorSaving, setCollaboratorSaving] = useState(false);

  // Free access state
  const [freeAccessModal, setFreeAccessModal] = useState<CoPro | null>(null);
  const [freeAccessDays, setFreeAccessDays] = useState<number | null>(null); // null = à vie
  const [freeAccessReason, setFreeAccessReason] = useState("");
  const [freeAccessSaving, setFreeAccessSaving] = useState(false);

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

  const loadTrials = useCallback(async () => {
    if (!user) return;
    setTrialsLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(new URL("/api/superadmin/list-trials", getApiUrl()).toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setTrials(data.trials ?? []);
    } catch (e) {
      console.error("load trials error:", e);
    } finally {
      setTrialsLoading(false);
    }
  }, [user]);

  const handleExtendTrial = async (trial: Trial, extraDays: number) => {
    if (!user) return;
    setExtendingId(trial.id + extraDays);
    try {
      const token = await user.getIdToken();
      const res = await fetch(new URL("/api/superadmin/extend-trial", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: trial.type, id: trial.id, extraDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const newEnd = new Date(data.trialEndsAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
      Alert.alert(
        "Essai prolongé ✓",
        `+${extraDays} jours accordés à ${trial.email}.\nNouvelle fin : ${newEnd}\n\n📧 Un email de notification a été envoyé automatiquement.`
      );
      loadTrials();
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setExtendingId(null);
    }
  };

  const handleSendDiscount = async () => {
    if (!discountModal || !user) return;
    setDiscountSending(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(new URL("/api/superadmin/send-discount-offer", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: discountModal.email,
          name: discountModal.name,
          discountPercent: discountPercent > 0 ? discountPercent : undefined,
          extraDays: discountExtraDays > 0 ? discountExtraDays : undefined,
          message: discountMessage.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Email envoyé ✓", `Offre envoyée à ${discountModal.email}`);
      setDiscountModal(null);
      setDiscountMessage("");
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setDiscountSending(false);
    }
  };

  const handleGrantFreeAccess = async () => {
    if (!freeAccessModal || !user) return;
    setFreeAccessSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(new URL("/api/superadmin/grant-free-access", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          coProId: freeAccessModal.id,
          durationDays: freeAccessDays,
          reason: freeAccessReason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const label = freeAccessDays
        ? `${freeAccessDays} jours offerts à ${freeAccessModal.adminEmail}`
        : `Accès à vie accordé à ${freeAccessModal.adminEmail}`;
      Alert.alert("Accès offert ✓", label);
      setFreeAccessModal(null);
      setFreeAccessReason("");
      loadCopros();
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setFreeAccessSaving(false);
    }
  };

  // Collaborateurs — lecture en temps réel (seulement pour le super admin)
  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsub = onSnapshot(doc(db, "appConfig", "collaborators"), (snap) => {
      setCollaboratorEmails(snap.exists() ? (snap.data()?.emails ?? []) : []);
    });
    return unsub;
  }, [isSuperAdmin]);

  const handleAddCollaborator = async () => {
    const email = newCollaboratorEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    setCollaboratorSaving(true);
    try {
      await setDoc(doc(db, "appConfig", "collaborators"), { emails: arrayUnion(email) }, { merge: true });
      setNewCollaboratorEmail("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setCollaboratorSaving(false);
    }
  };

  const handleRemoveCollaborator = (email: string) => {
    Alert.alert("Retirer ce collaborateur ?", email, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Retirer", style: "destructive",
        onPress: async () => {
          try {
            await setDoc(doc(db, "appConfig", "collaborators"), { emails: arrayRemove(email) }, { merge: true });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e: any) {
            Alert.alert("Erreur", e.message);
          }
        },
      },
    ]);
  };

  useEffect(() => { loadCopros(); }, [loadCopros]);
  useEffect(() => { if (activeTab === "demo") loadDemoUsers(); }, [activeTab, loadDemoUsers]);
  useEffect(() => { if (activeTab === "activity") loadActivity(); }, [activeTab, loadActivity]);
  useEffect(() => { if (activeTab === "trials") loadTrials(); }, [activeTab, loadTrials]);
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
        <Text style={styles.pageTitle}>{isCollaborator && !isSuperAdmin ? "Admin · Collaborateur" : "Super Admin"}</Text>
        <Text style={styles.pageSubtitle}>{user?.email}</Text>
      </View>
      <Pressable style={styles.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
      </Pressable>
    </View>
  );

  const tabs = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}
    >
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
      <Pressable style={[styles.tab, activeTab === "trials" && styles.tabActive]} onPress={() => setActiveTab("trials")}>
        <Ionicons name="timer-outline" size={13} color={activeTab === "trials" ? "#fff" : COLORS.textMuted} />
        <Text style={[styles.tabText, activeTab === "trials" && styles.tabTextActive]}>Essais</Text>
        {trials.filter((t) => t.status === "expired").length > 0 && (
          <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{trials.filter((t) => t.status === "expired").length}</Text></View>
        )}
      </Pressable>
      <Pressable style={[styles.tab, activeTab === "system" && styles.tabActive]} onPress={() => setActiveTab("system")}>
        <Ionicons name="settings-outline" size={13} color={activeTab === "system" ? "#fff" : COLORS.textMuted} />
        <Text style={[styles.tabText, activeTab === "system" && styles.tabTextActive]}>Système</Text>
      </Pressable>
    </ScrollView>
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

  // ── Vue Essais ──────────────────────────────────────────────────────────
  if (activeTab === "trials") {
    const filteredTrials = trials.filter((t) => trialsFilter === "all" || t.status === trialsFilter);
    const counts = {
      all: trials.length,
      active: trials.filter((t) => t.status === "active").length,
      expired: trials.filter((t) => t.status === "expired").length,
      converted: trials.filter((t) => t.status === "converted").length,
    };

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={{ paddingBottom: bottom + 24 }}>
          {topBar}
          {tabs}

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{counts.all}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: "#D1FAE5" }]}>
              <Text style={[styles.statVal, { color: "#059669" }]}>{counts.active}</Text>
              <Text style={styles.statLabel}>Actifs</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: "#FEF2F2" }]}>
              <Text style={[styles.statVal, { color: COLORS.danger }]}>{counts.expired}</Text>
              <Text style={styles.statLabel}>Expirés</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: "#EDE9FE" }]}>
              <Text style={[styles.statVal, { color: COLORS.primary }]}>{counts.converted}</Text>
              <Text style={styles.statLabel}>Convertis</Text>
            </View>
          </View>

          {/* Filtres */}
          <View style={{ flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 12 }}>
            {(["all", "active", "expired", "converted"] as const).map((f) => (
              <Pressable
                key={f}
                style={[styles.filterChip, trialsFilter === f && styles.filterChipActive]}
                onPress={() => setTrialsFilter(f)}
              >
                <Text style={[styles.filterChipText, trialsFilter === f && styles.filterChipTextActive]}>
                  {f === "all" ? "Tous" : f === "active" ? "Actifs" : f === "expired" ? "Expirés" : "Convertis"}
                </Text>
              </Pressable>
            ))}
          </View>

          {trialsLoading && <ActivityIndicator style={{ marginVertical: 30 }} color={COLORS.primary} />}

          {!trialsLoading && filteredTrials.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="timer-outline" size={32} color={COLORS.border} />
              <Text style={styles.emptyText}>Aucun essai dans cette catégorie</Text>
            </View>
          )}

          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {filteredTrials.map((t) => {
              const isExpired = t.status === "expired";
              const isConverted = t.status === "converted";
              const endDate = new Date(t.trialEndsAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
              return (
                <View key={t.id} style={[styles.trialCard, isExpired && styles.trialCardExpired, isConverted && styles.trialCardConverted]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <View style={[styles.trialTypeIcon, t.type === "copro" ? { backgroundColor: "#EDE9FE" } : { backgroundColor: "#D1FAE5" }]}>
                      <Ionicons name={t.type === "copro" ? "business-outline" : "key-outline"} size={16} color={t.type === "copro" ? COLORS.primary : "#059669"} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.trialName} numberOfLines={1}>{t.name}</Text>
                      <Text style={styles.trialEmail} numberOfLines={1}>{t.email}</Text>
                    </View>
                    <View style={[
                      styles.trialStatusBadge,
                      isExpired ? { backgroundColor: "#FEE2E2" } : isConverted ? { backgroundColor: "#EDE9FE" } : { backgroundColor: "#D1FAE5" }
                    ]}>
                      <Text style={[
                        styles.trialStatusText,
                        isExpired ? { color: "#991B1B" } : isConverted ? { color: COLORS.primary } : { color: "#065F46" }
                      ]}>
                        {isExpired ? `expiré il y a ${Math.abs(t.daysLeft)}j` : isConverted ? "Converti ✓" : `${t.daysLeft}j restants`}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.trialDate}>
                    {t.type === "copro" ? "Copropriété" : "Bailleur"} · Fin le {endDate}
                  </Text>

                  {!isConverted && (
                    <View style={styles.trialActions}>
                      {([
                        { label: "+7j", days: 7 },
                        { label: "+30j", days: 30 },
                        { label: "+3 mois", days: 90 },
                        { label: "+1 an", days: 365 },
                      ]).map(({ label, days }) => (
                        <Pressable
                          key={days}
                          style={[styles.extendBtn, extendingId === t.id + days && { opacity: 0.5 }]}
                          onPress={() => handleExtendTrial(t, days)}
                          disabled={!!extendingId}
                        >
                          {extendingId === t.id + days
                            ? <ActivityIndicator size="small" color={COLORS.primary} />
                            : <Text style={styles.extendBtnText}>{label}</Text>
                          }
                        </Pressable>
                      ))}
                      <Pressable
                        style={styles.discountBtn}
                        onPress={() => { setDiscountModal(t); setDiscountPercent(20); setDiscountExtraDays(0); setDiscountMessage(""); }}
                      >
                        <Ionicons name="gift-outline" size={14} color="#D97706" />
                        <Text style={styles.discountBtnText}>Offre</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Modal offre remise */}
        <Modal visible={!!discountModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setDiscountModal(null)}>
          <View style={{ flex: 1, backgroundColor: COLORS.background, padding: 24, paddingTop: 32 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text }}>Envoyer une offre</Text>
              <Pressable onPress={() => setDiscountModal(null)} hitSlop={12}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </Pressable>
            </View>

            {discountModal && (
              <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text }}>{discountModal.name}</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted }}>{discountModal.email}</Text>
              </View>
            )}

            <Text style={styles.demoLabel}>Réduction (%, 0 = aucune)</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setDiscountPercent(Math.max(0, discountPercent - 5))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{discountPercent > 0 ? `${discountPercent}%` : "—"}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setDiscountPercent(Math.min(100, discountPercent + 5))}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Text style={[styles.demoLabel, { marginTop: 12 }]}>Jours supplémentaires (0 = aucun)</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setDiscountExtraDays(Math.max(0, discountExtraDays - 7))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{discountExtraDays > 0 ? `+${discountExtraDays}j` : "—"}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setDiscountExtraDays(discountExtraDays + 7)}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Text style={[styles.demoLabel, { marginTop: 12 }]}>Message personnalisé (optionnel)</Text>
            <TextInput
              style={[styles.demoInput, { height: 90, textAlignVertical: "top", paddingTop: 10, marginTop: 4 }]}
              placeholder="Ex : Nous avons remarqué que vous avez essayé Maintena. Voici une offre spéciale pour vous..."
              placeholderTextColor={COLORS.textMuted}
              value={discountMessage}
              onChangeText={setDiscountMessage}
              multiline
            />

            <Pressable
              style={[styles.demoGrantBtn, { marginTop: 20 }, discountSending && { opacity: 0.5 }]}
              onPress={handleSendDiscount}
              disabled={discountSending}
            >
              {discountSending
                ? <ActivityIndicator size="small" color="#fff" />
                : <><Ionicons name="mail-outline" size={16} color="#fff" /><Text style={styles.demoGrantBtnText}>Envoyer l'offre</Text></>
              }
            </Pressable>
          </View>
        </Modal>
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

          {/* Card prévisualisation */}
          <View style={[styles.demoCard, { marginTop: 16 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="eye-outline" size={18} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.demoTitle}>Prévisualiser un rôle</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted }}>
                  Naviguer comme un utilisateur sans se déconnecter
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {([
                { nav: "copro", coproRole: "admin",        label: "🏢 Admin",       color: "#1E40AF", bg: "#EFF6FF" },
                { nav: "copro", coproRole: "prestataire",  label: "👷 Prestataire", color: "#7C3AED", bg: "#F5F3FF" },
                { nav: "copro", coproRole: "propriétaire", label: "🏠 Propriétaire",color: "#B45309", bg: "#FFFBEB" },
                { nav: "copro", coproRole: "conseil",      label: "🗣 Conseil",     color: "#0F766E", bg: "#F0FDF9" },
                { nav: "rental", coproRole: null,          label: "🔑 Bailleur",    color: "#059669", bg: "#ECFDF5" },
                { nav: "tenant", coproRole: null,          label: "👤 Locataire",   color: "#475569", bg: "#F1F5F9" },
              ] as const).map(({ nav, coproRole, label, color, bg }) => {
                const isActive = previewRole === nav && (nav !== "copro" || (nav === "copro" && previewRole === "copro"));
                return (
                  <Pressable
                    key={`${nav}-${coproRole}`}
                    style={{ backgroundColor: isActive ? color : bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
                    onPress={() => {
                      if (nav === "copro") {
                        if (copros.length === 0) {
                          Alert.alert("Aucune copropriété", "Créez d'abord une copropriété dans l'onglet Copros pour pouvoir prévisualiser.");
                          return;
                        }
                        setPreviewCoPro(copros[0]);
                        setPreviewCoproRole(coproRole as any);
                        setPreviewRole("copro");
                        router.replace("/(app)");
                      } else {
                        setPreviewCoPro(null);
                        setPreviewCoproRole(null);
                        setPreviewRole(nav);
                        router.replace(nav === "rental" ? "/(rental-onboarding)" : "/(tenant)");
                      }
                    }}
                  >
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: isActive ? "#fff" : color }}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {previewRole && (
              <View style={{ marginTop: 10, backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="eye" size={14} color={COLORS.danger} />
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.danger, flex: 1 }}>
                  Mode prévisualisation actif — une barre violette est visible en bas de l'écran
                </Text>
              </View>
            )}
          </View>

          {/* Card maintenance */}
          <View style={[styles.demoCard, { marginTop: 12 }]}>
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
          <View style={{ marginHorizontal: 16, padding: 14, backgroundColor: "#EFF6FF", borderRadius: 12, borderWidth: 1, borderColor: "#BFDBFE", marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.primary, marginBottom: 4 }}>
              ℹ️ Comportement
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 18 }}>
              • Le mode maintenance s'applique immédiatement à tous les utilisateurs.{"\n"}
              • Le super-admin (toi) peut toujours accéder à l'application normalement.{"\n"}
              • Dès que tu désactives la maintenance, l'accès est restauré instantanément.
            </Text>
          </View>

          {/* Collaborateurs — visible uniquement pour le super admin */}
          {isSuperAdmin && (
            <View style={[styles.demoCard, { marginTop: 0 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="people-outline" size={18} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.demoTitle}>Collaborateurs admin</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted }}>
                    Accès complet au panneau, sans pouvoir supprimer votre compte
                  </Text>
                </View>
              </View>

              {/* Liste des collaborateurs */}
              {collaboratorEmails.length === 0 ? (
                <View style={{ backgroundColor: "#F8FAFC", borderRadius: 10, padding: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted }}>Aucun collaborateur pour le moment</Text>
                </View>
              ) : (
                <View style={{ gap: 6 }}>
                  {collaboratorEmails.map((email) => (
                    <View key={email} style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: COLORS.border }}>
                      <Ionicons name="person-circle-outline" size={18} color={COLORS.primary} style={{ marginRight: 8 }} />
                      <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.text }} numberOfLines={1}>{email}</Text>
                      <Pressable
                        style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center" }}
                        onPress={() => handleRemoveCollaborator(email)}
                      >
                        <Ionicons name="trash-outline" size={14} color={COLORS.danger} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              {/* Ajouter un collaborateur */}
              <Text style={[styles.demoLabel, { marginTop: 8 }]}>Ajouter un collaborateur</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                <TextInput
                  style={[styles.demoInput, { flex: 1 }]}
                  placeholder="email@exemple.com"
                  placeholderTextColor={COLORS.textMuted}
                  value={newCollaboratorEmail}
                  onChangeText={setNewCollaboratorEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <Pressable
                  style={[styles.demoGrantBtn, { paddingHorizontal: 16, marginTop: 0 }, (!newCollaboratorEmail.trim() || collaboratorSaving) && { opacity: 0.5 }]}
                  onPress={handleAddCollaborator}
                  disabled={!newCollaboratorEmail.trim() || collaboratorSaving}
                >
                  {collaboratorSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="add" size={20} color="#fff" />
                  }
                </Pressable>
              </View>
            </View>
          )}

          {/* Badge collaborateur */}
          {isCollaborator && !isSuperAdmin && (
            <View style={{ marginHorizontal: 16, padding: 14, backgroundColor: "#EDE9FE", borderRadius: 12, borderWidth: 1, borderColor: "#DDD6FE" }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.primary, marginBottom: 4 }}>
                👤 Mode collaborateur
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#5B21B6", lineHeight: 18 }}>
                Vous avez accès à toutes les fonctionnalités d'administration sauf la gestion des collaborateurs et la suppression du compte super admin.
              </Text>
            </View>
          )}

          {/* ── Invitations salarié ── */}
          <View style={[styles.demoCard, { marginTop: 12 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="key-outline" size={18} color="#16A34A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.demoTitle}>Invitations salarié</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted }}>
                  Rechercher et remettre en attente un code d'invitation
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={[styles.searchWrap, { flex: 1, marginHorizontal: 0 }]}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Code invitation (ex: A3F9B2)"
                  placeholderTextColor={COLORS.textMuted}
                  value={inviteSearch}
                  onChangeText={(t) => setInviteSearch(t.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>
              <Pressable
                style={({ pressed }) => ({ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center", opacity: pressed ? 0.8 : 1 })}
                onPress={handleSearchInvite}
                disabled={inviteSearching}
              >
                {inviteSearching ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
              </Pressable>
            </View>

            {inviteResult && (
              <View style={{ marginTop: 12, backgroundColor: "#F8FAFC", borderRadius: 10, padding: 12, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, letterSpacing: 2 }}>{inviteResult.token}</Text>
                  <View style={{ backgroundColor: inviteResult.status === "pending" ? "#D1FAE5" : inviteResult.status === "accepted" ? "#DBEAFE" : "#FEF2F2", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: inviteResult.status === "pending" ? "#065F46" : inviteResult.status === "accepted" ? "#1E40AF" : "#991B1B" }}>
                      {inviteResult.status === "pending" ? "En attente" : inviteResult.status === "accepted" ? "Utilisé" : inviteResult.status}
                    </Text>
                  </View>
                </View>
                <Text style={{ fontSize: 13, color: COLORS.textMuted }}>Email : {inviteResult.targetEmail}</Text>
                {inviteResult.employerName && <Text style={{ fontSize: 13, color: COLORS.textMuted }}>Employeur : {inviteResult.employerName}</Text>}
                <Text style={{ fontSize: 12, color: COLORS.textMuted }}>Expire : {new Date(inviteResult.expiresAt).toLocaleDateString("fr-FR")}</Text>
                {inviteResult.status !== "pending" && (
                  <Pressable
                    style={({ pressed }) => ({ marginTop: 8, backgroundColor: "#16A34A", borderRadius: 10, padding: 10, alignItems: "center", opacity: pressed ? 0.8 : 1 })}
                    onPress={handleResetInvite}
                    disabled={inviteResetting}
                  >
                    {inviteResetting
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Remettre en attente</Text>
                    }
                  </Pressable>
                )}
                {inviteResult.status === "pending" && (
                  <Text style={{ fontSize: 13, color: "#16A34A", fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 4 }}>
                    ✓ Déjà en attente — le salarié peut utiliser ce code
                  </Text>
                )}
              </View>
            )}
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
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A" }]}
                  onPress={() => { setFreeAccessModal(item); setFreeAccessDays(null); setFreeAccessReason(""); }}
                  disabled={isUpdating}
                >
                  <Ionicons name="gift-outline" size={15} color="#D97706" />
                  <Text style={[styles.actionActivateText, { color: "#D97706" }]}>Offert</Text>
                </Pressable>
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

      {/* Modal accès offert */}
      <Modal visible={!!freeAccessModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setFreeAccessModal(null)}>
        <View style={{ flex: 1, backgroundColor: COLORS.background, padding: 24, paddingTop: 32 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text }}>🎁 Accès offert</Text>
            <Pressable onPress={() => setFreeAccessModal(null)} hitSlop={12}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          {freeAccessModal && (
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text }}>{freeAccessModal.name}</Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted }}>{freeAccessModal.adminEmail}</Text>
            </View>
          )}

          <Text style={styles.demoLabel}>Durée</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20, marginTop: 6 }}>
            {([
              { label: "3 mois", days: 90 },
              { label: "6 mois", days: 180 },
              { label: "1 an", days: 365 },
              { label: "2 ans", days: 730 },
              { label: "5 ans", days: 1825 },
              { label: "10 ans", days: 3650 },
              { label: "À vie", days: null },
            ] as { label: string; days: number | null }[]).map(({ label, days }) => (
              <Pressable
                key={label}
                style={[
                  styles.filterChip,
                  freeAccessDays === days && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                  days === null && freeAccessDays === null && { backgroundColor: "#D97706", borderColor: "#D97706" },
                ]}
                onPress={() => setFreeAccessDays(days)}
              >
                <Text style={[
                  styles.filterChipText,
                  freeAccessDays === days && { color: "#fff" },
                  days === null && freeAccessDays === null && { color: "#fff" },
                ]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {freeAccessDays === null && (
            <View style={{ backgroundColor: "#FFFBEB", borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: "#FDE68A" }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E" }}>
                ⚠️ Accès à vie — aucune date d'expiration. L'abonnement restera actif indéfiniment.
              </Text>
            </View>
          )}

          <Text style={styles.demoLabel}>Raison (optionnel)</Text>
          <TextInput
            style={[styles.demoInput, { marginTop: 4 }]}
            placeholder="Ex : Ma résidence, offert à vie"
            placeholderTextColor={COLORS.textMuted}
            value={freeAccessReason}
            onChangeText={setFreeAccessReason}
          />

          <Pressable
            style={[
              styles.demoGrantBtn,
              { marginTop: 24 },
              freeAccessDays === null
                ? { backgroundColor: "#D97706" }
                : { backgroundColor: COLORS.primary },
              (freeAccessSaving || freeAccessDays === undefined) && { opacity: 0.5 },
            ]}
            onPress={handleGrantFreeAccess}
            disabled={freeAccessSaving || freeAccessDays === undefined}
          >
            {freeAccessSaving
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Ionicons name="gift-outline" size={16} color="#fff" />
                  <Text style={styles.demoGrantBtnText}>
                    {freeAccessDays === null ? "Accorder l'accès à vie" : `Accorder ${freeAccessDays} jours`}
                  </Text>
                </>
            }
          </Pressable>
        </View>
      </Modal>
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
  tabRow: { flexDirection: "row", gap: 8 },
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

  // Trials
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  filterChipTextActive: { color: "#fff" },

  trialCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, gap: 4,
  },
  trialCardExpired: { borderColor: "#FECACA", backgroundColor: "#FFFAFA" },
  trialCardConverted: { borderColor: "#DDD6FE", backgroundColor: "#FAF5FF" },
  trialTypeIcon: {
    width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  trialName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  trialEmail: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  trialStatusBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  trialStatusText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  trialDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  trialActions: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  extendBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#EFF6FF", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: "#BFDBFE",
  },
  extendBtnText: { fontSize: 12, fontFamily: "Inter_700Bold", color: COLORS.primary },
  discountBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#FFFBEB", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: "#FDE68A",
  },
  discountBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#D97706" },
});
