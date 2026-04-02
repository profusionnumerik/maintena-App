import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  collectionGroup,
  orderBy,
} from "firebase/firestore";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { db } from "@/lib/firebase";
import { apiRequest } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import {
  Announcement,
  AnnouncementType,
  Category,
  CoPro,
  Member,
  MemberRole,
  UserSubscription,
  Signalement,
} from "@/shared/types";

const CURRENT_COPRO_KEY = "@maintena_current_copro";

interface InvitePrestatairePayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  categoryFilter: Category;
}

interface CoProContextValue {
  copros: CoPro[];
  currentCopro: CoPro | null;
  currentRole: MemberRole | null;
  categoryFilter: Category | null;
  members: Member[];
  signalements: Signalement[];
  announcements: Announcement[];
  isLoading: boolean;
  loadError: string | null;
  userSubscription: UserSubscription | null;
  isSubscribed: boolean;
  switchCoPro: (id: string) => void;
  createCoPro: (
    name: string,
    street: string,
    postalCode: string,
    city: string,
    lat?: number,
    lng?: number
  ) => Promise<CoPro>;
  joinCoPro: (code: string) => Promise<CoPro>;
  updateCoProStatus: (coProId: string, status: CoPro["status"]) => Promise<void>;
  refreshCoPros: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
  generateInviteLink: () => string;
  generateCategoryCode: (category: Category) => Promise<string>;
  invitePrestataire: (
    payload: InvitePrestatairePayload
  ) => Promise<{ inviteCode: string; memberId: string }>;
  removeMember: (uid: string) => Promise<void>;
  addSignalement: (
    message: string,
    senderName: string,
    apartmentNumber: string,
    photoUris?: string[]
  ) => Promise<void>;
  markSignalementRead: (id: string) => Promise<void>;
  acknowledgeSignalement: (id: string) => Promise<void>;
  deleteSignalement: (id: string) => Promise<void>;
  toggleAlertEmail: () => Promise<void>;
  addAnnouncement: (
    title: string,
    message: string,
    type: AnnouncementType,
    expiresAt?: string
  ) => Promise<void>;
  deleteAnnouncement: (id: string) => Promise<void>;
}

const CoProContext = createContext<CoProContextValue | null>(null);

function generateCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").trim();
}

function computeSubscriptionStatus(data: any): UserSubscription {
  if (!data?.subscriptionStatus || data.subscriptionStatus === "none") {
    return { status: "none" };
  }
  const expiresAt = data.subscriptionExpiresAt as string | undefined;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return {
      status: "expired",
      activatedAt: data.subscriptionActivatedAt,
      expiresAt,
    };
  }
  return {
    status: data.subscriptionStatus as "active",
    activatedAt: data.subscriptionActivatedAt,
    expiresAt,
  };
}

export function CoProProvider({ children }: { children: React.ReactNode }) {
  const { user, isSuperAdmin } = useAuth();
  const [copros, setCopros] = useState<CoPro[]>([]);
  const [currentCoproId, setCurrentCoproId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roleMap, setRoleMap] = useState<Record<string, MemberRole>>({});
  const [userSubscription, setUserSubscription] =
    useState<UserSubscription | null>(null);
  const [signalements, setSignalements] = useState<Signalement[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    if (!user) {
      setCopros([]);
      setCurrentCoproId(null);
      setMembers([]);
      setUserSubscription(null);
      setIsLoading(false);
      return;
    }
    loadUserCopros();
    loadUserSubscription(user.uid);
  }, [user]);

  const loadUserSubscription = async (uid: string) => {
    try {
      const snap = await getDocFromServer(doc(db, "users", uid));
      if (snap.exists()) {
        const computed = computeSubscriptionStatus(snap.data());
        setUserSubscription(computed);
      } else {
        setUserSubscription({ status: "none" });
      }
    } catch (e) {
      console.warn("[MAINTENA] loadUserSubscription error:", e);
      setUserSubscription({ status: "none" });
    }
  };

  const loadUserCopros = async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);

    try {
      if (isSuperAdmin) {
        const snap = await getDocs(collection(db, "copros"));
        const list: CoPro[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CoPro, "id">),
        }));
        setCopros(list);
        await selectDefault(list);
        return;
      }

      const roles: Record<string, MemberRole> = {};
      const coProMap: Record<string, CoPro> = {};
      let s1Succeeded = false;

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const managedIds: string[] = userSnap.exists()
          ? userSnap.data().managedCoproIds ?? []
          : [];

        await Promise.all(
          managedIds.map(async (id: string) => {
            try {
              const snap = await getDoc(doc(db, "copros", id));
              if (snap.exists()) {
                coProMap[id] = {
                  id: snap.id,
                  ...(snap.data() as Omit<CoPro, "id">),
                };

                const memberRef = doc(db, "copros", id, "members", user.uid);
                const memberSnap = await getDoc(memberRef);

                if (memberSnap.exists()) {
                  roles[id] = memberSnap.data().role as MemberRole;
                } else {
                  roles[id] = "admin";
                  try {
                    await setDoc(memberRef, {
                      uid: user.uid,
                      email: user.email ?? "",
                      displayName: user.displayName ?? user.email ?? "",
                      firstName: null,
                      lastName: null,
                      phone: null,
                      role: "admin",
                      joinedAt: new Date().toISOString(),
                      accountStatus: "active",
                    });
                  } catch (_) {}
                }
              }
            } catch (_) {}
          })
        );

        s1Succeeded = true;
      } catch (_) {}

      if (Object.keys(coProMap).length === 0) {
        try {
          const adminSnap = await getDocs(
            query(collection(db, "copros"), where("adminId", "==", user.uid))
          );

          await Promise.all(
            adminSnap.docs.map(async (d) => {
              coProMap[d.id] = {
                id: d.id,
                ...(d.data() as Omit<CoPro, "id">),
              };
              roles[d.id] = "admin";

              try {
                const memberRef = doc(db, "copros", d.id, "members", user.uid);
                const ms = await getDoc(memberRef);
                if (!ms.exists()) {
                  await setDoc(memberRef, {
                    uid: user.uid,
                    email: user.email ?? "",
                    displayName: user.displayName ?? user.email ?? "",
                    firstName: null,
                    lastName: null,
                    phone: null,
                    role: "admin",
                    joinedAt: new Date().toISOString(),
                    accountStatus: "active",
                  });
                }
              } catch (_) {}
            })
          );

          const adminIds = adminSnap.docs.map((d) => d.id);
          if (adminIds.length > 0) {
            try {
              await updateDoc(doc(db, "users", user.uid), {
                managedCoproIds: arrayUnion(...adminIds),
              });
            } catch {
              await setDoc(
                doc(db, "users", user.uid),
                { managedCoproIds: adminIds },
                { merge: true }
              );
            }
          }
        } catch (_) {}
      }

      if (Object.keys(coProMap).length === 0) {
        try {
          const memberships = await getDocs(
            query(collectionGroup(db, "members"), where("uid", "==", user.uid))
          );

          const extraIds: string[] = [];

          memberships.docs.forEach((d) => {
            const coProId = d.ref.parent.parent!.id;
            roles[coProId] = d.data().role as MemberRole;
            if (!coProMap[coProId]) extraIds.push(coProId);
          });

          await Promise.all(
            extraIds.map(async (id) => {
              try {
                const snap = await getDoc(doc(db, "copros", id));
                if (snap.exists()) {
                  coProMap[id] = {
                    id: snap.id,
                    ...(snap.data() as Omit<CoPro, "id">),
                  };
                }
              } catch (_) {}
            })
          );

          if (extraIds.length > 0) {
            try {
              await updateDoc(doc(db, "users", user.uid), {
                managedCoproIds: arrayUnion(...extraIds),
              });
            } catch (_) {}
          }
        } catch (_) {}
      }

      const list = Object.values(coProMap);

      if (list.length === 0 && !s1Succeeded) {
        setLoadError(
          "Impossible de charger les copropriétés. Vérifiez votre connexion."
        );
      }

      setRoleMap(roles);
      setCopros(list);
      await selectDefault(list);
    } catch (e: any) {
      setLoadError("Erreur de chargement. Vérifiez votre connexion.");
    } finally {
      setIsLoading(false);
    }
  };

  const selectDefault = async (list: CoPro[]) => {
    const stored = await AsyncStorage.getItem(CURRENT_COPRO_KEY);
    if (stored && list.find((c) => c.id === stored)) {
      setCurrentCoproId(stored);
    } else if (list.length > 0) {
      setCurrentCoproId(list[0].id);
      await AsyncStorage.setItem(CURRENT_COPRO_KEY, list[0].id);
    }
  };

  useEffect(() => {
    if (!currentCoproId) {
      setMembers([]);
      return;
    }

    const unsub = onSnapshot(
      collection(db, "copros", currentCoproId, "members"),
      (snap) => {
        setMembers(
          snap.docs.map((d) => ({
            ...(d.data() as Member),
            uid: d.id,
          }))
        );
      }
    );

    const coProUnsub = onSnapshot(doc(db, "copros", currentCoproId), (d) => {
      if (d.exists()) {
        setCopros((prev) =>
          prev.map((c) =>
            c.id === currentCoproId
              ? { ...c, ...(d.data() as Omit<CoPro, "id">) }
              : c
          )
        );
      }
    });

    return () => {
      unsub();
      coProUnsub();
    };
  }, [currentCoproId]);

  const currentCopro = useMemo(
    () => copros.find((c) => c.id === currentCoproId) ?? null,
    [copros, currentCoproId]
  );

  const currentRole = useMemo(
    () => (currentCoproId ? roleMap[currentCoproId] ?? null : null),
    [roleMap, currentCoproId]
  );

  useEffect(() => {
    if (!currentCoproId) {
      setAnnouncements([]);
      return;
    }

    const unsub = onSnapshot(
      query(
        collection(db, "copros", currentCoproId, "announcements"),
        orderBy("createdAt", "desc")
      ),
      (snap) => {
        const mapped = snap.docs.map((d) => {
          const data = d.data();
          const createdAt =
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate().toISOString()
              : data.createdAt ?? new Date().toISOString();

          return {
            id: d.id,
            coProId: currentCoproId,
            title: data.title ?? "",
            message: data.message ?? "",
            type: data.type ?? "info",
            createdAt,
            createdBy: data.createdBy ?? "",
            createdByName: data.createdByName ?? "",
            expiresAt: data.expiresAt ?? undefined,
          } as Announcement;
        });
        setAnnouncements(mapped);
      },
      () => setAnnouncements([])
    );

    return unsub;
  }, [currentCoproId]);

  useEffect(() => {
    const role = currentCoproId ? roleMap[currentCoproId] : null;
    if (!currentCoproId || !role) {
      setSignalements([]);
      return;
    }

    const AUTO_DELETE_DAYS = 30;

    const unsub = onSnapshot(
      query(
        collection(db, "copros", currentCoproId, "signalements"),
        orderBy("createdAt", "desc")
      ),
      (snap) => {
        const cutoff = Date.now() - AUTO_DELETE_DAYS * 24 * 60 * 60 * 1000;
        const toDelete: string[] = [];

        const mapped = snap.docs
          .map((d) => {
            const data = d.data();
            const createdAt =
              data.createdAt instanceof Timestamp
                ? data.createdAt.toDate().toISOString()
                : data.createdAt ?? new Date().toISOString();

            const isOld = new Date(createdAt).getTime() < cutoff;
            if (data.acknowledged && isOld) {
              toDelete.push(d.id);
              return null;
            }

            return {
              id: d.id,
              coProId: currentCoproId,
              message: data.message ?? "",
              uid: data.uid ?? "",
              displayName: data.displayName ?? "",
              senderName: data.senderName ?? data.displayName ?? "",
              apartmentNumber: data.apartmentNumber ?? "",
              photoUrl: data.photoUrl ?? (data.photos?.[0]) ?? undefined,
              photos: data.photos ?? (data.photoUrl ? [data.photoUrl] : undefined),
              createdAt,
              read: data.read ?? false,
              acknowledged: data.acknowledged ?? false,
              acknowledgedAt:
                data.acknowledgedAt instanceof Timestamp
                  ? data.acknowledgedAt.toDate().toISOString()
                  : data.acknowledgedAt ?? undefined,
            } as Signalement;
          })
          .filter((s): s is Signalement => s !== null);

        setSignalements(mapped);

        if (toDelete.length > 0 && role === "admin") {
          toDelete.forEach((id) =>
            deleteDoc(
              doc(db, "copros", currentCoproId, "signalements", id)
            ).catch(() => {})
          );
        }
      }
    );

    return unsub;
  }, [currentCoproId, roleMap]);

  const isSubscribed = useMemo(
    () => isSuperAdmin || userSubscription?.status === "active",
    [isSuperAdmin, userSubscription]
  );

  const switchCoPro = useCallback(async (id: string) => {
    setCurrentCoproId(id);
    await AsyncStorage.setItem(CURRENT_COPRO_KEY, id);
  }, []);

  const createCoPro = useCallback(
    async (
      name: string,
      street: string,
      postalCode: string,
      city: string,
      lat?: number,
      lng?: number
    ): Promise<CoPro> => {
      if (!user) throw new Error("Not authenticated");

      const code = generateCode();
      const fullAddress = [
        street.trim(),
        [postalCode.trim(), city.trim()].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ");

      const hasActiveCopro = copros.some((c) => c.status === "active");
      const autoActivate =
        isSuperAdmin || hasActiveCopro || userSubscription?.status === "active";

      const ownerCode = generateCode();

      const coProData: Record<string, any> = {
        name: name.trim(),
        address: fullAddress || null,
        street: street.trim() || null,
        postalCode: postalCode.trim() || null,
        city: city.trim() || null,
        adminId: user.uid,
        adminEmail: user.email,
        status: autoActivate ? "active" : "pending",
        inviteCode: code,
        ownerInviteCode: ownerCode,
        createdAt: new Date().toISOString(),
      };

      if (autoActivate) {
        coProData.activatedAt = new Date().toISOString();
      }

      if (lat !== undefined && lng !== undefined) {
        coProData.latitude = lat;
        coProData.longitude = lng;
        coProData.locationRadius = 300;
      }

      const coProRef = await addDoc(collection(db, "copros"), coProData);

      await setDoc(doc(db, "copros", coProRef.id, "members", user.uid), {
        uid: user.uid,
        email: user.email ?? "",
        displayName: user.displayName ?? user.email ?? "",
        firstName: null,
        lastName: null,
        phone: null,
        role: "admin",
        joinedAt: new Date().toISOString(),
        accountStatus: "active",
      });

      await setDoc(doc(db, "inviteCodes", code), {
        coProId: coProRef.id,
        coProName: name.trim(),
        role: "prestataire",
        createdAt: new Date().toISOString(),
      });

      await setDoc(doc(db, "inviteCodes", ownerCode), {
        coProId: coProRef.id,
        coProName: name.trim(),
        role: "propriétaire",
        createdAt: new Date().toISOString(),
      });

      try {
        await updateDoc(doc(db, "users", user.uid), {
          managedCoproIds: arrayUnion(coProRef.id),
        });
      } catch {
        await setDoc(
          doc(db, "users", user.uid),
          { managedCoproIds: [coProRef.id] },
          { merge: true }
        );
      }

      const newCoPro: CoPro = {
        id: coProRef.id,
        name: name.trim(),
        address: fullAddress || undefined,
        street: street.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        city: city.trim() || undefined,
        adminId: user.uid,
        adminEmail: user.email ?? "",
        status: autoActivate ? "active" : "pending",
        inviteCode: code,
        ownerInviteCode: ownerCode,
        createdAt: new Date().toISOString(),
        ...(lat !== undefined && lng !== undefined
          ? { latitude: lat, longitude: lng, locationRadius: 300 }
          : {}),
      };

      setCopros((prev) => [...prev, newCoPro]);
      setRoleMap((prev) => ({ ...prev, [coProRef.id]: "admin" }));
      setCurrentCoproId(coProRef.id);
      await AsyncStorage.setItem(CURRENT_COPRO_KEY, coProRef.id);

      return newCoPro;
    },
    [user, copros, isSuperAdmin, userSubscription]
  );

  const joinCoPro = useCallback(
    async (code: string): Promise<CoPro> => {
      if (!user) throw new Error("Not authenticated");

      const codeSnap = await getDoc(
        doc(db, "inviteCodes", code.toUpperCase().trim())
      );
      if (!codeSnap.exists()) throw new Error("Code invalide ou expiré.");

      const codeData = codeSnap.data() as {
        coProId: string;
        role?: MemberRole;
        category?: Category;
      };

      const { coProId } = codeData;
      let joinRole: MemberRole = codeData.role ?? "prestataire";
      const codeCategory = codeData.category ?? null;

      const memberRef = doc(db, "copros", coProId, "members", user.uid);
      const existingMember = await getDoc(memberRef).catch(() => null);

      if (!existingMember?.exists()) {
        const memberPayload: Record<string, any> = {
          uid: user.uid,
          email: user.email ?? "",
          displayName: user.displayName ?? user.email ?? "",
          firstName: null,
          lastName: null,
          phone: null,
          role: joinRole,
          joinedAt: new Date().toISOString(),
          accountStatus: "active",
        };

        if (codeCategory) memberPayload.categoryFilter = codeCategory;
        await setDoc(memberRef, memberPayload);
      } else {
        joinRole = existingMember.data().role as MemberRole;
      }

      const coProSnap = await getDoc(doc(db, "copros", coProId));
      if (!coProSnap.exists()) throw new Error("Copropriété introuvable.");

      const coProData = coProSnap.data() as Omit<CoPro, "id">;

      if (coProData.adminId === user.uid && joinRole !== "admin") {
        joinRole = "admin";
        await setDoc(memberRef, {
          uid: user.uid,
          email: user.email ?? "",
          displayName: user.displayName ?? user.email ?? "",
          firstName: null,
          lastName: null,
          phone: null,
          role: "admin",
          joinedAt: new Date().toISOString(),
          accountStatus: "active",
        });
      }

      if (coProData.status !== "active" && coProData.adminId !== user.uid) {
        throw new Error(
          "Cette copropriété n'est pas encore activée. Contactez votre syndic."
        );
      }

      try {
        await updateDoc(doc(db, "users", user.uid), {
          managedCoproIds: arrayUnion(coProId),
        });
      } catch {
        await setDoc(
          doc(db, "users", user.uid),
          { managedCoproIds: [coProId] },
          { merge: true }
        );
      }

      const copro = { id: coProId, ...coProData };
      setCopros((prev) =>
        prev.find((c) => c.id === coProId) ? prev : [...prev, copro]
      );
      setRoleMap((prev) => ({ ...prev, [coProId]: joinRole }));
      setCurrentCoproId(coProId);
      await AsyncStorage.setItem(CURRENT_COPRO_KEY, coProId);

      return copro;
    },
    [user]
  );

  const updateCoProStatus = useCallback(
    async (coProId: string, status: CoPro["status"]) => {
      await updateDoc(doc(db, "copros", coProId), { status });
    },
    []
  );

  const refreshCoPros = useCallback(async () => {
    await loadUserCopros();
  }, [user]);

  const refreshSubscription = useCallback(async () => {
    if (!user) return;
    await loadUserSubscription(user.uid);
  }, [user]);

  const generateInviteLink = useCallback(() => {
    if (!currentCopro) return "";
    return `Code d'invitation : ${currentCopro.inviteCode}`;
  }, [currentCopro]);

  const generateCategoryCode = useCallback(
    async (category: Category): Promise<string> => {
      if (!currentCopro || currentRole !== "admin")
        throw new Error("Non autorisé");

      const existing = currentCopro.categoryInviteCodes?.[category];
      if (existing) return existing;

      const newCode = generateCode();

      await setDoc(doc(db, "inviteCodes", newCode), {
        coProId: currentCopro.id,
        coProName: currentCopro.name,
        role: "prestataire",
        category,
        createdAt: new Date().toISOString(),
      });

      await updateDoc(doc(db, "copros", currentCopro.id), {
        [`categoryInviteCodes.${category}`]: newCode,
      });

      await refreshCoPros();
      return newCode;
    },
    [currentCopro, currentRole]
  );

  const invitePrestataire = useCallback(
    async (
      payload: InvitePrestatairePayload
    ): Promise<{ inviteCode: string; memberId: string }> => {
      if (!user || !currentCopro || currentRole !== "admin") {
        throw new Error("Non autorisé");
      }

      const firstName = payload.firstName.trim();
      const lastName = payload.lastName.trim();
      const email = payload.email.trim().toLowerCase();
      const phone = normalizePhone(payload.phone);
      const displayName = `${firstName} ${lastName}`.trim();
      const inviteCode = generateCode();

      const memberRef = doc(collection(db, "copros", currentCopro.id, "members"));

      await setDoc(memberRef, {
        uid: memberRef.id,
        email,
        invitationEmail: email,
        displayName,
        firstName,
        lastName,
        phone,
        role: "prestataire",
        categoryFilter: payload.categoryFilter,
        joinedAt: new Date().toISOString(),
        invitedBy: user.uid,
        invitedByName: user.displayName ?? user.email ?? "Syndic",
        accountStatus: "invited",
        inviteCode,
        createdAtServer: serverTimestamp(),
      });

      return {
        inviteCode,
        memberId: memberRef.id,
      };
    },
    [user, currentCopro, currentRole]
  );

  const categoryFilter: Category | null = useMemo(() => {
    if (!user) return null;
    const me = members.find((m) => m.uid === user.uid);
    return me?.categoryFilter ?? null;
  }, [members, user]);

  const removeMember = useCallback(
    async (uid: string) => {
      if (!currentCopro) return;

      const member = members.find((m) => m.uid === uid);
      if (!member || member.role !== "prestataire") {
        throw new Error("Seuls les prestataires peuvent être supprimés.");
      }

      await deleteDoc(doc(db, "copros", currentCopro.id, "members", uid));
    },
    [currentCopro, members]
  );

  const addSignalement = useCallback(
    async (
      message: string,
      senderName: string,
      apartmentNumber: string,
      photoUris?: string[]
    ) => {
      if (!user || !currentCopro) throw new Error("Non authentifié.");

      let photos: string[] = [];
      if (photoUris && photoUris.length > 0) {
        const { uploadPhotoPending } = await import("@/lib/storage");
        photos = await Promise.all(
          photoUris.map((uri) => uploadPhotoPending(currentCopro.id, uri))
        );
      }

      const docRef = await addDoc(
        collection(db, "copros", currentCopro.id, "signalements"),
        {
          message,
          uid: user.uid,
          displayName: user.displayName ?? user.email ?? "Propriétaire",
          senderName,
          apartmentNumber,
          ...(photos.length > 0 ? { photoUrl: photos[0], photos } : {}),
          createdAt: serverTimestamp(),
          read: false,
          acknowledged: false,
        }
      );

      const targetEmail = currentCopro.adminEmail || user.email;
      if (currentCopro.alertEmailEnabled && targetEmail) {
        try {
          await apiRequest("POST", "/api/notify-signalement", {
            signalementId: docRef.id,
            coProId: currentCopro.id,
            coProName: currentCopro.name,
            adminEmail: targetEmail,
            message,
            senderName,
            apartmentNumber,
          });
        } catch (e) {
          console.warn("Email notification failed:", e);
        }
      }
    },
    [user, currentCopro]
  );

  const markSignalementRead = useCallback(
    async (id: string) => {
      if (!currentCopro) return;
      await updateDoc(doc(db, "copros", currentCopro.id, "signalements", id), {
        read: true,
      });
    },
    [currentCopro]
  );

  const acknowledgeSignalement = useCallback(
    async (id: string) => {
      if (!currentCopro) return;
      await updateDoc(doc(db, "copros", currentCopro.id, "signalements", id), {
        acknowledged: true,
        acknowledgedAt: serverTimestamp(),
        read: true,
      });
    },
    [currentCopro]
  );

  const deleteSignalement = useCallback(
    async (id: string) => {
      if (!currentCopro) return;
      await deleteDoc(doc(db, "copros", currentCopro.id, "signalements", id));
    },
    [currentCopro]
  );

  const toggleAlertEmail = useCallback(async () => {
    if (!currentCopro) return;
    await updateDoc(doc(db, "copros", currentCopro.id), {
      alertEmailEnabled: !currentCopro.alertEmailEnabled,
    });
  }, [currentCopro]);

  const addAnnouncement = useCallback(
    async (
      title: string,
      message: string,
      type: AnnouncementType,
      expiresAt?: string
    ) => {
      if (!user || !currentCopro) throw new Error("Non authentifié.");

      await addDoc(collection(db, "copros", currentCopro.id, "announcements"), {
        title: title.trim(),
        message: message.trim(),
        type,
        createdBy: user.uid,
        createdByName: user.displayName ?? user.email ?? "Syndic",
        createdAt: serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
      });
    },
    [user, currentCopro]
  );

  const deleteAnnouncement = useCallback(
    async (id: string) => {
      if (!currentCopro) return;
      await deleteDoc(doc(db, "copros", currentCopro.id, "announcements", id));
    },
    [currentCopro]
  );

  const value = useMemo(
    () => ({
      copros,
      currentCopro,
      currentRole,
      categoryFilter,
      members,
      signalements,
      announcements,
      isLoading,
      loadError,
      userSubscription,
      isSubscribed,
      switchCoPro,
      createCoPro,
      joinCoPro,
      updateCoProStatus,
      refreshCoPros,
      refreshSubscription,
      generateInviteLink,
      generateCategoryCode,
      invitePrestataire,
      removeMember,
      addSignalement,
      markSignalementRead,
      acknowledgeSignalement,
      deleteSignalement,
      toggleAlertEmail,
      addAnnouncement,
      deleteAnnouncement,
    }),
    [
      copros,
      currentCopro,
      currentRole,
      categoryFilter,
      members,
      signalements,
      announcements,
      isLoading,
      loadError,
      userSubscription,
      isSubscribed,
      switchCoPro,
      createCoPro,
      joinCoPro,
      updateCoProStatus,
      refreshCoPros,
      refreshSubscription,
      generateInviteLink,
      generateCategoryCode,
      invitePrestataire,
      removeMember,
      addSignalement,
      markSignalementRead,
      acknowledgeSignalement,
      deleteSignalement,
      toggleAlertEmail,
      addAnnouncement,
      deleteAnnouncement,
    ]
  );

  return (
    <CoProContext.Provider value={value}>{children}</CoProContext.Provider>
  );
}

export function useCoPro() {
  const ctx = useContext(CoProContext);
  if (!ctx) throw new Error("useCoPro must be used within CoProProvider");
  return ctx;
}
