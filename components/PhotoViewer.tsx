import React, { useState } from "react";
import {
  Modal, View, Image, Pressable, StyleSheet, Dimensions,
  ScrollView, StatusBar, Platform, Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SW, height: SH } = Dimensions.get("window");

interface PhotoViewerProps {
  photos: string[];
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
}

export default function PhotoViewer({ photos, initialIndex = 0, visible, onClose }: PhotoViewerProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  React.useEffect(() => {
    if (visible) setCurrentIndex(initialIndex);
  }, [visible, initialIndex]);

  if (!visible || photos.length === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <StatusBar hidden />

        <Pressable
          style={[styles.closeBtn, { top: insets.top + (Platform.OS === "web" ? 67 : 12) }]}
          onPress={onClose}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>

        {photos.length > 1 && (
          <View style={[styles.counter, { top: insets.top + (Platform.OS === "web" ? 67 : 12) }]}>
            <Text style={styles.counterText}>{currentIndex + 1} / {photos.length}</Text>
          </View>
        )}

        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.pager}
          contentOffset={{ x: currentIndex * SW, y: 0 }}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
            setCurrentIndex(idx);
          }}
        >
          {photos.map((uri, idx) => (
            <View key={idx} style={styles.page}>
              <ScrollView
                maximumZoomScale={4}
                minimumZoomScale={1}
                centerContent
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                style={{ width: SW, height: SH }}
                contentContainerStyle={styles.zoomContainer}
              >
                <Image
                  source={{ uri }}
                  style={styles.img}
                  resizeMode="contain"
                />
              </ScrollView>
            </View>
          ))}
        </ScrollView>

        {photos.length > 1 && (
          <View style={[styles.dots, { bottom: insets.bottom + (Platform.OS === "web" ? 34 : 16) }]}>
            {photos.map((_, idx) => (
              <View key={idx} style={[styles.dot, idx === currentIndex && styles.dotActive]} />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000",
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  counter: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 9,
    alignItems: "center",
  },
  counterText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  pager: { flex: 1 },
  page: {
    width: SW,
    height: SH,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomContainer: {
    width: SW,
    height: SH,
    alignItems: "center",
    justifyContent: "center",
  },
  img: {
    width: SW,
    height: SH,
  },
  dots: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  dotActive: {
    backgroundColor: "#fff",
  },
});
