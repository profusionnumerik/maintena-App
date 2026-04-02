import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Category, CATEGORY_ICONS, CATEGORY_LABELS } from "@/shared/types";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";

interface CategoryBadgeProps {
  category: Category;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function CategoryBadge({
  category,
  showLabel = true,
  size = "md",
}: CategoryBadgeProps) {
  const colors = (COLORS.categoryColors as any)[category] ?? { bg: "#F1F5F9", text: "#334155" };
  const label = CATEGORY_LABELS[category] ?? category;
  const isSmall = size === "sm";
  const iconName = (CATEGORY_ICONS[category] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bg },
        isSmall && styles.containerSmall,
      ]}
    >
      <Ionicons
        name={iconName}
        size={isSmall ? 11 : 13}
        color={colors.text}
      />
      {showLabel && (
        <Text
          style={[
            styles.label,
            { color: colors.text },
            isSmall && styles.labelSmall,
          ]}
        >
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  containerSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 3,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  labelSmall: {
    fontSize: 11,
  },
});
