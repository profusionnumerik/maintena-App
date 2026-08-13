/**
 * Sélecteur mois/année en pur React Native (pas de module natif).
 * Affiche un popup avec navigation mois par mois.
 */
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

interface Props {
  /** "AAAA-MM" */
  value: string;
  onChange: (period: string) => void;
  label?: string;
}

function parsePeriod(period: string): { year: number; month: number } {
  const [y, m] = period.split("-");
  return { year: parseInt(y) || new Date().getFullYear(), month: parseInt(m) || new Date().getMonth() + 1 };
}

function formatPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function MonthYearPicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const { year, month } = parsePeriod(value);

  const displayLabel = `${MONTHS_FR[month - 1]} ${year}`;

  const prev = () => {
    const d = new Date(year, month - 2, 1);
    onChange(formatPeriod(d.getFullYear(), d.getMonth() + 1));
  };
  const next = () => {
    const d = new Date(year, month, 1);
    onChange(formatPeriod(d.getFullYear(), d.getMonth() + 1));
  };

  // Sélection directe d'un mois dans l'année courante
  const selectMonth = (m: number) => {
    onChange(formatPeriod(year, m));
    setOpen(false);
  };

  const prevYear = () => onChange(formatPeriod(year - 1, month));
  const nextYear = () => onChange(formatPeriod(year + 1, month));

  return (
    <>
      {label && <Text style={styles.fieldLabel}>{label}</Text>}

      {/* Champ affichage + navigation rapide */}
      <View style={styles.row}>
        <Pressable onPress={prev} style={styles.arrowBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
        </Pressable>

        <Pressable style={styles.valueBtn} onPress={() => setOpen(true)}>
          <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
          <Text style={styles.valueText}>{displayLabel}</Text>
          <Ionicons name="chevron-down" size={14} color={COLORS.textMuted} />
        </Pressable>

        <Pressable onPress={next} style={styles.arrowBtn} hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
        </Pressable>
      </View>

      {/* Popup sélection */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.4)" }]}
          onPress={() => setOpen(false)}
        />
        <View style={styles.popup}>
          {/* Navigation année */}
          <View style={styles.yearRow}>
            <Pressable onPress={prevYear} hitSlop={12}>
              <Ionicons name="chevron-back" size={22} color={COLORS.text} />
            </Pressable>
            <Text style={styles.yearLabel}>{year}</Text>
            <Pressable onPress={nextYear} hitSlop={12}>
              <Ionicons name="chevron-forward" size={22} color={COLORS.text} />
            </Pressable>
          </View>

          {/* Grille mois */}
          <View style={styles.monthGrid}>
            {MONTHS_FR.map((name, idx) => {
              const m = idx + 1;
              const isSelected = m === month;
              return (
                <Pressable
                  key={m}
                  style={[styles.monthCell, isSelected && styles.monthCellActive]}
                  onPress={() => selectMonth(m)}
                >
                  <Text style={[styles.monthText, isSelected && styles.monthTextActive]}>
                    {name.slice(0, 3)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fieldLabel: {
    fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 6,
  },
  row: {
    flexDirection: "row", alignItems: "center",
    marginBottom: 14,
  },
  arrowBtn: {
    width: 40, height: 44, alignItems: "center", justifyContent: "center",
  },
  valueBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: "#FAFAFA",
  },
  valueText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },

  popup: {
    position: "absolute",
    top: "50%", left: 24, right: 24,
    marginTop: -140,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  yearRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 16,
  },
  yearLabel: { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.text },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  monthCell: {
    width: "22%", paddingVertical: 10,
    alignItems: "center", borderRadius: 10,
    backgroundColor: "#F8F8F8",
  },
  monthCellActive: { backgroundColor: COLORS.primary },
  monthText: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  monthTextActive: { color: "#fff", fontFamily: "Inter_700Bold" },
});
