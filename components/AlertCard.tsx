import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import PhotoViewer from "@/components/PhotoViewer";
import { COLORS } from "@/constants/colors";
import { Signalement } from "@/shared/types";

interface AlertCardProps {
  item: Signalement;
  onAcknowledge: (id: string) => void;
  onDelete?: (id: string) => void;
  onRead?: (id: string) => void;
}

export default function AlertCard({ item, onAcknowledge, onDelete, onRead }: AlertCardProps) {
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const photoList =
    item.photos && item.photos.length > 0
      ? item.photos
      : item.photoUrl
      ? [item.photoUrl]
      : [];
  const isAck = item.acknowledged;
  const isUnread = !item.read && !isAck;

  return (
    <Pressable
      style={[styles.card, isUnread && styles.cardUnread]}
      onPress={() => {
        if (isUnread && onRead) {
          Haptics.selectionAsync();
          onRead(item.id);
        }
      }}
    >
      {viewerIdx !== null && (
        <PhotoViewer
          photos={photoList}
          initialIndex={viewerIdx}
          visible={viewerIdx !== null}
          onClose={() => setViewerIdx(null)}
        />
      )}

      {isUnread && <View style={styles.unreadDot} />}

      <View style={[styles.iconWrap, isAck && styles.iconWrapAck]}>
        <Ionicons
          name="warning"
          size={15}
          color={isAck ? COLORS.success : isUnread ? "#F59E0B" : COLORS.textMuted}
        />
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.senderName} numberOfLines={1}>
              {item.senderName || item.displayName || "Propriétaire"}
              {item.apartmentNumber ? (
                <Text style={styles.appt}>{"  ·  "}Appt {item.apartmentNumber}</Text>
              ) : null}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.date}>
              {new Date(item.createdAt).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "short",
              })}
            </Text>
            {onDelete && (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  onDelete(item.id);
                }}
                hitSlop={10}
                style={styles.deleteBtn}
              >
                <Ionicons name="trash-outline" size={15} color={COLORS.textMuted} />
              </Pressable>
            )}
          </View>
        </View>

        <Text
          style={[styles.message, (item.read || isAck) && styles.messageRead]}
          numberOfLines={3}
        >
          {item.message}
        </Text>

        {photoList.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 2 }}
          >
            <View style={{ flexDirection: "row", gap: 6 }}>
              {photoList.map((url, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setViewerIdx(idx);
                  }}
                  style={styles.thumbWrap}
                >
                  <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
                  <View style={styles.thumbOverlay}>
                    <Ionicons name="expand-outline" size={11} color="#fff" />
                  </View>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}

        {isAck ? (
          <View style={styles.ackChip}>
            <Ionicons name="checkmark-circle" size={11} color={COLORS.success} />
            <Text style={styles.ackChipText}>Pris en compte</Text>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.ackBtn, pressed && { opacity: 0.75 }]}
            onPress={() => {
              Haptics.selectionAsync();
              onAcknowledge(item.id);
            }}
          >
            <Ionicons name="checkmark" size={12} color={COLORS.primary} />
            <Text style={styles.ackBtnText}>Pris en compte</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
    position: "relative",
  },
  cardUnread: {
    backgroundColor: "rgba(245,158,11,0.04)",
  },
  unreadDot: {
    position: "absolute",
    top: 14,
    left: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#F59E0B",
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  iconWrapAck: {
    backgroundColor: "rgba(16,185,129,0.1)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  senderName: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },
  appt: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },
  date: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },
  deleteBtn: {
    padding: 2,
  },
  message: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.text,
    lineHeight: 18,
  },
  messageRead: {
    color: COLORS.textMuted,
    fontFamily: "Inter_400Regular",
  },
  thumbWrap: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  thumb: {
    width: 60,
    height: 60,
  },
  thumbOverlay: {
    position: "absolute",
    bottom: 3,
    right: 3,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 4,
    padding: 2,
  },
  ackChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(16,185,129,0.1)",
  },
  ackChipText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: COLORS.success,
  },
  ackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(37,99,235,0.25)",
    backgroundColor: "rgba(37,99,235,0.06)",
  },
  ackBtnText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: COLORS.primary,
  },
});
