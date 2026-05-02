import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot,
  orderBy, query, setDoc, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import {
  ALL_EXPENSE_CATEGORIES, AnnualBudget, Expense, ExpenseCategory,
  EXPENSE_CATEGORY_COLORS, EXPENSE_CATEGORY_ICONS, EXPENSE_CATEGORY_LABELS,
} from "@/shared/types";

const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);
const MONTHS_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

function safeHaptic() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

const EMPTY_FORM: {
  label: string; amount: string; category: ExpenseCategory;
  date: string; description: string;
} = {
  label: "", amount: "", category: "divers",
  date: new Date().toISOString().slice(0, 10), description: "",
};

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

type Tab = "depenses" | "budget" | "synthese";

export default function ConseilFinancesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { currentCopro, currentRole } = useCoPro();

  const [tab, setTab] = useState<Tab>("depenses");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budget, setBudget] = useState<AnnualBudget | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal dépense
  const [expenseModal, setExpenseModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [dateDisplay, setDateDisplay] = useState(todayStr());
  const [saving, setSaving] = useState(false);

  // Modal budget
  const [budgetModal, setBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm] = useState<Partial<Record<ExpenseCategory, string>>>({});
  const [savingBudget, setSavingBudget] = useState(false);

  const isAdmin = currentRole === "admin";
  const isConseil = currentRole === "conseil";
  const canWrite = isAdmin || isConseil;

  // Chargement dépenses
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

  // Chargement budget
  useEffect(() => {
    if (!currentCopro?.id) return;
    const q = query(
      collection(db, "copros", currentCopro.id, "budgets"),
      where("year", "==", selectedYear)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setBudget({ id: snap.docs[0].id, ...snap.docs[0].data() } as AnnualBudget);
      } else {
        setBudget(null);
      }
    });
    return unsub;
  }, [currentCopro?.id, selectedYear]);

  // Dépenses filtrées par mois
  const filteredExpenses = useMemo(() => {
    if (selectedMonth === null) return expenses;
    const monthStr = String(selectedMonth + 1).padStart(2, "0");
    return expenses.filter((e) => e.date.startsWith(`${selectedYear}-${monthStr}`));
  }, [expenses, selectedYear, selectedMonth]);

  // Totaux par catégorie
  const totalsByCategory = useMemo(() => {
    const map: Partial<Record<ExpenseCategory, number>> = {};
    expenses.forEach((e) => {
      map[e.category] = (map[e.category] ?? 0) + e.amount;
    });
    return map;
  }, [expenses]);

  const grandTotal = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);

  // Groupement par mois pour la liste
  const groupedByMonth = useMemo(() => {
    const map: Record<string, Expense[]> = {};
    filteredExpenses.forEach((e) => {
      const key = e.date.slice(0, 7);
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredExpenses]);

  const openAddExpense = () => {
    setEditingExpense(null);
    setForm({ ...EMPTY_FORM });
    setDateDisplay(todayStr());
    setExpenseModal(true);
  };

  const openEditExpense = (e: Expense) => {
    setEditingExpense(e);
    setForm({ label: e.label, amount: String(e.amount), category: e.category, date: e.date, description: e.description ?? "" });
    setDateDisplay(isoToDisplay(e.date));
    setExpenseModal(true);
  };

  const handleSaveExpense = useCallback(async () => {
    if (!currentCopro?.id || !user) return;
    const amount = parseFloat(form.amount.replace(",", "."));
    if (!form.label.trim()) { Alert.alert("Erreur", "Libellé requis."); return; }
    if (isNaN(amount) || amount <= 0) { Alert.alert("Erreur", "Montant invalide."); return; }
    const isoDate = displayToIso(dateDisplay) || form.date;
    if (!isoDate.match(/^\d{4}-\d{2}-\d{2}$/)) { Alert.alert("Erreur", "Date invalide (JJ/MM/AAAA)."); return; }

    setSaving(true);
    try {
      const data = {
        coProId: currentCopro.id,
        label: form.label.trim(),
        amount,
        category: form.category,
        date: isoDate,
        description: form.description.trim(),
        addedBy: user.uid,
        addedByName: user.displayName || user.email || "Inconnu",
        updatedAt: new Date().toISOString(),
      };
      if (editingExpense) {
        await setDoc(doc(db, "copros", currentCopro.id, "expenses", editingExpense.id), { ...data, createdAt: editingExpense.createdAt }, { merge: false });
      } else {
        await addDoc(collection(db, "copros", currentCopro.id, "expenses"), { ...data, createdAt: new Date().toISOString() });
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setExpenseModal(false);
    } catch { Alert.alert("Erreur", "Impossible d'enregistrer la dépense."); }
    finally { setSaving(false); }
  }, [form, dateDisplay, editingExpense, currentCopro?.id, user]);

  const handleDeleteExpense = (e: Expense) => {
    Alert.alert("Supprimer cette dépense ?", `${e.label} — ${formatAmount(e.amount)}`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive",
        onPress: async () => {
          try { await deleteDoc(doc(db, "copros", currentCopro!.id, "expenses", e.id)); }
          catch { Alert.alert("Erreur", "Impossible de supprimer."); }
        },
      },
    ]);
  };

  const openBudgetModal = () => {
    const init: Partial<Record<ExpenseCategory, string>> = {};
    ALL_EXPENSE_CATEGORIES.forEach((c) => {
      const v = budget?.lines[c];
      init[c] = v !== undefined ? String(v) : "";
    });
    setBudgetForm(init);
    setBudgetModal(true);
  };

  const handleSaveBudget = useCallback(async () => {
    if (!currentCopro?.id || !user) return;
    setSavingBudget(true);
    try {
      const lines: Partial<Record<ExpenseCategory, number>> = {};
      ALL_EXPENSE_CATEGORIES.forEach((c) => {
        const v = parseFloat((budgetForm[c] ?? "").replace(",", "."));
        if (!isNaN(v) && v > 0) lines[c] = v;
      });
      const docId = budget?.id ?? `${currentCopro.id}_${selectedYear}`;
      await setDoc(doc(db, "copros", currentCopro.id, "budgets", docId), {
        coProId: currentCopro.id,
        year: selectedYear,
        lines,
        createdBy: user.uid,
        createdAt: budget?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBudgetModal(false);
    } catch { Alert.alert("Erreur", "Impossible d'enregistrer le budget."); }
    finally { setSavingBudget(false); }
  }, [budgetForm, budget, currentCopro?.id, selectedYear, user]);

  if (!currentCopro) {
    return <View style={styles.root}><Text style={{ color: COLORS.textMuted, textAlign: "center", marginTop: 60 }}>Aucune résidence sélectionnée.</Text></View>;
  }

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
          <Pressable style={styles.addBtn} onPress={() => { safeHaptic(); openAddExpense(); }}>
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        )}
      </View>

      {/* Sélecteur d'année */}
      <View style={styles.yearRow}>
        {YEARS.map((y) => (
          <Pressable
            key={y}
            style={[styles.yearChip, selectedYear === y && styles.yearChipActive]}
            onPress={() => { safeHaptic(); setSelectedYear(y); setSelectedMonth(null); }}
          >
            <Text style={[styles.yearChipText, selectedYear === y && styles.yearChipTextActive]}>{y}</Text>
          </Pressable>
        ))}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(["depenses", "budget", "synthese"] as Tab[]).map((t) => {
          const labels = { depenses: "Dépenses", budget: "Budget", synthese: "Synthèse" };
          return (
            <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{labels[t]}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>

          {/* ── TAB DÉPENSES ── */}
          {tab === "depenses" && (
            <>
              {/* Total + filtre mois */}
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Total {selectedYear}{selectedMonth !== null ? ` — ${MONTHS_FR[selectedMonth]}` : ""}</Text>
                <Text style={styles.summaryAmount}>{formatAmount(filteredExpenses.reduce((s, e) => s + e.amount, 0))}</Text>
              </View>

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
                  const monthTotal = items.reduce((s, e) => s + e.amount, 0);
                  return (
                    <View key={monthKey}>
                      <View style={styles.monthHeader}>
                        <Text style={styles.monthHeaderText}>{MONTHS_FR[parseInt(m) - 1]} {y}</Text>
                        <Text style={styles.monthHeaderAmount}>{formatAmount(monthTotal)}</Text>
                      </View>
                      {items.map((e) => (
                        <Pressable key={e.id} style={styles.expenseRow} onPress={() => canWrite && openEditExpense(e)}>
                          <View style={[styles.expenseIcon, { backgroundColor: EXPENSE_CATEGORY_COLORS[e.category] + "20" }]}>
                            <Ionicons name={EXPENSE_CATEGORY_ICONS[e.category] as any} size={18} color={EXPENSE_CATEGORY_COLORS[e.category]} />
                          </View>
                          <View style={styles.expenseInfo}>
                            <Text style={styles.expenseLabel}>{e.label}</Text>
                            <Text style={styles.expenseMeta}>
                              {EXPENSE_CATEGORY_LABELS[e.category]} · {isoToDisplay(e.date)}
                            </Text>
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

          {/* ── TAB BUDGET ── */}
          {tab === "budget" && (
            <>
              <View style={styles.budgetHeader}>
                <Text style={styles.budgetHeaderText}>Budget prévisionnel {selectedYear}</Text>
                {canWrite && (
                  <Pressable style={styles.editBudgetBtn} onPress={openBudgetModal}>
                    <Ionicons name="create-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.editBudgetText}>{budget ? "Modifier" : "Définir"}</Text>
                  </Pressable>
                )}
              </View>

              {ALL_EXPENSE_CATEGORIES.map((cat) => {
                const budgeted = budget?.lines[cat] ?? 0;
                const spent = totalsByCategory[cat] ?? 0;
                const pct = budgeted > 0 ? Math.min(spent / budgeted, 1) : 0;
                const over = budgeted > 0 && spent > budgeted;
                return (
                  <View key={cat} style={styles.budgetRow}>
                    <View style={styles.budgetRowHeader}>
                      <View style={styles.budgetRowLeft}>
                        <Ionicons name={EXPENSE_CATEGORY_ICONS[cat] as any} size={16} color={EXPENSE_CATEGORY_COLORS[cat]} />
                        <Text style={styles.budgetCatLabel}>{EXPENSE_CATEGORY_LABELS[cat]}</Text>
                      </View>
                      <View style={styles.budgetRowRight}>
                        <Text style={[styles.budgetSpent, over && { color: COLORS.danger }]}>{formatAmount(spent)}</Text>
                        {budgeted > 0 && <Text style={styles.budgetOf}> / {formatAmount(budgeted)}</Text>}
                      </View>
                    </View>
                    {budgeted > 0 && (
                      <View style={styles.progressBg}>
                        <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: over ? COLORS.danger : EXPENSE_CATEGORY_COLORS[cat] }]} />
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {/* ── TAB SYNTHÈSE ── */}
          {tab === "synthese" && (
            <>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Total dépenses {selectedYear}</Text>
                <Text style={styles.summaryAmount}>{formatAmount(grandTotal)}</Text>
              </View>

              {ALL_EXPENSE_CATEGORIES.filter((c) => (totalsByCategory[c] ?? 0) > 0).map((cat) => {
                const spent = totalsByCategory[cat] ?? 0;
                const pct = grandTotal > 0 ? spent / grandTotal : 0;
                return (
                  <View key={cat} style={styles.syntheseRow}>
                    <View style={[styles.syntheseDot, { backgroundColor: EXPENSE_CATEGORY_COLORS[cat] }]} />
                    <Text style={styles.syntheseLabel}>{EXPENSE_CATEGORY_LABELS[cat]}</Text>
                    <View style={styles.syntheseBar}>
                      <View style={[styles.syntheseBarFill, { width: `${pct * 100}%`, backgroundColor: EXPENSE_CATEGORY_COLORS[cat] }]} />
                    </View>
                    <Text style={styles.syntheseAmount}>{formatAmount(spent)}</Text>
                    <Text style={styles.synthesePct}>{(pct * 100).toFixed(0)}%</Text>
                  </View>
                );
              })}

              {grandTotal === 0 && (
                <View style={styles.emptyState}>
                  <Ionicons name="pie-chart-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.emptyText}>Aucune dépense pour {selectedYear}</Text>
                </View>
              )}
            </>
          )}

          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      )}

      {/* ── Modal ajout / édition dépense ── */}
      <Modal visible={expenseModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setExpenseModal(false)}><Text style={styles.modalCancel}>Annuler</Text></Pressable>
            <Text style={styles.modalTitle}>{editingExpense ? "Modifier la dépense" : "Nouvelle dépense"}</Text>
            <Pressable onPress={handleSaveExpense} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.modalSave}>Enregistrer</Text>}
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Libellé *</Text>
            <TextInput
              style={styles.input}
              value={form.label}
              onChangeText={(v) => setForm((f) => ({ ...f, label: v }))}
              placeholder="Facture EDF Mars, Eau trimestre 1…"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.fieldLabel}>Montant (€) *</Text>
            <TextInput
              style={styles.input}
              value={form.amount}
              onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))}
              placeholder="250,00"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>Date *</Text>
            <TextInput
              style={styles.input}
              value={dateDisplay}
              onChangeText={setDateDisplay}
              placeholder="JJ/MM/AAAA"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numeric"
              maxLength={10}
            />

            <Text style={styles.fieldLabel}>Catégorie</Text>
            <View style={styles.catGrid}>
              {ALL_EXPENSE_CATEGORIES.map((c) => {
                const active = form.category === c;
                return (
                  <Pressable
                    key={c}
                    style={[styles.catChip, active && { borderColor: EXPENSE_CATEGORY_COLORS[c], backgroundColor: EXPENSE_CATEGORY_COLORS[c] + "18" }]}
                    onPress={() => setForm((f) => ({ ...f, category: c }))}
                  >
                    <Ionicons name={EXPENSE_CATEGORY_ICONS[c] as any} size={14} color={active ? EXPENSE_CATEGORY_COLORS[c] : COLORS.textMuted} />
                    <Text style={[styles.catChipText, active && { color: EXPENSE_CATEGORY_COLORS[c] }]}>{EXPENSE_CATEGORY_LABELS[c]}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Note (optionnel)</Text>
            <TextInput
              style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
              value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="Référence facture, remarque…"
              placeholderTextColor={COLORS.textMuted}
              multiline
            />
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* ── Modal budget prévisionnel ── */}
      <Modal visible={budgetModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setBudgetModal(false)}><Text style={styles.modalCancel}>Annuler</Text></Pressable>
            <Text style={styles.modalTitle}>Budget {selectedYear}</Text>
            <Pressable onPress={handleSaveBudget} disabled={savingBudget}>
              {savingBudget ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.modalSave}>Enregistrer</Text>}
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.budgetModalHint}>
              Entrez le budget prévisionnel pour chaque poste. Laissez vide si non concerné.
            </Text>
            {ALL_EXPENSE_CATEGORIES.map((c) => (
              <View key={c} style={styles.budgetFieldRow}>
                <View style={styles.budgetFieldLabel}>
                  <Ionicons name={EXPENSE_CATEGORY_ICONS[c] as any} size={15} color={EXPENSE_CATEGORY_COLORS[c]} />
                  <Text style={styles.budgetFieldText}>{EXPENSE_CATEGORY_LABELS[c]}</Text>
                </View>
                <TextInput
                  style={styles.budgetInput}
                  value={budgetForm[c] ?? ""}
                  onChangeText={(v) => setBudgetForm((f) => ({ ...f, [c]: v }))}
                  placeholder="0"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.budgetEuro}>€</Text>
              </View>
            ))}
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
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  headerSub: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  addBtn: {
    backgroundColor: COLORS.primary, borderRadius: 20, width: 36, height: 36,
    alignItems: "center", justifyContent: "center",
  },
  yearRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  yearChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  yearChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  yearChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  yearChipTextActive: { color: "#fff" },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  tabTextActive: { color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  content: { padding: 12 },
  summaryCard: {
    backgroundColor: COLORS.primary, borderRadius: 16, padding: 20, marginBottom: 12,
  },
  summaryLabel: { fontSize: 13, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular" },
  summaryAmount: { fontSize: 32, color: "#fff", fontFamily: "Inter_700Bold", marginTop: 4 },
  monthScroll: { marginBottom: 12 },
  monthChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  monthChipActive: { backgroundColor: COLORS.primary + "20", borderColor: COLORS.primary },
  monthChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  monthChipTextActive: { color: COLORS.primary },
  monthHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 8, paddingHorizontal: 2, marginTop: 4,
  },
  monthHeaderText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  monthHeaderAmount: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  expenseRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  expenseIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", marginRight: 10 },
  expenseInfo: { flex: 1 },
  expenseLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  expenseMeta: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  expenseDesc: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 1 },
  expenseAmount: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text, marginRight: 6 },
  deleteBtn: { padding: 6 },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  emptyBtn: { marginTop: 8, backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  emptyBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  budgetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  budgetHeaderText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  editBudgetBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: COLORS.primary + "14", borderRadius: 8 },
  editBudgetText: { fontSize: 13, color: COLORS.primary, fontFamily: "Inter_500Medium" },
  budgetRow: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  budgetRowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  budgetRowLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  budgetCatLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  budgetRowRight: { flexDirection: "row", alignItems: "baseline" },
  budgetSpent: { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  budgetOf: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  progressBg: { height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  syntheseRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  syntheseDot: { width: 10, height: 10, borderRadius: 5 },
  syntheseLabel: { width: 100, fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.text },
  syntheseBar: { flex: 1, height: 8, backgroundColor: COLORS.border, borderRadius: 4, overflow: "hidden" },
  syntheseBarFill: { height: 8, borderRadius: 4 },
  syntheseAmount: { width: 70, fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "right" },
  synthesePct: { width: 32, fontSize: 11, color: COLORS.textMuted, textAlign: "right" },
  modal: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalCancel: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
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
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  catChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  budgetModalHint: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginBottom: 16, lineHeight: 18 },
  budgetFieldRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  budgetFieldLabel: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  budgetFieldText: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text },
  budgetInput: {
    width: 90, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
    fontFamily: "Inter_400Regular", color: COLORS.text, textAlign: "right",
  },
  budgetEuro: { fontSize: 14, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
});
