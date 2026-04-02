import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";

interface StarRatingProps {
  value?: number;
  onChange?: (rating: number) => void;
  size?: number;
  readonly?: boolean;
  maxStars?: number;
}

export function StarRating({
  value = 0,
  onChange,
  size = 24,
  readonly = false,
  maxStars = 4,
}: StarRatingProps) {
  const handlePress = (rating: number) => {
    if (readonly || !onChange) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(rating);
  };

  return (
    <View style={styles.container}>
      {Array.from({ length: maxStars }, (_, i) => i + 1).map((star) => (
        <Pressable
          key={star}
          onPress={() => handlePress(star)}
          disabled={readonly}
          style={({ pressed }) => [
            styles.star,
            !readonly && pressed && styles.starPressed,
          ]}
        >
          <Ionicons
            name={star <= (value ?? 0) ? "star" : "star-outline"}
            size={size}
            color={star <= (value ?? 0) ? "#F59E0B" : "#CBD5E1"}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  star: {
    padding: 2,
  },
  starPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.9 }],
  },
});
