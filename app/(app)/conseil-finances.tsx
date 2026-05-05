import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { wa, wConfirm } from "@/shared/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot,
  orderBy, query, setDoc, updateDoc, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { useInterventions } from "@/context/InterventionsContext";
import {
  ALL_EXPENSE_CATEGORIES, AnnualBudget, BudgetCustomLine,
  BuildingDef, CATEGORY_LABELS, ConseilVote, Expense, ExpenseCategory,
  EXPENSE_CATEGORY_COLORS, EXPENSE_CATEGORY_ICONS, EXPENSE_CATEGORY_LABELS, Intervention,
  RevoteRequest,
} from "@/shared/types";

const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);
const MONTHS_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
const COMMUN = "commun";

function genId() { return Math.random().toString(36).slice(2, 9); }
function safeHaptic() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
function formatAmount(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
function todayStr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function isoToDisplay(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function displayToIso(display: string) {
  const parts = display.split("/");
  if (parts.length !== 3) return "";
  return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
}
function formatDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

const COMMON_SUGGESTIONS = [
  "Honoraires syndic", "Assurance immeuble", "Portail / Accès parking",
  "Nettoyage parties communes", "Espaces verts", "Eau froide",
  "Électricité parties communes", "ECS (eau chaude sanitaire)",
  "Chauffage collectif", "Gaz", "Désinfection nuisibles",
  "Toiture / Étanchéité", "Façade", "Interphone / Digicode",
  "VMC", "Travaux imprévus", "Autre…",
];
const BUILDING_SUGGESTIONS = [
  "Ascenseur — maintenance", "ECS (eau chaude sanitaire)",
  "Nettoyage cage / paliers", "Électricité bâtiment",
  "Chauffage bâtiment", "VMC bâtiment", "Autre…",
];

type Tab = "depenses" | "budget" | "synthese";

interface ExpenseForm {
  label: string; amount: string; category: ExpenseCategory;
  date: string; description: string; buildingId: string;
}
const EMPTY_FORM: ExpenseForm = {
  label: "", amount: "", category: "divers",
  date: new Date().toISOString().slice(0, 10), description: "", buildingId: COMMUN,
};

interface BudgetFormLine {
  id: string; label: string; amount: string; buildingId: string;
}

export default function ConseilFinancesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { currentCopro, currentRole, members } = useCoPro();
  const { interventions: allInterventions } = useInterventions();

  const [tab, setTab] = useState<Tab>("depenses");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null); // null = tous

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budget, setBudget] = useState<AnnualBudget | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal dépense
  const [expenseModal, setExpenseModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseForm>({ ...EMPTY_FORM });
  const [dateDisplay, setDateDisplay] = useState(todayStr());
  const [saving, setSaving] = useState(false);

  // Modal intervention
  const [interventionPickerModal, setInterventionPickerModal] = useState(false);
  const [interventionSearch, setInterventionSearch] = useState("");

  // Modal budget
  const [budgetModal, setBudgetModal] = useState(false);
  const [budgetLines, setBudgetLines] = useState<BudgetFormLine[]>([]);
  const [savingBudget, setSavingBudget] = useState(false);

  // Vote trésorier — état live (subscription Firestore)
  const [liveVote, setLiveVote] = useState<ConseilVote | null | undefined>(undefined);
  const [liveTresorierUid, setLiveTresorierUid] = useState<string | null | undefined>(undefined);
  const [liveRevoteRequest, setLiveRevoteRequest] = useState<RevoteRequest | null | undefined>(undefined);
  const [voteSaving, setVoteSaving] = useState(false);

  const isAdmin = currentRole === "admin";
  const isConseil = currentRole === "conseil";
  const conseilMembers = members.filter((m) => m.role === "conseil");
  const tresorierUid = liveTresorierUid !== undefined ? liveTresorierUid : (currentCopro?.tresorierUid ?? null);
  const conseilVote = liveVote !== undefined ? liveVote : (currentCopro?.conseilVote ?? null);
  const revoteRequest = liveRevoteRequest !== undefined ? liveRevoteRequest : (currentCopro?.revoteRequest ?? null);
  const isTresorier = isConseil && user?.uid === tresorierUid;
  // Seul le trésorier désigné peut écrire ; le syndic (admin) est en lecture seule
  const canWrite = isTresorier;

  // Bâtiments de la résidence — fallback si config absente
  const buildings: BuildingDef[] = useMemo(() => {
    const b = currentCopro?.buildingConfig?.buildings ?? [];
    return b.length > 0 ? b : [{ name: "Bâtiment", floors: 3 }];
  }, [currentCopro]);
  const isMulti = buildings.length > 1;
  const hasBuildings = buildings.length >= 1; // afficher les sections même pour 1 seul bâtiment

  // Sections budget (commun + bâtiments)
  const budgetSections = useMemo(() => {
    const bIds = [COMMUN, ...buildings.map((b) => b.name)];
    return bIds;
  }, [buildings]);

  useEffect(() => {
    if (!currentCopro?.id) return;
    const q = query(
      collection(db, "copros", currentCopro.id, "expenses"),
      where("date", ">=", `${selectedYear}-01-01`),
      where("date", "<=", `${selectedYear}-12-31`),
      orderBy("date", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Expense)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [currentCopro?.id, selectedYear]);

  useEffect(() => {
    if (!currentCopro?.id) return;
    const q = query(collection(db, "copros", currentCopro.id, "budgets"), where("year", "==", selectedYear));
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) setBudget({ id: snap.docs[0].id, ...snap.docs[0].data() } as AnnualBudget);
      else setBudget(null);
    });
    return unsub;
  }, [currentCopro?.id, selectedYear]);

  // Subscription live sur le document copro pour mise à jour du vote en temps réel
  useEffect(() => {
    if (!currentCopro?.id) return;
    const unsub = onSnapshot(doc(db, "copros", currentCopro.id), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLiveTresorierUid(data.tresorierUid ?? null);
        setLiveVote((data.conseilVote ?? null) as ConseilVote | null);
        setLiveRevoteRequest((data.revoteRequest ?? null) as RevoteRequest | null);
      }
    });
    return unsub;
  }, [currentCopro?.id]);

  // Expiration automatique de la demande de re-vote après 7 jours sans majorité
  useEffect(() => {
    if (!revoteRequest || !currentCopro?.id) return;
    const expiresAt = new Date(revoteRequest.requestedAt);
    expiresAt.setDate(expiresAt.getDate() + 7);
    if (new Date() > expiresAt) {
      updateDoc(doc(db, "copros", currentCopro.id), { revoteRequest: null }).catch(() => {});
    }
  }, [revoteRequest, currentCopro?.id]);

  // Dépenses filtrées par bâtiment puis par mois
  const filteredExpenses = useMemo(() => {
    let list = expenses;
    if (selectedBuilding !== null) {
      list = list.filter((e) => (e.buildingId ?? COMMUN) === selectedBuilding);
    }
    if (selectedMonth !== null) {
      const monthStr = String(selectedMonth + 1).padStart(2, "0");
      list = list.filter((e) => e.date.startsWith(`${selectedYear}-${monthStr}`));
    }
    return list;
  }, [expenses, selectedBuilding, selectedMonth, selectedYear]);

  const grandTotal = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);

  // Totaux par bâtiment (dépenses)
  const expTotalByBuilding = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach((e) => {
      const k = e.buildingId ?? COMMUN;
      map[k] = (map[k] ?? 0) + e.amount;
    });
    return map;
  }, [expenses]);

  // Totaux budget par bâtiment
  const budTotalByBuilding = useMemo(() => {
    const map: Record<string, number> = {};
    if (budget?.customLines) {
      budget.customLines.forEach((l) => {
        const k = l.buildingId ?? COMMUN;
        map[k] = (map[k] ?? 0) + l.amount;
      });
    } else if (budget?.lines) {
      // legacy: tout en commun
      const total = Object.values(budget.lines).reduce((s, v) => s + (v ?? 0), 0);
      map[COMMUN] = total;
    }
    return map;
  }, [budget]);

  const totalBudget = useMemo(() => Object.values(budTotalByBuilding).reduce((s, v) => s + v, 0), [budTotalByBuilding]);

  const hasBudget = useMemo(() => totalBudget > 0, [totalBudget]);

  const groupedByMonth = useMemo(() => {
    const map: Record<string, Expense[]> = {};
    filteredExpenses.forEach((e) => {
      const key = e.date.slice(0, 7);
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredExpenses]);

  const linkedInterventionIds = useMemo(
    () => new Set(expenses.map((e) => e.interventionId).filter(Boolean)),
    [expenses]
  );
  const eligibleInterventions = useMemo(() => allInterventions.filter(
    (i) => i.status === "termine" && (i as any).amount !== undefined && !linkedInterventionIds.has(i.id)
  ), [allInterventions, linkedInterventionIds]);
  const filteredEligible = useMemo(() => {
    if (!interventionSearch.trim()) return eligibleInterventions;
    const q = interventionSearch.toLowerCase();
    return eligibleInterventions.filter(
      (i) => i.title.toLowerCase().includes(q) || (i.assignedToName ?? "").toLowerCase().includes(q)
    );
  }, [eligibleInterventions, interventionSearch]);

  const handlePickIntervention = (intervention: Intervention) => {
    const amount = (intervention as any).amount as number;
    const isoDate = intervention.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const cat: ExpenseCategory = (intervention.category as any) in EXPENSE_CATEGORY_LABELS
      ? (intervention.category as ExpenseCategory) : "travaux";
    setInterventionPickerModal(false);
    setInterventionSearch("");
    setEditingExpense(null);
    setForm({
      label: intervention.title, amount: String(amount), category: cat, date: isoDate,
      description: `Intervention du ${isoToDisplay(isoDate)}${intervention.assignedToName ? ` — ${intervention.assignedToName}` : ""}`,
      buildingId: COMMUN,
    });
    setDateDisplay(isoToDisplay(isoDate));
    setEditingExpense({ interventionId: intervention.id } as any);
    setExpenseModal(true);
  };

  const openAddExpense = () => {
    setEditingExpense(null);
    setForm({ ...EMPTY_FORM, buildingId: selectedBuilding ?? COMMUN });
    setDateDisplay(todayStr());
    setExpenseModal(true);
  };

  const openEditExpense = (e: Expense) => {
    setEditingExpense(e);
    setForm({
      label: e.label, amount: String(e.amount), category: e.category,
      date: e.date, description: e.description ?? "", buildingId: e.buildingId ?? COMMUN,
    });
    setDateDisplay(isoToDisplay(e.date));
    setExpenseModal(true);
  };

  const handleSaveExpense = useCallback(async () => {
    if (!currentCopro?.id || !user) return;
    const amount = parseFloat(form.amount.replace(",", "."));
    if (!form.label.trim()) { wa("Erreur", "Libellé requis."); return; }
    if (isNaN(amount) || amount <= 0) { wa("Erreur", "Montant invalide."); return; }
    const isoDate = displayToIso(dateDisplay) || form.date;
    if (!isoDate.match(/^\d{4}-\d{2}-\d{2}$/)) { wa("Erreur", "Date invalide (JJ/MM/AAAA)."); return; }
    setSaving(true);
    try {
      const linkedInterventionId = (editingExpense as any)?.interventionId as string | undefined;
      const data: Record<string, any> = {
        coProId: currentCopro.id, label: form.label.trim(), amount, category: form.category,
        date: isoDate, description: form.description.trim(), buildingId: form.buildingId,
        addedBy: user.uid, addedByName: user.displayName || user.email || "Inconnu",
        updatedAt: new Date().toISOString(),
      };
      if (linkedInterventionId) data.interventionId = linkedInterventionId;
      if (editingExpense?.id) {
        await setDoc(doc(db, "copros", currentCopro.id, "expenses", editingExpense.id), { ...data, createdAt: editingExpense.createdAt }, { merge: false });
      } else {
        await addDoc(collection(db, "copros", currentCopro.id, "expenses"), { ...data, createdAt: new Date().toISOString() });
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setExpenseModal(false);
    } catch { wa("Erreur", "Impossible d'enregistrer la dépense."); }
    finally { setSaving(false); }
  }, [form, dateDisplay, editingExpense, currentCopro?.id, user]);

  const handleDeleteExpense = (e: Expense) => {
    wConfirm(
      "Supprimer cette dépense ?",
      `${e.label} — ${formatAmount(e.amount)}`,
      async () => {
        try { await deleteDoc(doc(db, "copros", currentCopro!.id, "expenses", e.id)); }
        catch { wa("Erreur", "Impossible de supprimer."); }
      },
      "Supprimer",
    );
  };

  const openBudgetModal = () => {
    let lines: BudgetFormLine[] = [];
    if (budget?.customLines && budget.customLines.length > 0) {
      lines = budget.customLines.map((l) => ({
        id: l.id, label: l.label, amount: String(l.amount), buildingId: l.buildingId ?? COMMUN,
      }));
    } else if (budget?.lines) {
      lines = ALL_EXPENSE_CATEGORIES
        .filter((c) => (budget.lines[c] ?? 0) > 0)
        .map((c) => ({ id: c, label: EXPENSE_CATEGORY_LABELS[c], amount: String(budget.lines[c]), buildingId: COMMUN }));
    }
    if (lines.length === 0) {
      lines = [{ id: genId(), label: "", amount: "", buildingId: COMMUN }];
    }
    setBudgetLines(lines);
    setBudgetModal(true);
  };

  const addBudgetLine = (buildingId: string, label = "") => {
    setBudgetLines((prev) => [...prev, { id: genId(), label, amount: "", buildingId }]);
  };

  const handleSaveBudget = useCallback(async () => {
    if (!currentCopro?.id || !user) return;
    setSavingBudget(true);
    try {
      const validLines: BudgetCustomLine[] = budgetLines
        .filter((l) => l.label.trim())
        .map((l) => {
          const v = parseFloat(l.amount.replace(",", "."));
          return { id: l.id, label: l.label.trim(), amount: isNaN(v) || v < 0 ? 0 : v, buildingId: l.buildingId };
        });
      const docId = budget?.id ?? `${currentCopro.id}_${selectedYear}`;
      await setDoc(doc(db, "copros", currentCopro.id, "budgets", docId), {
        coProId: currentCopro.id, year: selectedYear, lines: {}, customLines: validLines,
        createdBy: user.uid, createdAt: budget?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBudgetModal(false);
    } catch { wa("Erreur", "Impossible d'enregistrer le budget."); }
    finally { setSavingBudget(false); }
  }, [budgetLines, budget, currentCopro?.id, selectedYear, user]);

  // ── Fonctions de vote trésorier ──────────────────────────────────────────

  const handleStartVote = async () => {
    if (!currentCopro?.id || !user) return;
    setVoteSaving(true);
    try {
      const newVote: ConseilVote = {
        status: "open", candidates: [], votes: {},
        requestedBy: user.uid, requestedAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, "copros", currentCopro.id), { conseilVote: newVote, tresorierUid: null });
    } finally { setVoteSaving(false); }
  };

  const handleNominateSelf = async () => {
    if (!currentCopro?.id || !user || !conseilVote || conseilVote.status !== "open") return;
    if (conseilVote.candidates.some((c) => c.uid === user.uid)) return;
    setVoteSaving(true);
    try {
      const newCandidates = [
        ...conseilVote.candidates,
        { uid: user.uid, displayName: user.displayName ?? user.email ?? "Inconnu" },
      ];
      await updateDoc(doc(db, "copros", currentCopro.id), { "conseilVote.candidates": newCandidates });
    } finally { setVoteSaving(false); }
  };

  const handleCastVote = async (candidateUid: string) => {
    if (!currentCopro?.id || !user || !conseilVote || conseilVote.status !== "open") return;
    if (conseilVote.votes[user.uid]) return;
    setVoteSaving(true);
    try {
      const newVotes: Record<string, string> = { ...conseilVote.votes, [user.uid]: candidateUid };
      const allVoted = conseilMembers.length > 0 && conseilMembers.every((m) => newVotes[m.uid] !== undefined);
      if (allVoted) {
        const tally: Record<string, number> = {};
        Object.values(newVotes).forEach((uid) => { tally[uid] = (tally[uid] ?? 0) + 1; });
        const winnerId = Object.entries(tally).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
        await updateDoc(doc(db, "copros", currentCopro.id), {
          "conseilVote.votes": newVotes,
          "conseilVote.status": "closed",
          "conseilVote.closedAt": new Date().toISOString(),
          "conseilVote.winnerId": winnerId,
          tresorierUid: winnerId,
        });
      } else {
        await updateDoc(doc(db, "copros", currentCopro.id), { "conseilVote.votes": newVotes });
      }
    } finally { setVoteSaving(false); }
  };

  const handleDirectDesignate = async () => {
    if (!currentCopro?.id || !conseilVote || conseilVote.candidates.length !== 1) return;
    const winnerId = conseilVote.candidates[0].uid;
    setVoteSaving(true);
    try {
      await updateDoc(doc(db, "copros", currentCopro.id), {
        tresorierUid: winnerId,
        "conseilVote.status": "closed",
        "conseilVote.closedAt": new Date().toISOString(),
        "conseilVote.winnerId": winnerId,
      });
    } finally { setVoteSaving(false); }
  };

  const handleSubmitRevoteRequest = async () => {
    if (!currentCopro?.id || !user || revoteRequest) return;
    setVoteSaving(true);
    try {
      const req: RevoteRequest = {
        requestedBy: user.uid,
        requestedAt: new Date().toISOString(),
        approvals: { [user.uid]: true }, // le demandeur vote automatiquement oui
      };
      // Si le conseil n'a qu'un seul membre, déclencher le re-vote directement
      if (conseilMembers.length <= 1) {
        const newVote: ConseilVote = {
          status: "open", candidates: [], votes: {},
          requestedBy: user.uid, requestedAt: new Date().toISOString(),
        };
        await updateDoc(doc(db, "copros", currentCopro.id), {
          conseilVote: newVote, tresorierUid: null, revoteRequest: null,
        });
      } else {
        await updateDoc(doc(db, "copros", currentCopro.id), { revoteRequest: req });
      }
    } finally { setVoteSaving(false); }
  };

  const handleVoteRevoteRequest = async (approve: boolean) => {
    if (!currentCopro?.id || !user || !revoteRequest) return;
    setVoteSaving(true);
    try {
      const newApprovals = { ...revoteRequest.approvals, [user.uid]: approve };
      const majority = Math.floor(conseilMembers.length / 2) + 1;
      const yesCount = Object.values(newApprovals).filter((v) => v === true).length;
      const noCount = Object.values(newApprovals).filter((v) => v === false).length;

      if (yesCount >= majority) {
        // Majorité pour → re-vote déclenché
        const newVote: ConseilVote = {
          status: "open", candidates: [], votes: {},
          requestedBy: revoteRequest.requestedBy, requestedAt: new Date().toISOString(),
        };
        await updateDoc(doc(db, "copros", currentCopro.id), {
          conseilVote: newVote, tresorierUid: null, revoteRequest: null,
        });
      } else if (noCount >= majority) {
        // Majorité contre → demande rejetée
        await updateDoc(doc(db, "copros", currentCopro.id), { revoteRequest: null });
      } else {
        // Pas encore de majorité → on enregistre le vote
        await updateDoc(doc(db, "copros", currentCopro.id), {
          "revoteRequest.approvals": newApprovals,
        });
      }
    } finally { setVoteSaving(false); }
  };

  if (!currentCopro) {
    return <View style={styles.root}><Text style={{ color: COLORS.textMuted, textAlign: "center", marginTop: 60 }}>Aucune résidence sélectionnée.</Text></View>;
  }

  const sectionLabel = (bid: string) => bid === COMMUN ? "Charges communes" : bid;
  const buildingChips = [{ id: null, label: "Tout" }, { id: COMMUN, label: "Commun" }, ...buildings.map((b) => ({ id: b.name, label: b.name }))];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Contrôle des comptes</Text>
          <Text style={styles.headerSub}>{currentCopro.name}</Text>
        </View>
        {canWrite && tab === "depenses" && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            {eligibleInterventions.length > 0 && (
              <Pressable style={[styles.addBtn, { backgroundColor: "#0891B2" }]} onPress={() => { safeHaptic(); setInterventionPickerModal(true); }}>
                <Ionicons name="link-outline" size={20} color="#fff" />
              </Pressable>
            )}
            <Pressable style={styles.addBtn} onPress={() => { safeHaptic(); openAddExpense(); }}>
              <Ionicons name="add" size={22} color="#fff" />
            </Pressable>
          </View>
        )}
      </View>

      {/* Sélecteur d'année */}
      <View style={styles.yearRow}>
        {YEARS.map((y) => (
          <Pressable key={y} style={[styles.yearChip, selectedYear === y && styles.yearChipActive]}
            onPress={() => { safeHaptic(); setSelectedYear(y); setSelectedMonth(null); }}>
            <Text style={[styles.yearChipText, selectedYear === y && styles.yearChipTextActive]}>{y}</Text>
          </Pressable>
        ))}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(["depenses", "budget", "synthese"] as Tab[]).map((t) => {
          const labels = { depenses: "Dépenses réelles", budget: "Budget AG", synthese: "Comparatif" };
          return (
            <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{labels[t]}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} /> : (
        <ScrollView contentContainerStyle={styles.content}>

          {/* ── Bannière lecture seule (syndic) ── */}
          {isAdmin && (
            <View style={styles.readOnlyBanner}>
              <Ionicons name="eye-outline" size={16} color="#0369A1" />
              <Text style={styles.readOnlyText}>Mode lecture seule — Le conseil syndical gère la saisie des comptes.</Text>
            </View>
          )}

          {/* ── Section vote trésorier (conseil uniquement) ── */}
          {isConseil && (
            <View style={styles.voteCard}>
              {/* Cas A : pas de vote, pas de trésorier */}
              {!conseilVote && !tresorierUid && (
                <>
                  <View style={styles.voteCardHeader}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#7C3AED" />
                    <Text style={styles.voteCardTitle}>Aucun trésorier désigné</Text>
                  </View>
                  <Text style={styles.voteCardSub}>Lancez un vote pour désigner le membre du conseil syndical qui pourra saisir les données comptables.</Text>
                  <Pressable style={[styles.voteBtn, { backgroundColor: "#7C3AED" }]} onPress={handleStartVote} disabled={voteSaving}>
                    {voteSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.voteBtnText}>Lancer un vote</Text>}
                  </Pressable>
                </>
              )}

              {/* Cas B : vote ouvert */}
              {conseilVote?.status === "open" && (
                <>
                  <View style={styles.voteCardHeader}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#7C3AED" />
                    <Text style={styles.voteCardTitle}>Vote en cours — Élection du trésorier</Text>
                  </View>
                  <Text style={styles.voteCardSub}>
                    {Object.keys(conseilVote.votes).length}/{conseilMembers.length} membre{conseilMembers.length > 1 ? "s" : ""} {Object.keys(conseilVote.votes).length > 1 ? "ont" : "a"} voté
                  </Text>

                  {/* Candidats */}
                  {conseilVote.candidates.length === 0 ? (
                    <Text style={[styles.voteCardSub, { marginTop: 4, fontStyle: "italic" }]}>Aucun candidat pour l'instant. Présentez-vous !</Text>
                  ) : (
                    conseilVote.candidates.map((c) => {
                      const myVote = conseilVote.votes[user?.uid ?? ""];
                      const alreadyVoted = !!myVote;
                      const iVotedFor = myVote === c.uid;
                      const voteCount = Object.values(conseilVote.votes).filter((v) => v === c.uid).length;
                      return (
                        <View key={c.uid} style={styles.candidateRow}>
                          <Ionicons name="person-circle-outline" size={22} color="#7C3AED" />
                          <Text style={styles.candidateName}>{c.displayName}</Text>
                          {voteCount > 0 && (
                            <View style={styles.voteBadge}>
                              <Text style={styles.voteBadgeText}>{voteCount} voix</Text>
                            </View>
                          )}
                          {!alreadyVoted && c.uid !== user?.uid && (
                            <Pressable style={styles.castVoteBtn} onPress={() => handleCastVote(c.uid)} disabled={voteSaving}>
                              <Text style={styles.castVoteBtnText}>Voter</Text>
                            </Pressable>
                          )}
                          {iVotedFor && (
                            <View style={[styles.castVoteBtn, { backgroundColor: "#D1FAE5" }]}>
                              <Ionicons name="checkmark" size={14} color="#065F46" />
                              <Text style={[styles.castVoteBtnText, { color: "#065F46" }]}>Mon vote</Text>
                            </View>
                          )}
                        </View>
                      );
                    })
                  )}

                  {/* Boutons candidature / désignation directe */}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {!conseilVote.candidates.some((c) => c.uid === user?.uid) && (
                      <Pressable style={[styles.voteBtn, { flex: 1, backgroundColor: "#7C3AED" }]} onPress={handleNominateSelf} disabled={voteSaving}>
                        <Text style={styles.voteBtnText}>Me présenter</Text>
                      </Pressable>
                    )}
                    {conseilVote.candidates.length === 1 && (
                      <Pressable style={[styles.voteBtn, { flex: 1, backgroundColor: "#059669" }]} onPress={handleDirectDesignate} disabled={voteSaving}>
                        <Text style={styles.voteBtnText}>Désigner directement</Text>
                      </Pressable>
                    )}
                  </View>
                </>
              )}

              {/* Cas C : trésorier désigné */}
              {tresorierUid && conseilVote?.status !== "open" && (
                <>
                  {isTresorier ? (
                    <>
                      <View style={styles.voteCardHeader}>
                        <Ionicons name="shield-checkmark-outline" size={18} color="#059669" />
                        <Text style={[styles.voteCardTitle, { color: "#059669" }]}>Vous êtes le trésorier désigné</Text>
                      </View>
                      <Text style={styles.voteCardSub}>Vous avez accès en écriture aux comptes de la copropriété.</Text>
                      {revoteRequest && (
                        <View style={[styles.revoteAlert]}>
                          <Ionicons name="warning-outline" size={14} color="#92400E" />
                          <Text style={styles.revoteAlertText}>
                            {members.find(m => m.uid === revoteRequest.requestedBy)?.displayName ?? "Un membre"} demande un re-vote.
                            {" "}{Object.values(revoteRequest.approvals).filter(v => v).length}/{conseilMembers.length} oui requis.
                          </Text>
                        </View>
                      )}
                    </>
                  ) : (
                    <>
                      <View style={styles.voteCardHeader}>
                        <Ionicons name="person-outline" size={18} color="#7C3AED" />
                        <Text style={styles.voteCardTitle}>
                          Trésorier : {members.find((m) => m.uid === tresorierUid)?.displayName ?? "Membre désigné"}
                        </Text>
                      </View>
                      <Text style={styles.voteCardSub}>Ce membre gère la saisie des données comptables. Vous êtes en lecture seule.</Text>

                      {/* Demande de re-vote en cours */}
                      {revoteRequest ? (
                        (() => {
                          const majority = Math.floor(conseilMembers.length / 2) + 1;
                          const yesCount = Object.values(revoteRequest.approvals).filter(v => v === true).length;
                          const myVote = revoteRequest.approvals[user?.uid ?? ""];
                          const iRequested = revoteRequest.requestedBy === user?.uid;
                          const expiresAt = new Date(revoteRequest.requestedAt);
                          expiresAt.setDate(expiresAt.getDate() + 7);
                          const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400000));
                          const requesterName = members.find(m => m.uid === revoteRequest.requestedBy)?.displayName ?? "Un membre";
                          return (
                            <View style={styles.revoteRequestCard}>
                              <View style={styles.voteCardHeader}>
                                <Ionicons name="refresh-circle-outline" size={16} color="#DC2626" />
                                <Text style={[styles.voteCardTitle, { color: "#DC2626" }]}>
                                  {iRequested ? "Votre demande de re-vote est en cours" : `${requesterName} demande un re-vote`}
                                </Text>
                              </View>
                              <Text style={styles.voteCardSub}>
                                {yesCount}/{conseilMembers.length} accord{yesCount > 1 ? "s" : ""} — majorité à {majority} — expire dans {daysLeft} jour{daysLeft > 1 ? "s" : ""}
                              </Text>
                              {myVote === undefined && !iRequested && (
                                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                                  <Pressable
                                    style={[styles.voteBtn, { flex: 1, backgroundColor: "#DC2626" }]}
                                    onPress={() => handleVoteRevoteRequest(true)} disabled={voteSaving}
                                  >
                                    <Text style={styles.voteBtnText}>Oui, re-voter</Text>
                                  </Pressable>
                                  <Pressable
                                    style={[styles.voteBtn, { flex: 1, backgroundColor: "#6B7280" }]}
                                    onPress={() => handleVoteRevoteRequest(false)} disabled={voteSaving}
                                  >
                                    <Text style={styles.voteBtnText}>Non, garder</Text>
                                  </Pressable>
                                </View>
                              )}
                              {myVote !== undefined && (
                                <Text style={[styles.voteCardSub, { fontStyle: "italic", marginTop: 4 }]}>
                                  Vous avez voté : {myVote ? "Oui" : "Non"}
                                </Text>
                              )}
                            </View>
                          );
                        })()
                      ) : (
                        <Pressable
                          style={[styles.voteBtn, { backgroundColor: "#DC2626", marginTop: 8 }]}
                          onPress={handleSubmitRevoteRequest} disabled={voteSaving}
                        >
                          {voteSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.voteBtnText}>Demander un re-vote</Text>}
                        </Pressable>
                      )}
                    </>
                  )}
                </>
              )}
            </View>
          )}

          {/* ── TAB DÉPENSES ── */}
          {tab === "depenses" && (
            <>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>
                  Total {selectedYear}
                  {selectedBuilding ? ` — ${sectionLabel(selectedBuilding)}` : ""}
                  {selectedMonth !== null ? ` — ${MONTHS_FR[selectedMonth]}` : ""}
                </Text>
                <Text style={styles.summaryAmount}>{formatAmount(filteredExpenses.reduce((s, e) => s + e.amount, 0))}</Text>
                {hasBuildings && selectedBuilding === null && (
                  <View style={styles.buildingMiniRow}>
                    {[COMMUN, ...buildings.map((b) => b.name)].map((bid) => {
                      const t = expTotalByBuilding[bid] ?? 0;
                      if (t === 0) return null;
                      return (
                        <View key={bid} style={styles.buildingMiniChip}>
                          <Text style={styles.buildingMiniLabel}>{bid === COMMUN ? "Commun" : bid}</Text>
                          <Text style={styles.buildingMiniAmount}>{formatAmount(t)}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* Filtre bâtiment */}
              {hasBuildings && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                  {buildingChips.map((chip) => (
                    <Pressable key={String(chip.id)} style={[styles.filterChip, selectedBuilding === chip.id && styles.filterChipActive]}
                      onPress={() => setSelectedBuilding(chip.id)}>
                      <Text style={[styles.filterChipText, selectedBuilding === chip.id && styles.filterChipTextActive]}>{chip.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}

              {/* Filtre mois */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll}>
                <Pressable style={[styles.monthChip, selectedMonth === null && styles.monthChipActive]} onPress={() => setSelectedMonth(null)}>
                  <Text style={[styles.monthChipText, selectedMonth === null && styles.monthChipTextActive]}>Tous</Text>
                </Pressable>
                {MONTHS_FR.map((m, i) => (
                  <Pressable key={i} style={[styles.monthChip, selectedMonth === i && styles.monthChipActive]} onPress={() => setSelectedMonth(i)}>
                    <Text style={[styles.monthChipText, selectedMonth === i && styles.monthChipTextActive]}>{m}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              {groupedByMonth.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="receipt-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.emptyText}>Aucune dépense enregistrée</Text>
                  {canWrite && <Pressable style={styles.emptyBtn} onPress={openAddExpense}><Text style={styles.emptyBtnText}>Ajouter une dépense</Text></Pressable>}
                </View>
              ) : (
                groupedByMonth.map(([monthKey, items]) => {
                  const [y, m] = monthKey.split("-");
                  return (
                    <View key={monthKey}>
                      <View style={styles.monthHeader}>
                        <Text style={styles.monthHeaderText}>{MONTHS_FR[parseInt(m) - 1]} {y}</Text>
                        <Text style={styles.monthHeaderAmount}>{formatAmount(items.reduce((s, e) => s + e.amount, 0))}</Text>
                      </View>
                      {items.map((e) => (
                        <Pressable key={e.id} style={styles.expenseRow} onPress={() => canWrite && openEditExpense(e)}>
                          <View style={[styles.expenseIcon, { backgroundColor: EXPENSE_CATEGORY_COLORS[e.category] + "20" }]}>
                            <Ionicons name={EXPENSE_CATEGORY_ICONS[e.category] as any} size={18} color={EXPENSE_CATEGORY_COLORS[e.category]} />
                          </View>
                          <View style={styles.expenseInfo}>
                            <Text style={styles.expenseLabel}>{e.label}</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <Text style={styles.expenseMeta}>
                                {EXPENSE_CATEGORY_LABELS[e.category]} · {isoToDisplay(e.date)}
                              </Text>
                              {hasBuildings && (
                                <View style={[styles.buildingBadge, e.buildingId && e.buildingId !== COMMUN && { backgroundColor: COLORS.primary + "15" }]}>
                                  <Text style={styles.buildingBadgeText}>
                                    {!e.buildingId || e.buildingId === COMMUN ? "Commun" : e.buildingId}
                                  </Text>
                                </View>
                              )}
                              {e.interventionId && (
                                <View style={styles.interventionBadge}>
                                  <Ionicons name="link-outline" size={10} color="#0891B2" />
                                  <Text style={styles.interventionBadgeText}>Intervention</Text>
                                </View>
                              )}
                            </View>
                            {!!e.description && <Text style={styles.expenseDesc} numberOfLines={1}>{e.description}</Text>}
                          </View>
                          <Text style={styles.expenseAmount}>{formatAmount(e.amount)}</Text>
                          {canWrite && (
                            <Pressable style={styles.deleteBtn} onPress={() => { safeHaptic(); handleDeleteExpense(e); }}>
                              <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                            </Pressable>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  );
                })
              )}
            </>
          )}

          {/* ── TAB BUDGET AG ── */}
          {tab === "budget" && (
            <>
              <View style={styles.budgetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.budgetHeaderText}>Budget prévisionnel {selectedYear}</Text>
                  <Text style={styles.budgetHeaderSub}>Voté en Assemblée Générale</Text>
                </View>
                {canWrite && (
                  <Pressable style={styles.editBudgetBtn} onPress={openBudgetModal}>
                    <Ionicons name="create-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.editBudgetText}>{hasBudget ? "Modifier" : "Définir"}</Text>
                  </Pressable>
                )}
              </View>

              {hasBudget && (
                <View style={[styles.summaryCard, { marginBottom: 12 }]}>
                  <Text style={styles.summaryLabel}>Total budgété {selectedYear}</Text>
                  <Text style={styles.summaryAmount}>{formatAmount(totalBudget)}</Text>
                  {hasBuildings && (
                    <View style={styles.buildingMiniRow}>
                      {[COMMUN, ...buildings.map((b) => b.name)].map((bid) => {
                        const t = budTotalByBuilding[bid] ?? 0;
                        if (t === 0) return null;
                        return (
                          <View key={bid} style={styles.buildingMiniChip}>
                            <Text style={styles.buildingMiniLabel}>{bid === COMMUN ? "Commun" : bid}</Text>
                            <Text style={styles.buildingMiniAmount}>{formatAmount(t)}</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* Affichage par section */}
              {hasBudget && budgetSections.map((bid) => {
                const lines = budget?.customLines?.filter((l) => (l.buildingId ?? COMMUN) === bid) ?? [];
                const secTotal = lines.reduce((s, l) => s + l.amount, 0);
                if (lines.length === 0) return null;
                return (
                  <View key={bid} style={styles.budgetSection}>
                    <View style={styles.budgetSectionHeader}>
                      <View style={[styles.budgetSectionDot, bid === COMMUN && { backgroundColor: "#64748B" }]} />
                      <Text style={styles.budgetSectionTitle}>{sectionLabel(bid)}</Text>
                      <Text style={styles.budgetSectionTotal}>{formatAmount(secTotal)}</Text>
                    </View>
                    {lines.map((line) => (
                      <View key={line.id} style={styles.budgetRow}>
                        <View style={styles.budgetLineDot} />
                        <Text style={styles.budgetCatLabel}>{line.label}</Text>
                        <Text style={styles.budgetAmount}>{formatAmount(line.amount)}</Text>
                      </View>
                    ))}
                  </View>
                );
              })}

              {/* Lignes legacy (rétrocompat) */}
              {!hasBudget && budget && (
                ALL_EXPENSE_CATEGORIES.filter((cat) => (budget?.lines?.[cat] ?? 0) > 0).map((cat) => (
                  <View key={cat} style={styles.budgetRow}>
                    <Ionicons name={EXPENSE_CATEGORY_ICONS[cat] as any} size={14} color={EXPENSE_CATEGORY_COLORS[cat]} />
                    <Text style={[styles.budgetCatLabel, { marginLeft: 6 }]}>{EXPENSE_CATEGORY_LABELS[cat]}</Text>
                    <Text style={styles.budgetAmount}>{formatAmount(budget.lines[cat] ?? 0)}</Text>
                  </View>
                ))
              )}

              {!hasBudget && (
                <View style={styles.emptyState}>
                  <Ionicons name="document-text-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.emptyText}>Aucun budget défini pour {selectedYear}</Text>
                  {canWrite && (
                    <Pressable style={styles.emptyBtn} onPress={openBudgetModal}>
                      <Text style={styles.emptyBtnText}>Définir le budget prévisionnel</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </>
          )}

          {/* ── TAB COMPARATIF ── */}
          {tab === "synthese" && (
            <>
              {/* Carte globale */}
              <View style={styles.syntheseGlobalCard}>
                <View style={styles.syntheseGlobalRow}>
                  <View style={styles.syntheseGlobalCol}>
                    <Text style={styles.syntheseGlobalLabel}>Budget prévisionnel</Text>
                    <Text style={styles.syntheseGlobalAmount}>{formatAmount(totalBudget)}</Text>
                  </View>
                  <View style={styles.syntheseGlobalDivider} />
                  <View style={styles.syntheseGlobalCol}>
                    <Text style={styles.syntheseGlobalLabel}>Dépenses réelles</Text>
                    <Text style={[styles.syntheseGlobalAmount, totalBudget > 0 && grandTotal > totalBudget && { color: "#FCA5A5" }]}>
                      {formatAmount(grandTotal)}
                    </Text>
                  </View>
                </View>
                {totalBudget > 0 && (
                  <View style={styles.syntheseGlobalEcart}>
                    <Ionicons name={grandTotal > totalBudget ? "arrow-up-circle" : "arrow-down-circle"} size={14}
                      color={grandTotal > totalBudget ? "#FCA5A5" : "#6EE7B7"} />
                    <Text style={[styles.syntheseGlobalEcartText, { color: grandTotal > totalBudget ? "#FCA5A5" : "#6EE7B7" }]}>
                      {grandTotal > totalBudget ? "Dépassement" : "Économie"} de {formatAmount(Math.abs(grandTotal - totalBudget))}
                    </Text>
                  </View>
                )}
              </View>

              {/* Comparatif par bâtiment */}
              {[COMMUN, ...buildings.map((b) => b.name)].map((bid) => {
                const budgeted = budTotalByBuilding[bid] ?? 0;
                const spent = expTotalByBuilding[bid] ?? 0;
                if (budgeted === 0 && spent === 0) return null;
                const over = budgeted > 0 && spent > budgeted;
                const max = Math.max(budgeted, spent, 1);
                return (
                  <View key={bid} style={styles.syntheseCompCard}>
                    <View style={styles.syntheseCompHeader}>
                      <View style={[styles.budgetSectionDot, { width: 10, height: 10, borderRadius: 5, marginRight: 4 }, bid === COMMUN && { backgroundColor: "#64748B" }]} />
                      <Text style={styles.syntheseCompLabel}>{sectionLabel(bid)}</Text>
                      {over && (
                        <View style={styles.syntheseOverBadge}>
                          <Text style={styles.syntheseOverText}>+{formatAmount(spent - budgeted)}</Text>
                        </View>
                      )}
                    </View>
                    {budgeted > 0 && (
                      <View style={styles.syntheseBarRow}>
                        <Text style={styles.syntheseBarLabel}>Prévu</Text>
                        <View style={styles.syntheseBarBg}>
                          <View style={[styles.syntheseBarFill, { width: `${(budgeted / max) * 100}%` as any, backgroundColor: "#CBD5E1" }]} />
                        </View>
                        <Text style={styles.syntheseBarAmt}>{formatAmount(budgeted)}</Text>
                      </View>
                    )}
                    <View style={styles.syntheseBarRow}>
                      <Text style={styles.syntheseBarLabel}>Réel</Text>
                      <View style={styles.syntheseBarBg}>
                        <View style={[styles.syntheseBarFill, { width: `${(spent / max) * 100}%` as any, backgroundColor: over ? COLORS.danger : COLORS.primary }]} />
                      </View>
                      <Text style={[styles.syntheseBarAmt, over && { color: COLORS.danger }]}>{formatAmount(spent)}</Text>
                    </View>
                  </View>
                );
              })}

              {grandTotal === 0 && totalBudget === 0 && (
                <View style={styles.emptyState}>
                  <Ionicons name="bar-chart-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.emptyText}>Aucune donnée pour {selectedYear}</Text>
                </View>
              )}
            </>
          )}

          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      )}

      {/* ── Modal dépense ── */}
      <Modal visible={expenseModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setExpenseModal(false)}><Text style={styles.modalCancel}>Annuler</Text></Pressable>
            <Text style={styles.modalTitle}>{editingExpense?.id ? "Modifier la dépense" : "Nouvelle dépense"}</Text>
            <Pressable onPress={handleSaveExpense} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.modalSave}>Enregistrer</Text>}
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Libellé *</Text>
            <TextInput style={styles.input} value={form.label}
              onChangeText={(v) => setForm((f) => ({ ...f, label: v }))}
              placeholder="Facture EDF janv., Eau Bât. A trim. 1…"
              placeholderTextColor={COLORS.textMuted} />

            <Text style={styles.fieldLabel}>Montant (€) *</Text>
            <TextInput style={styles.input} value={form.amount}
              onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))}
              placeholder="250,00" placeholderTextColor={COLORS.textMuted} keyboardType="decimal-pad" />

            <Text style={styles.fieldLabel}>Date *</Text>
            <TextInput style={styles.input} value={dateDisplay}
              onChangeText={(v) => setDateDisplay(formatDateInput(v))}
              placeholder="JJ/MM/AAAA" placeholderTextColor={COLORS.textMuted} keyboardType="numeric" maxLength={10} />

            {/* Bâtiment / secteur */}
            {hasBuildings && (
              <>
                <Text style={styles.fieldLabel}>Bâtiment / Secteur</Text>
                <View style={styles.catGrid}>
                  {[{ id: COMMUN, label: "Charges communes" }, ...buildings.map((b) => ({ id: b.name, label: b.name }))].map((opt) => {
                    const active = form.buildingId === opt.id;
                    return (
                      <Pressable key={opt.id}
                        style={[styles.catChip, active && { borderColor: COLORS.primary, backgroundColor: COLORS.primary + "18" }]}
                        onPress={() => setForm((f) => ({ ...f, buildingId: opt.id }))}>
                        <Ionicons name={opt.id === COMMUN ? "people-outline" : "business-outline"} size={13}
                          color={active ? COLORS.primary : COLORS.textMuted} />
                        <Text style={[styles.catChipText, active && { color: COLORS.primary }]}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.fieldLabel}>Catégorie</Text>
            <View style={styles.catGrid}>
              {ALL_EXPENSE_CATEGORIES.map((c) => {
                const active = form.category === c;
                return (
                  <Pressable key={c}
                    style={[styles.catChip, active && { borderColor: EXPENSE_CATEGORY_COLORS[c], backgroundColor: EXPENSE_CATEGORY_COLORS[c] + "18" }]}
                    onPress={() => setForm((f) => ({ ...f, category: c }))}>
                    <Ionicons name={EXPENSE_CATEGORY_ICONS[c] as any} size={14} color={active ? EXPENSE_CATEGORY_COLORS[c] : COLORS.textMuted} />
                    <Text style={[styles.catChipText, active && { color: EXPENSE_CATEGORY_COLORS[c] }]}>{EXPENSE_CATEGORY_LABELS[c]}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Note (optionnel)</Text>
            <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="Référence facture, remarque…" placeholderTextColor={COLORS.textMuted} multiline />
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* ── Modal intervention ── */}
      <Modal visible={interventionPickerModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => { setInterventionPickerModal(false); setInterventionSearch(""); }}>
              <Text style={styles.modalCancel}>Annuler</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Choisir une intervention</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={styles.interventionSearchWrap}>
            <Ionicons name="search-outline" size={16} color={COLORS.textMuted} />
            <TextInput style={styles.interventionSearchInput} placeholder="Rechercher…"
              placeholderTextColor={COLORS.textMuted} value={interventionSearch}
              onChangeText={setInterventionSearch} autoCapitalize="none" />
          </View>
          <Text style={styles.interventionPickerHint}>
            Interventions terminées avec un montant validé, pas encore comptabilisées.
          </Text>
          <ScrollView style={{ flex: 1 }}>
            {filteredEligible.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-done-outline" size={36} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>Toutes les interventions sont déjà comptabilisées</Text>
              </View>
            ) : filteredEligible.map((i) => {
              const amount = (i as any).amount as number;
              const date = i.date?.slice(0, 10) ?? "";
              return (
                <Pressable key={i.id} style={styles.interventionPickerRow} onPress={() => handlePickIntervention(i)}>
                  <View style={styles.interventionPickerIcon}>
                    <Ionicons name="construct-outline" size={18} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.interventionPickerTitle}>{i.title}</Text>
                    <Text style={styles.interventionPickerMeta}>
                      {CATEGORY_LABELS[i.category]} · {isoToDisplay(date)}{i.assignedToName ? ` · ${i.assignedToName}` : ""}
                    </Text>
                  </View>
                  <Text style={styles.interventionPickerAmount}>{formatAmount(amount)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                </Pressable>
              );
            })}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* ── Modal budget — lignes libres par section ── */}
      <Modal visible={budgetModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setBudgetModal(false)}><Text style={styles.modalCancel}>Annuler</Text></Pressable>
            <Text style={styles.modalTitle}>Budget prévisionnel {selectedYear}</Text>
            <Pressable onPress={handleSaveBudget} disabled={savingBudget}>
              {savingBudget ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.modalSave}>Enregistrer</Text>}
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.budgetModalHint}>
              Nommez chaque poste librement. {isMulti ? "Les postes sont organisés par bâtiment." : "Exemples : Ascenseur, ECS, Honoraires syndic…"}
            </Text>

            {/* Sections par bâtiment */}
            {budgetSections.map((bid) => {
              const sectionLines = budgetLines.filter((l) => l.buildingId === bid);
              const suggestions = bid === COMMUN ? COMMON_SUGGESTIONS : BUILDING_SUGGESTIONS;
              return (
                <View key={bid} style={styles.budgetModalSection}>
                  {/* En-tête de section */}
                  <View style={styles.budgetModalSectionHeader}>
                    <View style={[styles.budgetSectionDot, bid === COMMUN && { backgroundColor: "#64748B" }]} />
                    <Text style={styles.budgetModalSectionTitle}>{sectionLabel(bid)}</Text>
                  </View>

                  {/* Lignes de la section */}
                  {sectionLines.map((line) => {
                    const idx = budgetLines.findIndex((l) => l.id === line.id);
                    return (
                      <View key={line.id} style={styles.budgetLineRow}>
                        <View style={{ flex: 1, gap: 6 }}>
                          <TextInput style={styles.input} value={line.label}
                            onChangeText={(v) => setBudgetLines((prev) => prev.map((l, i) => i === idx ? { ...l, label: v } : l))}
                            placeholder={bid === COMMUN ? "Ex : Honoraires syndic, Portail…" : `Ex : Ascenseur, ECS ${bid}…`}
                            placeholderTextColor={COLORS.textMuted} />
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <TextInput style={[styles.input, { flex: 1 }]} value={line.amount}
                              onChangeText={(v) => setBudgetLines((prev) => prev.map((l, i) => i === idx ? { ...l, amount: v } : l))}
                              placeholder="Montant €" placeholderTextColor={COLORS.textMuted} keyboardType="decimal-pad" />
                            <Text style={styles.budgetEuro}>€</Text>
                          </View>
                        </View>
                        <Pressable style={{ padding: 8, alignSelf: "center" }}
                          onPress={() => setBudgetLines((prev) => prev.filter((_, i) => i !== idx))}>
                          <Ionicons name="close-circle-outline" size={22} color={COLORS.danger} />
                        </Pressable>
                      </View>
                    );
                  })}

                  {/* Ajouter poste libre */}
                  <Pressable style={styles.addLineBtn} onPress={() => addBudgetLine(bid)}>
                    <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.addLineBtnText}>Ajouter un poste</Text>
                  </Pressable>

                  {/* Suggestions pour cette section */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 4 }}>
                    {suggestions
                      .filter((s) => s !== "Autre…" && !sectionLines.some((l) => l.label.toLowerCase().trim() === s.toLowerCase()))
                      .slice(0, 6)
                      .map((s) => (
                        <Pressable key={s} style={styles.catChip} onPress={() => addBudgetLine(bid, s)}>
                          <Text style={styles.catChipText}>{s}</Text>
                        </Pressable>
                      ))}
                  </View>
                </View>
              );
            })}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  headerSub: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  addBtn: { backgroundColor: COLORS.primary, borderRadius: 20, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  yearRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  yearChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  yearChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  yearChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  yearChipTextActive: { color: "#fff" },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  tabTextActive: { color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  content: { padding: 12 },
  summaryCard: { backgroundColor: COLORS.primary, borderRadius: 16, padding: 20, marginBottom: 12 },
  summaryLabel: { fontSize: 13, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular" },
  summaryAmount: { fontSize: 32, color: "#fff", fontFamily: "Inter_700Bold", marginTop: 4 },
  buildingMiniRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  buildingMiniChip: { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  buildingMiniLabel: { fontSize: 10, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_500Medium" },
  buildingMiniAmount: { fontSize: 13, color: "#fff", fontFamily: "Inter_700Bold", marginTop: 1 },
  filterScroll: { marginBottom: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginRight: 8,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  filterChipTextActive: { color: "#fff" },
  monthScroll: { marginBottom: 12 },
  monthChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  monthChipActive: { backgroundColor: COLORS.primary + "20", borderColor: COLORS.primary },
  monthChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  monthChipTextActive: { color: COLORS.primary },
  monthHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, paddingHorizontal: 2, marginTop: 4 },
  monthHeaderText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  monthHeaderAmount: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  expenseRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border,
  },
  expenseIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", marginRight: 10 },
  expenseInfo: { flex: 1 },
  expenseLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  expenseMeta: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  expenseDesc: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 1 },
  expenseAmount: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text, marginRight: 6 },
  deleteBtn: { padding: 6 },
  buildingBadge: { backgroundColor: "#F1F5F9", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  buildingBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#64748B" },
  interventionBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#E0F2FE", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  interventionBadgeText: { fontSize: 10, color: "#0891B2", fontFamily: "Inter_600SemiBold" },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  emptyBtn: { marginTop: 8, backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  emptyBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  budgetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  budgetHeaderText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  budgetHeaderSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  editBudgetBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: COLORS.primary + "14", borderRadius: 8 },
  editBudgetText: { fontSize: 13, color: COLORS.primary, fontFamily: "Inter_500Medium" },
  budgetSection: { backgroundColor: "#fff", borderRadius: 14, marginBottom: 12, overflow: "hidden", borderWidth: 1, borderColor: COLORS.border },
  budgetSectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface },
  budgetSectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  budgetSectionTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  budgetSectionTotal: { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  budgetRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, gap: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border + "80" },
  budgetLineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  budgetCatLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text },
  budgetAmount: { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  syntheseGlobalCard: { backgroundColor: COLORS.primary, borderRadius: 16, padding: 20, marginBottom: 16 },
  syntheseGlobalRow: { flexDirection: "row", alignItems: "center" },
  syntheseGlobalCol: { flex: 1, alignItems: "center" },
  syntheseGlobalDivider: { width: 1, height: 40, backgroundColor: "rgba(255,255,255,0.3)", marginHorizontal: 12 },
  syntheseGlobalLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular", marginBottom: 4, textAlign: "center" },
  syntheseGlobalAmount: { fontSize: 20, color: "#fff", fontFamily: "Inter_700Bold", textAlign: "center" },
  syntheseGlobalEcart: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.2)" },
  syntheseGlobalEcartText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  syntheseCompCard: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  syntheseCompHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  syntheseCompLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  syntheseOverBadge: { backgroundColor: "#FEE2E2", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  syntheseOverText: { fontSize: 11, color: COLORS.danger, fontFamily: "Inter_600SemiBold" },
  syntheseBarRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  syntheseBarLabel: { width: 36, fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  syntheseBarBg: { flex: 1, height: 8, backgroundColor: COLORS.border, borderRadius: 4, overflow: "hidden" },
  syntheseBarFill: { height: 8, borderRadius: 4 },
  syntheseBarAmt: { width: 72, fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "right" },
  modal: { flex: 1, backgroundColor: "#fff" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  modalCancel: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  modalTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  modalSave: { fontSize: 15, color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  modalBody: { padding: 16 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted, marginBottom: 6, marginTop: 14 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15,
    fontFamily: "Inter_400Regular", color: COLORS.text, backgroundColor: "#fff",
  },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  catChip: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  catChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  budgetModalHint: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginBottom: 16, lineHeight: 18 },
  budgetModalSection: { marginBottom: 20, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, overflow: "hidden" },
  budgetModalSectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  budgetModalSectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  budgetLineRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border + "60",
  },
  addLineBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, padding: 12,
    justifyContent: "center", backgroundColor: COLORS.primary + "08",
  },
  addLineBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  budgetEuro: { fontSize: 14, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  interventionSearchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginVertical: 10,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  interventionSearchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text },
  interventionPickerHint: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginHorizontal: 16, marginBottom: 8, lineHeight: 16 },
  interventionPickerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  interventionPickerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary + "18", alignItems: "center", justifyContent: "center" },
  interventionPickerTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  interventionPickerMeta: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  interventionPickerAmount: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#0891B2", marginRight: 4 },
  // Lecture seule (syndic)
  readOnlyBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#E0F2FE", borderRadius: 10, padding: 12, marginBottom: 12,
  },
  readOnlyText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#0369A1", lineHeight: 18 },
  // Vote trésorier
  voteCard: {
    backgroundColor: "#F5F3FF", borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: "#DDD6FE",
  },
  voteCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  voteCardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#4C1D95", flex: 1 },
  voteCardSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6D28D9", lineHeight: 18, marginBottom: 6 },
  candidateRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#EDE9FE" },
  candidateName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: "#1E1B4B" },
  voteBadge: { backgroundColor: "#DDD6FE", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  voteBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#5B21B6" },
  castVoteBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#7C3AED", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  castVoteBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  voteBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 4 },
  voteBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  revoteRequestCard: { marginTop: 10, padding: 10, backgroundColor: "#FEF2F2", borderRadius: 10, borderWidth: 1, borderColor: "#FECACA" },
  revoteAlert: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, backgroundColor: "#FEF3C7", padding: 8, borderRadius: 8 },
  revoteAlertText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 16 },
});
