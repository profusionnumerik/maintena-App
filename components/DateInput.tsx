/**
 * DateInput — champ de saisie de date avec auto-formatage JJ/MM/AAAA.
 * Insère les "/" automatiquement au fur et à mesure de la frappe.
 *
 * Utilitaires exportés :
 *   maskDate(raw, prev) → "DD/MM/YYYY"
 *   displayToISO(display) → "YYYY-MM-DD"
 *   isoToDisplay(iso) → "DD/MM/YYYY"
 *   todayDisplay() → "DD/MM/YYYY" (aujourd'hui)
 *   parseDisplayDate(display) → Date | null
 */
import { TextInput, TextInputProps, StyleSheet } from "react-native";
import { COLORS } from "@/constants/colors";

// ─── Utilitaires exportés ─────────────────────────────────────────────────────

/** Auto-formate une saisie brute en JJ/MM/AAAA (gère le backspace). */
export function maskDate(raw: string, prev: string): string {
  // Si l'utilisateur supprime, laisser React Native gérer
  if (raw.length < prev.length) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

/** JJ/MM/AAAA → AAAA-MM-JJ (ISO 8601) pour Firestore. */
export function displayToISO(display: string): string {
  // Support aussi le séparateur tiret pour la rétrocompatibilité
  const sep = display.includes("/") ? "/" : "-";
  const parts = display.split(sep);
  if (parts.length !== 3 || parts[2].length !== 4) return "";
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return "";
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/** AAAA-MM-JJ → JJ/MM/AAAA pour l'affichage. */
export function isoToDisplay(iso: string): string {
  if (!iso || iso.length < 10) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

/** Aujourd'hui au format JJ/MM/AAAA. */
export function todayDisplay(): string {
  return isoToDisplay(new Date().toISOString().split("T")[0]);
}

/** Parse JJ/MM/AAAA (ou JJ-MM-AAAA) en objet Date. Retourne null si invalide. */
export function parseDisplayDate(display: string): Date | null {
  if (!display) return null;
  const sep = display.includes("/") ? "/" : "-";
  const parts = display.split(sep);
  if (parts.length !== 3) return null;
  const day   = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year  = parseInt(parts[2], 10);
  if (!day || !month || !year || year < 2000) return null;
  const d = new Date(year, month - 1, day);
  if (isNaN(d.getTime())) return null;
  if (d.getDate() !== day || d.getMonth() !== month - 1) return null;
  return d;
}

// ─── Composant ────────────────────────────────────────────────────────────────

interface DateInputProps extends Omit<TextInputProps, "onChangeText" | "value"> {
  value: string;
  onChangeText: (val: string) => void;
}

/**
 * TextInput spécialisé pour la saisie de dates JJ/MM/AAAA.
 * Les "/" sont insérés automatiquement.
 *
 * @example
 * const [date, setDate] = useState("");
 * <DateInput value={date} onChangeText={setDate} />
 */
export default function DateInput({ value, onChangeText, style, ...props }: DateInputProps) {
  return (
    <TextInput
      value={value}
      onChangeText={(raw) => onChangeText(maskDate(raw, value))}
      placeholder="JJ/MM/AAAA"
      keyboardType="number-pad"
      maxLength={10}
      returnKeyType="done"
      style={[styles.input, style]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
    backgroundColor: "#FAFAFA",
  },
});
