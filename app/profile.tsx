import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { wConfirm } from "@/shared/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useInterventions } from "@/context/InterventionsContext";
import { useCoPro } from "@/context/CoProContext";
import { getApiUrl } from "@/lib/query-client";
import { collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Calcul jours d'essai restants ───────────────────────────────────────────

function trialDaysLeft(creationTime?: string | null): number {
  if (!creationTime) return 30;
  const created = new Date(creationTime).getTime();
  const elapsed = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
  return Math.max(0, 30 - elapsed);
}

// ─── Écran ────────────────────────────────────────────────────────────────────

// ─── Validation SIRET (exactement 14 chiffres) ───────────────────────────────
function isValidSiret(v: string) { return /^\d{14}$/.test(v.replace(/\s/g, "")); }
function formatSiret(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 9) return d;
  return d.slice(0, 9) + " " + d.slice(9);
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, deleteAccount, userType, rentalInfo, employerUid, employerName } = useAuth();
  const { stats } = useInterventions();
  const { userSubscription, currentRole, currentCopro } = useCoPro();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  // Stats location
  const [nbProperties, setNbProperties] = useState(0);
  const [nbTenants,    setNbTenants]    = useState(0);
  const [nbReports,    setNbReports]    = useState(0);

  // Préférences notifications
  const [notifSignalement, setNotifSignalement] = useState(true);
  const [notifMessage,     setNotifMessage]     = useState(true);
  const [notifQuittance,   setNotifQuittance]   = useState(false);

  // ── Salariés (section prestataire) ────────────────────────────────────────
  const isPrestataire = currentRole === "prestataire";
  const [salaries, setSalaries] = useState<{ uid: string; displayName: string; email: string }[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState("");
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!user?.uid || !isPrestataire) return;
    const q = query(collection(db, "users"), where("employerUid", "==", user.uid));
    const unsub = onSnapshot(q, (snap) => {
      setSalaries(snap.docs.map((d) => ({
        uid: d.id,
        displayName: d.data().displayName ?? d.data().email ?? "Salarié",
        email: d.data().email ?? "",
      })));
    }, () => {});
    return () => unsub();
  }, [user?.uid, isPrestataire]);

  const handleInviteSalarie = async () => {
    if (!inviteEmail.trim() || !user) return;
    setInviting(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(new URL("/api/invite-salarie", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          targetEmail: inviteEmail.trim().toLowerCase(),
          coProId: currentCopro?.id,
          coProName: currentCopro?.name,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setInviteToken(data.token);
        setInviteEmail("");
      } else {
        Alert.alert("Erreur", data.error ?? "Impossible d'envoyer l'invitation.");
      }
    } catch {
      Alert.alert("Erreur", "Impossible de joindre le serveur.");
    } finally {
      setInviting(false);
    }
  };

  const handleLinkEmployer = async () => {
    if (!linkCode.trim() || !user) return;
    setLinking(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(new URL("/api/salarie/link", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ token: linkCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (data.ok) {
        setShowLinkModal(false);
        setLinkCode("");
        Alert.alert("Compte rattaché", `Vous êtes maintenant rattaché à ${data.employerName}.`);
      } else {
        Alert.alert("Erreur", data.error ?? "Code invalide.");
      }
    } catch {
      Alert.alert("Erreur", "Impossible de joindre le serveur.");
    } finally {
      setLinking(false);
    }
  };

  // ── Profil professionnel bailleur ─────────────────────────────────────────
  const isLandlord = userType === "landlord" || userType === "both";
  const isTenant   = userType === "tenant";
  const [companyType,  setCompanyType]  = useState<"particulier" | "société">("particulier");
  const [companyName,  setCompanyName]  = useState("");
  const [siret,        setSiretRaw]     = useState("");
  const [agenceName,   setAgenceName]   = useState("");
  const [siretError,   setSiretError]   = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved,  setProfileSaved]  = useState(false);

  // Chargement initial du rentalProfile Firestore
  useEffect(() => {
    if (!user?.uid) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      if (!snap.exists()) return;
      const p = snap.data()?.rentalProfile ?? {};
      setCompanyType(p.companyType ?? "particulier");
      setCompanyName(p.companyName ?? "");
      setSiretRaw(p.siret ? formatSiret(p.siret) : "");
      setAgenceName(p.agenceName ?? "");
    }).catch(() => {});
  }, [user?.uid]);

  const handleSiretChange = (text: string) => {
    const formatted = formatSiret(text);
    setSiretRaw(formatted);
    setSiretError("");
  };

  const handleSaveProfile = async () => {
    const cleanSiret = siret.replace(/\s/g, "");
    if (companyType === "société" && cleanSiret && !isValidSiret(cleanSiret)) {
      setSiretError("Le numéro SIRET doit contenir exactement 14 chiffres.");
      return;
    }
    if (!user?.uid) return;
    setProfileSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        rentalProfile: {
          companyType,
          companyName: companyType === "société" ? companyName : "",
          siret: companyType === "société" ? cleanSiret : "",
          agenceName,
        },
      });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch {
      if (Platform.OS === "web") {
        window.alert("Impossible de sauvegarder. Réessayez.");
      } else {
        Alert.alert("Erreur", "Impossible de sauvegarder. Réessayez.");
      }
    } finally {
      setProfileSaving(false);
    }
  };

  const isAdmin = currentRole === "admin" || currentRole === "co-admin";
  const daysLeft = trialDaysLeft(user?.metadata?.creationTime);
  const isTrialExpired = daysLeft === 0;
  const hasPaidSub = userSubscription?.status === "active";

  useEffect(() => {
    if (!user?.uid) return;
    // Logements du bailleur
    getDocs(query(collection(db, "properties"), where("landlordId", "==", user.uid)))
      .then(async (snap) => {
        setNbProperties(snap.size);
        let tenants = 0, reports = 0;
        await Promise.all(snap.docs.map(async (propDoc) => {
          const [tSnap, rSnap] = await Promise.all([
            getDocs(query(collection(db, "properties", propDoc.id, "tenants"), where("status", "==", "active"))),
            getDocs(collection(db, "properties", propDoc.id, "tenantReports")),
          ]);
          tenants += tSnap.size;
          reports += rSnap.size;
        }));
        setNbTenants(tenants);
        setNbReports(reports);
      })
      .catch(() => {});
  }, [user?.uid]);

  const handleBillingPortal = async () => {
    if (!user) return;
    setOpeningPortal(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(new URL("/api/billing-portal", getApiUrl()).toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (data.url) Linking.openURL(data.url);
      else Alert.alert("Erreur", data.error ?? "Impossible d'ouvrir le portail.");
    } catch {
      Alert.alert("Erreur", "Impossible de joindre le serveur.");
    } finally {
      setOpeningPortal(false);
    }
  };

  const handleLogout = () => {
    wConfirm(
      "Déconnexion",
      "Voulez-vous vous déconnecter ?",
      async () => {
        setIsLoggingOut(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        await logout();
        router.dismissAll();
      },
      "Se déconnecter",
    );
  };

  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const handleDeleteAccount = () => {
    wConfirm(
      "Supprimer mon compte",
      "Cette action est irréversible. Votre compte et toutes vos données seront définitivement supprimés.",
      () => wConfirm(
        "Confirmer la suppression",
        `Supprimer définitivement le compte ${user?.email} ? Impossible d'annuler.`,
        async () => {
          setIsDeletingAccount(true);
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          }
          try {
            await deleteAccount();
          } catch (e: any) {
            setIsDeletingAccount(false);
            if (Platform.OS === "web") {
              window.alert(e?.message ?? "Impossible de supprimer le compte. Réessayez.");
            } else {
              Alert.alert("Erreur", e?.message ?? "Impossible de supprimer le compte. Réessayez.");
            }
          }
        },
        "Supprimer définitivement",
      ),
      "Continuer",
    );
  };

  const initials = user?.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.[0].toUpperCase() ?? "?";

  const topPadding    = Platform.OS === "web" ? 0 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={s.root}>
      {/* Hero gradient */}
      <LinearGradient
        colors={[COLORS.dark, COLORS.darkMid]}
        style={[s.hero, { paddingTop: topPadding + 16 }]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      >
        <View style={s.heroHeader}>
          <Pressable onPress={() => router.back()} style={s.closeBtn}>
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
        </View>

        <View style={s.avatarWrap}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
        </View>

        <Text style={s.heroName}>{user?.displayName ?? "Bailleur"}</Text>
        <Text style={s.heroEmail}>{user?.email}</Text>

        {/* Stats logements */}
        <View style={s.heroStats}>
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{nbProperties}</Text>
            <Text style={s.heroStatLabel}>Logement{nbProperties > 1 ? "s" : ""}</Text>
          </View>
          <View style={s.heroStatDivider} />
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{nbTenants}</Text>
            <Text style={s.heroStatLabel}>Locataire{nbTenants > 1 ? "s" : ""}</Text>
          </View>
          <View style={s.heroStatDivider} />
          <View style={s.heroStat}>
            <Text style={[s.heroStatVal, { color: nbReports > 0 ? "#FCA5A5" : "#fff" }]}>{nbReports}</Text>
            <Text style={s.heroStatLabel}>Signalement{nbReports > 1 ? "s" : ""}</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: bottomPadding + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Abonnement ─────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Abonnement</Text>

          {hasPaidSub ? (
            <Pressable onPress={handleBillingPortal} disabled={openingPortal}
              style={({ pressed }) => [s.subCard, s.subCardActive, pressed && { opacity: 0.85 }]}>
              <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                {openingPortal
                  ? <ActivityIndicator size="small" color="#16A34A" />
                  : <Ionicons name="checkmark-circle" size={20} color="#16A34A" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.subTitle}>Abonnement actif</Text>
                <Text style={s.subSub}>Gérer, modifier ou résilier</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </Pressable>
          ) : (
            <View style={[s.subCard, isTrialExpired ? s.subCardExpired : s.subCardTrial]}>
              <View style={[s.rowIcon, { backgroundColor: isTrialExpired ? "#FEF2F2" : "#FFF7ED" }]}>
                <Ionicons
                  name={isTrialExpired ? "warning-outline" : "time-outline"}
                  size={20}
                  color={isTrialExpired ? "#EF4444" : "#F59E0B"}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.subTitle, isTrialExpired && { color: "#EF4444" }]}>
                  {isTrialExpired ? "Période d'essai expirée" : `Période d'essai — ${daysLeft} jour${daysLeft > 1 ? "s" : ""} restant${daysLeft > 1 ? "s" : ""}`}
                </Text>
                <Text style={s.subSub}>
                  {isTrialExpired
                    ? "Souscrivez pour continuer à utiliser Maintena"
                    : "Accès complet à toutes les fonctionnalités"}
                </Text>
              </View>
              {isTrialExpired && (
                <View style={s.subBadge}>
                  <Text style={s.subBadgeText}>S'abonner</Text>
                </View>
              )}
            </View>
          )}

          {!hasPaidSub && (
            <View style={s.card}>
              <View style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: "#F5F3FF" }]}>
                  <Ionicons name="star-outline" size={18} color="#8B5CF6" />
                </View>
                <View style={s.rowContent}>
                  <Text style={s.rowLabel}>Forfait</Text>
                  <Text style={s.rowValue}>Bailleur — Essai gratuit 30 jours</Text>
                </View>
              </View>
              <View style={s.separator} />
              <View style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                  <Ionicons name="infinite-outline" size={18} color={COLORS.primary} />
                </View>
                <View style={s.rowContent}>
                  <Text style={s.rowLabel}>Inclus</Text>
                  <Text style={s.rowValue}>Logements illimités · États des lieux · Messagerie · Interventions</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* ── Notifications ───────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Notifications</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#FEF2F2" }]}>
                <Ionicons name="warning-outline" size={18} color="#EF4444" />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowValue}>Nouveaux signalements</Text>
                <Text style={s.rowLabel}>Alertes locataire en temps réel</Text>
              </View>
              <Switch
                value={notifSignalement}
                onValueChange={setNotifSignalement}
                trackColor={{ true: "#8B5CF6", false: COLORS.border }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.separator} />

            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                <Ionicons name="chatbubbles-outline" size={18} color={COLORS.primary} />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowValue}>Nouveaux messages</Text>
                <Text style={s.rowLabel}>Messages vocaux et texte</Text>
              </View>
              <Switch
                value={notifMessage}
                onValueChange={setNotifMessage}
                trackColor={{ true: "#8B5CF6", false: COLORS.border }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.separator} />

            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                <Ionicons name="document-text-outline" size={18} color="#16A34A" />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowValue}>Rappels quittances</Text>
                <Text style={s.rowLabel}>Rappel mensuel d'émission</Text>
              </View>
              <Switch
                value={notifQuittance}
                onValueChange={setNotifQuittance}
                trackColor={{ true: "#8B5CF6", false: COLORS.border }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </View>

        {/* ── Compte ─────────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Compte</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                <Ionicons name="person-outline" size={18} color={COLORS.primary} />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowLabel}>Nom</Text>
                <Text style={s.rowValue}>{user?.displayName ?? "Non renseigné"}</Text>
              </View>
            </View>
            <View style={s.separator} />
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                <Ionicons name="mail-outline" size={18} color="#16A34A" />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowLabel}>Email</Text>
                <Text style={s.rowValue}>{user?.email}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Mes salariés (prestataire) ──────────────────────────────────── */}
        {isPrestataire && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Mes salariés</Text>
            <View style={s.card}>
              {salaries.length === 0 ? (
                <View style={s.row}>
                  <View style={[s.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                    <Ionicons name="people-outline" size={18} color={COLORS.primary} />
                  </View>
                  <View style={s.rowContent}>
                    <Text style={s.rowValue}>Aucun salarié</Text>
                    <Text style={s.rowLabel}>Invitez vos employés pour qu'ils accèdent à vos interventions</Text>
                  </View>
                </View>
              ) : (
                salaries.map((sal, idx) => (
                  <React.Fragment key={sal.uid}>
                    {idx > 0 && <View style={s.separator} />}
                    <View style={s.row}>
                      <View style={[s.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                        <Ionicons name="person-circle-outline" size={18} color={COLORS.primary} />
                      </View>
                      <View style={s.rowContent}>
                        <Text style={s.rowValue}>{sal.displayName}</Text>
                        <Text style={s.rowLabel}>{sal.email}</Text>
                      </View>
                    </View>
                  </React.Fragment>
                ))
              )}
              {salaries.length > 0 && <View style={s.separator} />}
              <Pressable
                style={({ pressed }) => [s.row, pressed && { opacity: 0.75 }]}
                onPress={() => { setInviteToken(null); setShowInviteModal(true); }}
              >
                <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                  <Ionicons name="person-add-outline" size={18} color="#16A34A" />
                </View>
                <View style={s.rowContent}>
                  <Text style={[s.rowValue, { color: "#16A34A" }]}>Inviter un salarié</Text>
                  <Text style={s.rowLabel}>Envoyer un code par email</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Rattacher à un employeur (salarié) ─────────────────────────── */}
        {isPrestataire && !employerUid && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Compte salarié</Text>
            <View style={s.card}>
              <Pressable
                style={({ pressed }) => [s.row, pressed && { opacity: 0.75 }]}
                onPress={() => setShowLinkModal(true)}
              >
                <View style={[s.rowIcon, { backgroundColor: "#FFF7ED" }]}>
                  <Ionicons name="link-outline" size={18} color="#F59E0B" />
                </View>
                <View style={s.rowContent}>
                  <Text style={s.rowValue}>Rattacher à un employeur</Text>
                  <Text style={s.rowLabel}>Saisir le code reçu par email</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </Pressable>
            </View>
          </View>
        )}

        {isPrestataire && !!employerUid && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Compte salarié</Text>
            <View style={s.card}>
              <View style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#16A34A" />
                </View>
                <View style={s.rowContent}>
                  <Text style={s.rowValue}>Rattaché à {employerName ?? "votre employeur"}</Text>
                  <Text style={s.rowLabel}>Vous avez accès aux interventions de votre employeur</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Informations bailleur ───────────────────────────────────────── */}
        {isLandlord && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Informations bailleur</Text>
            <View style={s.card}>

              {/* Type : Particulier / Société */}
              <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
                <View style={[s.rowIcon, { backgroundColor: "#F5F3FF" }]}>
                  <Ionicons name="business-outline" size={18} color="#8B5CF6" />
                </View>
                <Text style={[s.rowLabel, { flex: 1, alignSelf: "center" }]}>Type de bailleur</Text>
                <View style={pi.typeRow}>
                  {(["particulier", "société"] as const).map((t) => (
                    <Pressable
                      key={t}
                      style={[pi.typeChip, companyType === t && pi.typeChipActive]}
                      onPress={() => { setCompanyType(t); setSiretError(""); }}
                    >
                      <Text style={[pi.typeChipText, companyType === t && pi.typeChipTextActive]}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Raison sociale (si société) */}
              {companyType === "société" && (
                <>
                  <View style={s.separator} />
                  <View style={s.row}>
                    <View style={[s.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                      <Ionicons name="briefcase-outline" size={18} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowLabel}>Raison sociale</Text>
                      <TextInput
                        style={pi.input}
                        value={companyName}
                        onChangeText={setCompanyName}
                        placeholder="Nom de la société"
                        placeholderTextColor={COLORS.textMuted}
                        autoCapitalize="words"
                      />
                    </View>
                  </View>

                  <View style={s.separator} />

                  {/* SIRET */}
                  <View style={s.row}>
                    <View style={[s.rowIcon, { backgroundColor: "#FFF7ED" }]}>
                      <Ionicons name="barcode-outline" size={18} color="#F59E0B" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowLabel}>N° SIRET <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>(14 chiffres)</Text></Text>
                      <TextInput
                        style={[pi.input, siretError ? pi.inputError : null]}
                        value={siret}
                        onChangeText={handleSiretChange}
                        placeholder="123 456 789 00012"
                        placeholderTextColor={COLORS.textMuted}
                        keyboardType="numeric"
                        maxLength={16}
                      />
                      {siretError ? <Text style={pi.errorText}>{siretError}</Text> : null}
                    </View>
                  </View>
                </>
              )}

              <View style={s.separator} />

              {/* Agence */}
              <View style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                  <Ionicons name="home-outline" size={18} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>Agence immobilière <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>(optionnel)</Text></Text>
                  <TextInput
                    style={pi.input}
                    value={agenceName}
                    onChangeText={setAgenceName}
                    placeholder="Nom de l'agence"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              <View style={s.separator} />

              {/* Bouton enregistrer */}
              <Pressable
                style={({ pressed }) => [pi.saveBtn, pressed && { opacity: 0.8 }, profileSaved && pi.saveBtnDone]}
                onPress={handleSaveProfile}
                disabled={profileSaving}
              >
                {profileSaving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name={profileSaved ? "checkmark" : "save-outline"} size={16} color="#fff" />}
                <Text style={pi.saveBtnText}>{profileSaved ? "Enregistré !" : "Enregistrer"}</Text>
              </Pressable>

            </View>
          </View>
        )}

        {/* ── Informations locataire ───────────────────────────────────────── */}
        {isTenant && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Informations</Text>
            <View style={s.card}>
              <View style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                  <Ionicons name="home-outline" size={18} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>Agence immobilière <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>(optionnel)</Text></Text>
                  <TextInput
                    style={pi.input}
                    value={agenceName}
                    onChangeText={setAgenceName}
                    placeholder="Nom de l'agence"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="words"
                  />
                </View>
              </View>
              <View style={s.separator} />
              <Pressable
                style={({ pressed }) => [pi.saveBtn, pressed && { opacity: 0.8 }, profileSaved && pi.saveBtnDone]}
                onPress={handleSaveProfile}
                disabled={profileSaving}
              >
                {profileSaving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name={profileSaved ? "checkmark" : "save-outline"} size={16} color="#fff" />}
                <Text style={pi.saveBtnText}>{profileSaved ? "Enregistré !" : "Enregistrer"}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Application ─────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Application</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#F5F3FF" }]}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#2563EB" />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowLabel}>Stockage</Text>
                <Text style={s.rowValue}>Firebase Firestore</Text>
              </View>
            </View>
            <View style={s.separator} />
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#FFF7ED" }]}>
                <Ionicons name="server-outline" size={18} color={COLORS.warning} />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowLabel}>Version</Text>
                <Text style={s.rowValue}>Maintena 1.0</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Déconnexion ─────────────────────────────────────────────────── */}
        <Pressable
          onPress={handleLogout}
          disabled={isLoggingOut}
          style={({ pressed }) => [s.logoutBtn, pressed && { opacity: 0.85 }]}
        >
          {isLoggingOut
            ? <ActivityIndicator size="small" color={COLORS.danger} />
            : <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />}
          <Text style={s.logoutText}>Se déconnecter</Text>
        </Pressable>

        {/* ── Suppression compte ───────────────────────────────────────────── */}
        <Pressable
          onPress={handleDeleteAccount}
          disabled={isDeletingAccount}
          style={({ pressed }) => [s.deleteAccountBtn, pressed && { opacity: 0.7 }]}
        >
          {isDeletingAccount
            ? <ActivityIndicator size="small" color="#9CA3AF" />
            : <Ionicons name="trash-outline" size={15} color="#9CA3AF" />}
          <Text style={s.deleteAccountText}>Supprimer mon compte</Text>
        </Pressable>
      </ScrollView>

      {/* ── Modal inviter salarié ──────────────────────────────────────────── */}
      {showInviteModal && (
        <Pressable
          style={mod.overlay}
          onPress={() => { if (!inviting) { setShowInviteModal(false); setInviteToken(null); } }}
        >
          <Pressable style={mod.sheet} onPress={(e) => e.stopPropagation()}>
            {inviteToken ? (
              <>
                <Text style={mod.title}>Invitation envoyée !</Text>
                <Text style={mod.sub}>Partagez ce code à votre salarié :</Text>
                <View style={mod.tokenBox}>
                  <Text style={mod.token}>{inviteToken}</Text>
                </View>
                <Text style={mod.hint}>Un email a été envoyé avec les instructions.</Text>
                <Pressable
                  style={({ pressed }) => [mod.btn, pressed && { opacity: 0.8 }]}
                  onPress={() => { setShowInviteModal(false); setInviteToken(null); }}
                >
                  <Text style={mod.btnText}>Fermer</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={mod.title}>Inviter un salarié</Text>
                <Text style={mod.sub}>Adresse email du salarié</Text>
                <TextInput
                  style={mod.input}
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  placeholder="prenom.nom@email.com"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  style={({ pressed }) => [mod.btn, pressed && { opacity: 0.8 }, (!inviteEmail.trim() || inviting) && { opacity: 0.5 }]}
                  onPress={handleInviteSalarie}
                  disabled={!inviteEmail.trim() || inviting}
                >
                  {inviting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={mod.btnText}>Envoyer l'invitation</Text>}
                </Pressable>
                <Pressable style={mod.cancel} onPress={() => setShowInviteModal(false)}>
                  <Text style={mod.cancelText}>Annuler</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      )}

      {/* ── Modal rattacher à un employeur ────────────────────────────────── */}
      {showLinkModal && (
        <Pressable
          style={mod.overlay}
          onPress={() => { if (!linking) setShowLinkModal(false); }}
        >
          <Pressable style={mod.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={mod.title}>Code employeur</Text>
            <Text style={mod.sub}>Saisissez le code reçu par email de votre prestataire / employeur</Text>
            <TextInput
              style={[mod.input, { letterSpacing: 4, textAlign: "center", fontSize: 22, fontFamily: "Inter_700Bold" }]}
              value={linkCode}
              onChangeText={(t) => setLinkCode(t.toUpperCase())}
              placeholder="ABC123"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
            />
            <Pressable
              style={({ pressed }) => [mod.btn, pressed && { opacity: 0.8 }, (!linkCode.trim() || linking) && { opacity: 0.5 }]}
              onPress={handleLinkEmployer}
              disabled={!linkCode.trim() || linking}
            >
              {linking
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={mod.btnText}>Rattacher mon compte</Text>}
            </Pressable>
            <Pressable style={mod.cancel} onPress={() => setShowLinkModal(false)}>
              <Text style={mod.cancelText}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: COLORS.background },

  hero:    { paddingHorizontal: 20, paddingBottom: 28, alignItems: "center" },
  heroHeader: { width: "100%", flexDirection: "row", justifyContent: "flex-end", marginBottom: 16 },
  closeBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  avatarWrap: { marginBottom: 14 },
  avatar:     { width: 72, height: 72, borderRadius: 24, backgroundColor: "#8B5CF6", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,0.2)" },
  avatarText: { fontSize: 26, fontFamily: "Inter_700Bold", color: "#fff" },
  heroName:   { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", marginBottom: 4 },
  heroEmail:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)", marginBottom: 20 },
  heroStats:  { flexDirection: "row", alignItems: "center", paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)", width: "100%", justifyContent: "center" },
  heroStat:   { flex: 1, alignItems: "center" },
  heroStatVal:   { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  heroStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", marginTop: 2 },
  heroStatDivider: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.15)" },

  content: { padding: 16, gap: 16 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: 4 },

  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  row:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  rowValue: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  separator: { height: 1, backgroundColor: COLORS.border, marginLeft: 62 },

  subCard:        { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1.5, padding: 16 },
  subCardTrial:   { backgroundColor: "#FFFBEB", borderColor: "#FCD34D" },
  subCardExpired: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  subCardActive:  { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  subTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  subSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  subBadge: { backgroundColor: "#8B5CF6", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  subBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },

  logoutBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, backgroundColor: "#FEF2F2", borderRadius: 16, borderWidth: 1, borderColor: "#FECACA", marginTop: 4 },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.danger },
  deleteAccountBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginTop: 4, marginBottom: 8 },
  deleteAccountText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", textDecorationLine: "underline" },
});

// ─── Styles modaux salarié ────────────────────────────────────────────────────
const mod = StyleSheet.create({
  overlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 28, paddingBottom: 40, gap: 12,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text },
  sub:   { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textMuted, lineHeight: 20 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: "Inter_400Regular", color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  btn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: "center", justifyContent: "center",
    marginTop: 4,
  },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  cancel: { alignItems: "center", paddingVertical: 8 },
  cancelText: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  tokenBox: {
    backgroundColor: "#0B1628", borderRadius: 14,
    paddingVertical: 20, alignItems: "center",
  },
  token: {
    fontSize: 36, fontFamily: "Inter_700Bold", color: "#fff",
    letterSpacing: 8, fontVariant: ["tabular-nums"],
  },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
});

// ─── Styles formulaire profil bailleur/locataire ──────────────────────────────
const pi = StyleSheet.create({
  typeRow:          { flexDirection: "row", gap: 6 },
  typeChip:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background },
  typeChipActive:   { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6" },
  typeChipText:     { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  typeChipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  input:            { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border, marginTop: 2 },
  inputError:       { borderBottomColor: "#EF4444" },
  errorText:        { fontSize: 11, fontFamily: "Inter_400Regular", color: "#EF4444", marginTop: 4 },
  saveBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#8B5CF6", borderRadius: 12, paddingVertical: 12, marginTop: 6 },
  saveBtnDone:      { backgroundColor: "#16A34A" },
  saveBtnText:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
