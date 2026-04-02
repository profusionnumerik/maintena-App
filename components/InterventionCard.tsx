import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { Intervention } from "@/shared/types";
import { CategoryBadge } from "./CategoryBadge";
import { StarRating } from "./StarRating";
import { StatusBadge } from "./StatusBadge";

interface InterventionCardProps {
  intervention: Intervention;
  compact?: boolean;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function InterventionCard({
  intervention,
  compact = false,
}: InterventionCardProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/intervention/[id]",
      params: { id: intervention.id },
    });
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.header}>
        <CategoryBadge category={intervention.category} size={compact ? "sm" : "md"} />
        <StatusBadge status={intervention.status} size={compact ? "sm" : "md"} />
      </View>

      <Text
        style={[styles.title, compact && styles.titleCompact]}
        numberOfLines={2}
      >
        {intervention.title}
      </Text>

      {!compact && (
        <Text style={styles.description} numberOfLines={2}>
          {intervention.description}
        </Text>
      )}

      <View style={styles.footer}>
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={13} color={COLORS.textMuted} />
          <Text style={styles.meta}>{formatDate(intervention.date)}</Text>
        </View>

        {intervention.technician && (
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={13} color={COLORS.textMuted} />
            <Text style={styles.meta} numberOfLines={1}>
              {intervention.technician}
            </Text>
          </View>
        )}
      </View>

      {intervention.rating !== undefined && intervention.rating !== null && (
        <View style={styles.ratingRow}>
          <StarRating value={intervention.rating} readonly size={14} />
          <Text style={styles.ratingText}>
            {intervention.rating}/4
          </Text>
        </View>
      )}

      <View style={styles.chevron}>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.99 }],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
    lineHeight: 22,
    marginBottom: 6,
    paddingRight: 20,
  },
  titleCompact: {
    fontSize: 14,
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 19,
    marginBottom: 10,
  },
  footer: {
    flexDirection: "row",
    gap: 14,
    marginTop: 4,
    flexWrap: "wrap",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  meta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  ratingText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: COLORS.textSecondary,
  },
  chevron: {
    position: "absolute",
    right: 14,
    top: "50%",
  },
});
