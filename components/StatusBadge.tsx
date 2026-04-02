import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Status, STATUS_LABELS } from "@/shared/types";
import { COLORS } from "@/constants/colors";

const STATUS_STYLES: Record<
  Status,
  { bg: string; text: string; dot: string }
> = {
  planifie: { bg: "#FFF3CD", text: "#92400E", dot: COLORS.warning },
  en_cours: { bg: "#DBEAFE", text: "#1E40AF", dot: COLORS.primary },
  termine: { bg: "#D1FAE5", text: "#065F46", dot: COLORS.success },
};

interface StatusBadgeProps {
  status: Status;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const s = STATUS_STYLES[status];
  const isSmall = size === "sm";

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: s.bg },
        isSmall && styles.containerSmall,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: s.dot }]} />
      <Text style={[styles.label, { color: s.text }, isSmall && styles.labelSmall]}>
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  containerSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  labelSmall: {
    fontSize: 11,
  },
});
