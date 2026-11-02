import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/constants/colors";

export interface HelpSection {
  icon: string;
  title: string;
  text: string;
}

export interface HelpContent {
  intro?: string;
  sections: HelpSection[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  content: HelpContent;
}

export default function HelpModal({ visible, onClose, title, content }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="help-circle" size={22} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={20} color={COLORS.textMuted} />
          </Pressable>
        </View>
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {!!content.intro && (
            <Text style={styles.intro}>{content.intro}</Text>
          )}
          {content.sections.map((s, i) => (
            <View key={i} style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.iconWrap}>
                  <Ionicons name={s.icon as any} size={16} color={COLORS.primary} />
                </View>
                <Text style={styles.sectionTitle}>{s.title}</Text>
              </View>
              <Text style={styles.sectionText}>{s.text}</Text>
            </View>
          ))}
          <View style={{ height: 8 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

export function HelpButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.helpBtn} onPress={onPress} hitSlop={8}>
      <Ionicons name="help-circle-outline" size={22} color={COLORS.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: "75%",
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border,
    alignSelf: "center", marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: COLORS.primary + "15",
    alignItems: "center", justifyContent: "center",
  },
  title: { flex: 1, fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  closeBtn: { padding: 4 },
  body: { paddingHorizontal: 16, paddingTop: 12 },
  intro: {
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textMuted,
    lineHeight: 21, marginBottom: 16,
  },
  section: {
    marginBottom: 18,
    backgroundColor: COLORS.background,
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  iconWrap: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: COLORS.primary + "15",
    alignItems: "center", justifyContent: "center",
  },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  sectionText: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted,
    lineHeight: 20, paddingLeft: 36,
  },
  helpBtn: { padding: 4 },
});
