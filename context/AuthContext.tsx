import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "firebase/auth";
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { auth, db } from "@/lib/firebase";
import { apiRequest } from "@/lib/query-client";
import { registerPushToken } from "@/lib/notifications";
import type { UserType, RentalInfo } from "@/shared/types";

const SUPER_ADMIN_EMAIL =
  process.env.EXPO_PUBLIC_SUPER_ADMIN_EMAIL ?? "admin@example.com";

interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  inviteCode?: string;
}

interface AuthContextValue {
  resetPassword: (email: string) => Promise<void>;
  user: any | null;
  isLoading: boolean;
  isSuperAdmin: boolean;
  // ── Module Location ──────────────────────────────
  userType: UserType | null;
  hasRentalSetup: boolean;
  rentalInfo: RentalInfo | null;
  /** Profil bailleur : companyType, siret, companyName, agenceName */
  rentalProfile: { companyType?: "particulier" | "société"; siret?: string; companyName?: string; agenceName?: string } | null;
  /** Vrai si le bailleur a un SIRET renseigné ou est une société → plan Pro requis */
  isPro: boolean;
  setUserType: (type: UserType) => Promise<void>;
  resetUserType: () => Promise<void>;
  markRentalSetup: () => Promise<void>;
  // ────────────────────────────────────────────────
  error: string | null;
  clearError: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").trim();
}

async function activateInvitedMember(
  uid: string,
  email: string,
  firstName: string,
  lastName: string,
  phone: string,
  inviteCode?: string
) {
  if (!inviteCode) return;

  const coprosSnap = await getDocs(collection(db, "copros"));

  for (const coproDoc of coprosSnap.docs) {
    const membersRef = collection(db, "copros", coproDoc.id, "members");
    const q = query(
      membersRef,
      where("inviteCode", "==", inviteCode),
      where("invitationEmail", "==", email.toLowerCase())
    );

    const snap = await getDocs(q);

    if (!snap.empty) {
      const memberDoc = snap.docs[0];
      const displayName = `${firstName} ${lastName}`.trim();

      await updateDoc(doc(db, "copros", coproDoc.id, "members", memberDoc.id), {
        uid,
        email: email.toLowerCase(),
        displayName,
        firstName,
        lastName,
        phone,
        accountStatus: "active",
        inviteCode: null,
        joinedAt: new Date().toISOString(),
      });

      return;
    }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [authReady, setAuthReady] = useState(false);
  // Démarre à true : évite le bref window où authReady=true mais userType pas encore chargé
  // → isLoading reste true jusqu'à ce que Firestore ait répondu (ou user non connecté)
  const [userDataLoading, setUserDataLoading] = useState(true);
  const [userType, setUserTypeState] = useState<UserType | null>(null);
  const [hasRentalSetup, setHasRentalSetup] = useState(false);
  const [rentalInfo, setRentalInfo] = useState<RentalInfo | null>(null);
  const [rentalProfile, setRentalProfile] = useState<{ companyType?: "particulier" | "société"; siret?: string; companyName?: string; agenceName?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // isLoading reste true tant que Firebase Auth OU les données Firestore ne sont pas prêtes
  const isLoading = !authReady || userDataLoading;

  // Effet 1 : surveillance de l'état d'authentification Firebase
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        // Utilisateur déconnecté : réinitialiser les données locales
        setUserTypeState(null);
        setHasRentalSetup(false);
        setRentalInfo(null);
        setRentalProfile(null);
        setUserDataLoading(false);
      }
      if (u?.uid) registerPushToken(u.uid).catch(() => {});
    });
    return unsub;
  }, []);

  // Effet 2 : chargement en temps réel de userType et hasRentalSetup depuis Firestore
  useEffect(() => {
    if (!authReady || !user?.uid) {
      if (authReady && !user?.uid) setUserDataLoading(false);
      return;
    }

    setUserDataLoading(true);
    const unsub = onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setUserTypeState((data.userType as UserType) ?? null);
          setHasRentalSetup(data.hasRentalSetup === true);
          setRentalInfo((data.rentalInfo as RentalInfo) ?? null);
          setRentalProfile(data.rentalProfile ?? null);
        }
        setUserDataLoading(false);
      },
      () => {
        // En cas d'erreur Firestore : ne pas bloquer l'app
        setUserDataLoading(false);
      }
    );

    return () => unsub();
  }, [user?.uid, authReady]);

  const isSuperAdmin = useMemo(
    () => !!user && user.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase(),
    [user]
  );

  const clearError = useCallback(() => setError(null), []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e: any) {
      const msg = firebaseErrorMessage(e?.code);
      setError(msg);
      throw new Error(msg);
    }
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    setError(null);

    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const email = payload.email.trim().toLowerCase();
    const phone = normalizePhone(payload.phone);
    const password = payload.password;
    const inviteCode = payload.inviteCode?.trim();

    try {
      // Unicité du numéro de téléphone
      if (phone) {
        const phoneIndexSnap = await getDoc(doc(db, "phoneIndex", phone));
        if (phoneIndexSnap.exists()) {
          const msg = "Ce numéro de téléphone est déjà associé à un compte.";
          setError(msg);
          throw new Error(msg);
        }
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const displayName = `${firstName} ${lastName}`.trim();

      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }

      await setDoc(
        doc(db, "users", cred.user.uid),
        {
          uid: cred.user.uid,
          email,
          displayName,
          firstName,
          lastName,
          phone,
          createdAt: new Date().toISOString(),
          createdAtServer: serverTimestamp(),
        },
        { merge: true }
      );

      // Enregistrer l'index téléphone pour garantir l'unicité
      if (phone) {
        await setDoc(doc(db, "phoneIndex", phone), {
          uid: cred.user.uid,
          createdAt: new Date().toISOString(),
        });
      }

      // Rejoindre automatiquement les copros en attente liées à ce numéro
      if (phone) {
        try {
          const pendingSnap = await getDoc(doc(db, "pendingProviders", phone));
          if (pendingSnap.exists()) {
            const pending = pendingSnap.data();
            const coProIds: string[] = pending.coProIds ?? [];

            for (const coProId of coProIds) {
              const categoryFilter = pending.categoryFilters?.[coProId];
              const memberRef = doc(db, "copros", coProId, "members", cred.user.uid);
              await setDoc(memberRef, {
                uid: cred.user.uid,
                email,
                displayName,
                firstName,
                lastName,
                phone,
                role: "prestataire",
                ...(categoryFilter ? { categoryFilter } : {}),
                joinedAt: new Date().toISOString(),
                accountStatus: "active",
              }, { merge: true });

              try {
                await updateDoc(doc(db, "users", cred.user.uid), {
                  managedCoproIds: arrayUnion(coProId),
                });
              } catch {
                await setDoc(
                  doc(db, "users", cred.user.uid),
                  { managedCoproIds: [coProId] },
                  { merge: true }
                );
              }
            }

            await deleteDoc(doc(db, "pendingProviders", phone));
          }
        } catch (pendingErr) {
          console.warn("[MAINTENA] pendingProviders auto-join failed:", pendingErr);
        }
      }

      await activateInvitedMember(
        cred.user.uid,
        email,
        firstName,
        lastName,
        phone,
        inviteCode
      );
    } catch (e: any) {
      if (e?.message?.includes("numéro de téléphone")) {
        throw e;
      }
      const msg = firebaseErrorMessage(e?.code);
      setError(msg);
      throw new Error(msg);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
  }, []);

  const deleteAccount = useCallback(async () => {
    if (!auth.currentUser) throw new Error("Non connecté.");

    try {
      const token = await auth.currentUser.getIdToken(true);
      await apiRequest("POST", "/api/account/delete", undefined, {
        Authorization: `Bearer ${token}`,
      });
      await signOut(auth);
    } catch (e: any) {
      if (e?.message?.includes("401") || e?.code === "auth/requires-recent-login") {
        throw new Error(
          "Pour des raisons de sécurité, reconnectez-vous avant de supprimer votre compte."
        );
      }

      try {
        await deleteUser(auth.currentUser);
      } catch {}

      throw e;
    }
  }, []);

  // ── Module Location ─────────────────────────────────────────────────────────

  /** Définit le type d'utilisateur (copro, landlord, tenant, both) dans Firestore */
  const setUserType = useCallback(async (type: UserType) => {
    if (!user?.uid) return;
    await setDoc(doc(db, "users", user.uid), { userType: type }, { merge: true });
    // Pas besoin d'appeler setUserTypeState : onSnapshot le met à jour automatiquement
  }, [user?.uid]);

  /** Réinitialise le type d'utilisateur → redirige vers l'onboarding */
  const resetUserType = useCallback(async () => {
    if (!user?.uid) return;
    await updateDoc(doc(db, "users", user.uid), {
      userType: deleteField(),
      hasRentalSetup: deleteField(),
    });
  }, [user?.uid]);

  /** Marque le module Location comme configuré (premier logement créé) */
  const markRentalSetup = useCallback(async () => {
    if (!user?.uid) return;
    await setDoc(doc(db, "users", user.uid), { hasRentalSetup: true }, { merge: true });
  }, [user?.uid]);

  // ────────────────────────────────────────────────────────────────────────────

  // Un bailleur est "Pro" s'il a un SIRET ou est une société → plan gratuit non applicable
  const isPro = useMemo(
    () => rentalProfile?.companyType === "société" || !!rentalProfile?.siret,
    [rentalProfile]
  );

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isSuperAdmin,
      userType,
      hasRentalSetup,
      rentalInfo,
      rentalProfile,
      isPro,
      error,
      clearError,
      login,
      register,
      logout,
      deleteAccount,
      resetPassword,
      setUserType,
      resetUserType,
      markRentalSetup,
    }),
    [
      user, isLoading, isSuperAdmin,
      userType, hasRentalSetup, rentalInfo, rentalProfile, isPro,
      error, clearError, login, register, logout, deleteAccount, resetPassword,
      setUserType, resetUserType, markRentalSetup,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

function firebaseErrorMessage(code?: string): string {
  switch (code) {
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email ou mot de passe incorrect.";
    case "auth/email-already-in-use":
      return "Cet email est déjà utilisé.";
    case "auth/invalid-email":
      return "Adresse email invalide.";
    case "auth/weak-password":
      return "Le mot de passe doit contenir au moins 6 caractères.";
    case "auth/too-many-requests":
      return "Trop de tentatives. Réessayez plus tard.";
    case "auth/network-request-failed":
      return "Erreur réseau. Vérifiez votre connexion.";
    case "auth/operation-not-allowed":
      return "La création de compte par email n'est pas activée dans Firebase.";
    case "permission-denied":
      return "Firebase refuse l'accès. Il faut corriger les règles Firestore.";
    default:
      return code ? `Erreur technique : ${code}` : "Une erreur est survenue.";
  }
}
