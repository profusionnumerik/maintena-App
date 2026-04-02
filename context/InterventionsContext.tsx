import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
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
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { Intervention } from "@/shared/types";

interface InterventionsContextValue {
  interventions: Intervention[];
  isLoading: boolean;
  addIntervention: (
    data: Omit<
      Intervention,
      "id" | "createdAt" | "coProId" | "createdBy" | "createdByName"
    >
  ) => Promise<string>;
  updateIntervention: (id: string, data: Partial<Intervention>) => Promise<void>;
  deleteIntervention: (id: string) => Promise<void>;
  deleteInterventionsByGroupId: (groupId: string) => Promise<void>;
  rateIntervention: (id: string, rating: number) => Promise<void>;
  getIntervention: (id: string) => Intervention | undefined;
  stats: {
    total: number;
    done: number;
    inProgress: number;
    planned: number;
    avgRating: number;
    ratedCount: number;
  };
}

const InterventionsContext = createContext<InterventionsContextValue | null>(null);

function toIntervention(id: string, data: any, coProId: string): Intervention {
  return {
    id,
    coProId,
    title: data.title ?? "",
    description: data.description ?? "",
    category: data.category ?? "nettoyage",
    status: data.status ?? "planifie",
    date:
      data.date instanceof Timestamp
        ? data.date.toDate().toISOString()
        : data.date ?? new Date().toISOString(),

    assignedToUid: data.assignedToUid ?? undefined,
    assignedToName: data.assignedToName ?? undefined,

    rating: data.rating ?? undefined,
    technician: data.technician ?? undefined,
    technicianPhone: data.technicianPhone ?? undefined,

    recurrenceGroupId: data.recurrenceGroupId ?? undefined,
    recurrenceIndex: data.recurrenceIndex ?? undefined,
    recurrenceTotal: data.recurrenceTotal ?? undefined,

    createdBy: data.createdBy ?? "",
    createdByName: data.createdByName ?? "",

    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : data.createdAt ?? new Date().toISOString(),

    photos: data.photos ?? [],
    completionPhotos: data.completionPhotos ?? [],
    completionComment: data.completionComment ?? undefined,
    cleaningChecklist: data.cleaningChecklist ?? {},
    locationVerified: data.locationVerified ?? undefined,
    locationDistance: data.locationDistance ?? undefined,
    entryType: data.entryType ?? undefined,

    interventionReport: data.interventionReport ?? undefined,
    interventionRemaining: data.interventionRemaining ?? undefined,
    interventionAccessCode: data.interventionAccessCode ?? undefined,
    providerMode: data.providerMode ?? undefined,
    invitedProvider: data.invitedProvider ?? undefined,
  };
}

export function InterventionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const { currentCopro, currentRole, categoryFilter } = useCoPro();
  const [allInterventions, setAllInterventions] = useState<Intervention[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentCopro || currentCopro.status !== "active") {
      setAllInterventions([]);
      setIsLoading(false);
      return;
    }

    const q = query(
      collection(db, "copros", currentCopro.id, "interventions"),
      orderBy("date", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setAllInterventions(
          snap.docs.map((d) => toIntervention(d.id, d.data(), currentCopro.id))
        );
        setIsLoading(false);
      },
      (err) => {
        console.error("Interventions error:", err);
        setIsLoading(false);
      }
    );

    return unsub;
  }, [currentCopro?.id, currentCopro?.status]);

  const interventions = useMemo(() => {
    if (currentRole === "prestataire" && user) {
      return allInterventions.filter((i) => {
        const matchesCategory = categoryFilter ? i.category === categoryFilter : true;
        const matchesAssignee = i.assignedToUid === user.uid;
        return matchesCategory && matchesAssignee;
      });
    }

    return allInterventions;
  }, [allInterventions, currentRole, categoryFilter, user]);

  const addIntervention = useCallback(
    async (
      data: Omit<
        Intervention,
        "id" | "createdAt" | "coProId" | "createdBy" | "createdByName"
      >
    ): Promise<string> => {
      if (!user || !currentCopro) throw new Error("Not ready");

      const payload: Record<string, any> = {
        title: data.title,
        description: data.description,
        category: data.category,
        status: data.status,
        date: new Date(data.date),
        createdBy: user.uid,
        createdByName: user.displayName ?? user.email ?? "Inconnu",
        createdAt: serverTimestamp(),
        photos: data.photos ?? [],
        completionPhotos: data.completionPhotos ?? [],
      };

      if (data.assignedToUid) payload.assignedToUid = data.assignedToUid;
      if (data.assignedToName) payload.assignedToName = data.assignedToName;
      if (data.technician) payload.technician = data.technician;
      if (data.technicianPhone) payload.technicianPhone = data.technicianPhone;
      if (data.rating !== undefined) payload.rating = data.rating;
      if (data.entryType) payload.entryType = data.entryType;
      if (data.locationVerified !== undefined) payload.locationVerified = data.locationVerified;
      if (data.locationDistance !== undefined) payload.locationDistance = data.locationDistance;
      if (data.recurrenceGroupId) payload.recurrenceGroupId = data.recurrenceGroupId;
      if (data.recurrenceIndex !== undefined) payload.recurrenceIndex = data.recurrenceIndex;
      if (data.recurrenceTotal !== undefined) payload.recurrenceTotal = data.recurrenceTotal;
      if (data.cleaningChecklist !== undefined) payload.cleaningChecklist = data.cleaningChecklist;
      if (data.completionComment !== undefined) payload.completionComment = data.completionComment;

      if (data.interventionReport !== undefined) {
        payload.interventionReport = data.interventionReport;
      }

      if (data.interventionRemaining !== undefined) {
        payload.interventionRemaining = data.interventionRemaining;
      }

      if (data.interventionAccessCode !== undefined) {
        payload.interventionAccessCode = data.interventionAccessCode;
      }

      if (data.providerMode !== undefined) {
        payload.providerMode = data.providerMode;
      }

      if (data.invitedProvider !== undefined) {
        payload.invitedProvider = data.invitedProvider;
      }

      const ref = await addDoc(
        collection(db, "copros", currentCopro.id, "interventions"),
        payload
      );

      return ref.id;
    },
    [user, currentCopro]
  );

  const updateIntervention = useCallback(
    async (id: string, data: Partial<Intervention>) => {
      if (!currentCopro) return;

      const docRef = doc(db, "copros", currentCopro.id, "interventions", id);
      const payload: Record<string, any> = {};

      if (data.title !== undefined) payload.title = data.title;
      if (data.description !== undefined) payload.description = data.description;
      if (data.category !== undefined) payload.category = data.category;
      if (data.status !== undefined) payload.status = data.status;
      if (data.date !== undefined) payload.date = new Date(data.date);

      if (data.assignedToUid !== undefined) payload.assignedToUid = data.assignedToUid;
      if (data.assignedToName !== undefined) payload.assignedToName = data.assignedToName;

      if (data.rating !== undefined) payload.rating = data.rating;
      if (data.technician !== undefined) payload.technician = data.technician;
      if (data.technicianPhone !== undefined) payload.technicianPhone = data.technicianPhone;
      if (data.photos !== undefined) payload.photos = data.photos;
      if (data.completionPhotos !== undefined) payload.completionPhotos = data.completionPhotos;
      if (data.completionComment !== undefined) payload.completionComment = data.completionComment;
      if (data.cleaningChecklist !== undefined) payload.cleaningChecklist = data.cleaningChecklist;
      if (data.locationVerified !== undefined) payload.locationVerified = data.locationVerified;
      if (data.locationDistance !== undefined) payload.locationDistance = data.locationDistance;
      if (data.entryType !== undefined) payload.entryType = data.entryType;

      if (data.recurrenceGroupId !== undefined) {
        payload.recurrenceGroupId = data.recurrenceGroupId;
      }
      if (data.recurrenceIndex !== undefined) {
        payload.recurrenceIndex = data.recurrenceIndex;
      }
      if (data.recurrenceTotal !== undefined) {
        payload.recurrenceTotal = data.recurrenceTotal;
      }

      if (data.interventionReport !== undefined) {
        payload.interventionReport = data.interventionReport;
      }

      if (data.interventionRemaining !== undefined) {
        payload.interventionRemaining = data.interventionRemaining;
      }

      if (data.interventionAccessCode !== undefined) {
        payload.interventionAccessCode = data.interventionAccessCode;
      }

      if (data.providerMode !== undefined) {
        payload.providerMode = data.providerMode;
      }

      if (data.invitedProvider !== undefined) {
        payload.invitedProvider = data.invitedProvider;
      }

      await updateDoc(docRef, payload);
    },
    [currentCopro]
  );

  const deleteIntervention = useCallback(
    async (id: string) => {
      if (!currentCopro) throw new Error("Aucune copropriété sélectionnée.");
      await deleteDoc(doc(db, "copros", currentCopro.id, "interventions", id));
    },
    [currentCopro]
  );

  const deleteInterventionsByGroupId = useCallback(
    async (groupId: string) => {
      if (!currentCopro) throw new Error("Aucune copropriété sélectionnée.");

      const toDelete = interventions.filter((i) => i.recurrenceGroupId === groupId);

      await Promise.all(
        toDelete.map((i) =>
          deleteDoc(doc(db, "copros", currentCopro.id, "interventions", i.id))
        )
      );
    },
    [currentCopro, interventions]
  );

  const rateIntervention = useCallback(
    async (id: string, rating: number) => {
      await updateIntervention(id, { rating });
    },
    [updateIntervention]
  );

  const getIntervention = useCallback(
    (id: string) => interventions.find((i) => i.id === id),
    [interventions]
  );

  const stats = useMemo(() => {
    const done = interventions.filter((i) => i.status === "termine").length;
    const inProgress = interventions.filter((i) => i.status === "en_cours").length;
    const planned = interventions.filter((i) => i.status === "planifie").length;
    const rated = interventions.filter((i) => i.rating != null);
    const avgRating =
      rated.length > 0
        ? rated.reduce((s, i) => s + (i.rating ?? 0), 0) / rated.length
        : 0;

    return {
      total: interventions.length,
      done,
      inProgress,
      planned,
      avgRating,
      ratedCount: rated.length,
    };
  }, [interventions]);

  const value = useMemo(
    () => ({
      interventions,
      isLoading,
      addIntervention,
      updateIntervention,
      deleteIntervention,
      deleteInterventionsByGroupId,
      rateIntervention,
      getIntervention,
      stats,
    }),
    [
      interventions,
      isLoading,
      addIntervention,
      updateIntervention,
      deleteIntervention,
      deleteInterventionsByGroupId,
      rateIntervention,
      getIntervention,
      stats,
    ]
  );

  return (
    <InterventionsContext.Provider value={value}>
      {children}
    </InterventionsContext.Provider>
  );
}

export function useInterventions() {
  const ctx = useContext(InterventionsContext);
  if (!ctx) {
    throw new Error("useInterventions must be used within InterventionsProvider");
  }
  return ctx;
}