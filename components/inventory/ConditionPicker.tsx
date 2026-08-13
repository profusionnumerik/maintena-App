import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { COLORS } from "@/constants/colors";
import {
  ElementCondition,
  ELEMENT_CONDITION_LABELS,
  ELEMENT_CONDITION_COLORS,
} from "@/shared/types";

const CONDITIONS: ElementCondition[] = [
  "new", "excellent", "good", "fair", "poor", "damaged",
  "not_checked", "absent", "other",
];

interface Props {
  value:        ElementCondition;
  onChange:     (v: ElementCondition) => void;
  conditionNote?: string;
  onNoteChange?: (v: string) => void;
  compact?:     boolean;
}

export function ConditionPicker({
  value, onChange, conditionNote, onNoteChange, compact = false,
}: Props) {
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[s.row, compact && s.rowCompact]}
      >
        {CONDITIONS.map((c) => {
          const active = value === c;
          const color  = ELEMENT_CONDITION_COLORS[c];
          return (
            <Pressable
              key={c}
              style={[
                s.chip,
                compact && s.chipCompact,
                active && { backgroundColor: `${color}20`, borderColor: color },
              ]}
              onPress={() => onChange(c)}
            >
              <View style={[s.dot, { backgroundColor: active ? color : COLORS.border }]} />
              <Text style={[s.label, compact && s.labelCompact, active && { color }]}>
                {ELEMENT_CONDITION_LABELS[c]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {value === "other" && onNoteChange && (
        <TextInput
          style={s.noteInput}
          placeholder="Précisez l'état…"
          placeholderTextColor={COLORS.textMuted}
          value={conditionNote ?? ""}
          onChangeText={onNoteChange}
          multiline
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row:        { gap: 6, paddingVertical: 4, paddingHorizontal: 2 },
  rowCompact: { gap: 4 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  chipCompact: { paddingHorizontal: 8, paddingVertical: 5 },
  dot:  { width: 7, height: 7, borderRadius: 4 },
  label: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary,
  },
  labelCompact: { fontSize: 11 },
  noteInput: {
    marginTop: 8, backgroundColor: COLORS.surfaceAlt,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.text,
    minHeight: 48,
  },
});
