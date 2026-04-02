import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
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
  user: any | null;
  isLoading: boolean;
  isSuperAdmin: boolean;
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsLoading(false);
    });
    return unsub;
  }, []);

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

      await activateInvitedMember(
        cred.user.uid,
        email,
        firstName,
        lastName,
        phone,
        inviteCode
      );
    } catch (e: any) {
      const msg = firebaseErrorMessage(e?.code);
      setError(msg);
      throw new Error(msg);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
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

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isSuperAdmin,
      error,
      clearError,
      login,
      register,
      logout,
      deleteAccount,
    }),
    [user, isLoading, isSuperAdmin, error, clearError, login, register, logout, deleteAccount]
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
