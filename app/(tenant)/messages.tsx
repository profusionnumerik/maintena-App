import { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Platform, ScrollView,
  Pressable, TextInput, KeyboardAvoidingView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  collection, onSnapshot, addDoc, orderBy, query,
  serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt: Timestamp | null;
}

// ─── Bubble de message ─────────────────────────────────────────────────────────

function Bubble({
  msg, isMine,
}: { msg: ChatMessage; isMine: boolean }) {
  const time = msg.createdAt
    ? msg.createdAt.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "…";
  const date = msg.createdAt
    ? msg.createdAt.toDate().toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : "";

  return (
    <View style={[b.wrapper, isMine ? b.wrapperRight : b.wrapperLeft]}>
      {!isMine && (
        <View style={b.avatar}>
          <Ionicons name="person-outline" size={12} color={COLORS.teal} />
        </View>
      )}
      <View style={[b.bubble, isMine ? b.bubbleMine : b.bubbleThem]}>
        <Text style={[b.text, isMine ? b.textMine : b.textThem]}>{msg.text}</Text>
        <Text style={[b.time, isMine ? b.timeMine : b.timeThem]}>
          {time} · {date}
        </Text>
      </View>
    </View>
  );
}

const b = StyleSheet.create({
  wrapper:      { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, marginVertical: 3 },
  wrapperRight: { justifyContent: "flex-end" },
  wrapperLeft:  { justifyContent: "flex-start" },
  avatar: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.teal + "22",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0, alignSelf: "flex-end",
  },
  bubble: { maxWidth: "75%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, gap: 4 },
  bubbleMine: {
    backgroundColor: COLORS.teal,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  text:     { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  textMine: { color: "#fff" },
  textThem: { color: "rgba(255,255,255,0.85)" },
  time:     { fontSize: 10, fontFamily: "Inter_400Regular" },
  timeMine: { color: "rgba(255,255,255,0.55)", textAlign: "right" },
  timeThem: { color: "rgba(255,255,255,0.3)" },
});

// ─── Séparateur de date ────────────────────────────────────────────────────────

function DateSep({ label }: { label: string }) {
  return (
    <View style={ds.row}>
      <View style={ds.line} />
      <Text style={ds.label}>{label}</Text>
      <View style={ds.line} />
    </View>
  );
}

const ds = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10, paddingHorizontal: 20 },
  line:  { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  label: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.3)" },
});

// ─── Séparer les messages par date ────────────────────────────────────────────

function groupByDate(msgs: ChatMessage[]) {
  const today     = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  const groups: { label: string; items: ChatMessage[] }[] = [];
  let lastLabel = "";

  for (const m of msgs) {
    const date = m.createdAt?.toDate() ?? new Date();
    let label: string;
    if (date.toDateString() === today.toDateString()) label = "Aujourd'hui";
    else if (date.toDateString() === yesterday.toDateString()) label = "Hier";
    else label = fmt(date);

    if (label !== lastLabel) {
      groups.push({ label, items: [] });
      lastLabel = label;
    }
    groups[groups.length - 1].items.push(m);
  }
  return groups;
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function TenantMessages() {
  const insets     = useSafeAreaInsets();
  const router     = useRouter();
  const { user, rentalInfo } = useAuth();
  const scrollRef  = useRef<ScrollView>(null);

  const paddingTop = Platform.OS === "web" ? 67 + 16 : insets.top + 12;
  const paddingBot = Platform.OS === "ios" ? insets.bottom + 4 : 8;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [text, setText]         = useState("");
  const [sending, setSending]   = useState(false);

  useEffect(() => {
    if (!rentalInfo?.propertyId) { setLoading(false); return; }
    return onSnapshot(
      query(
        collection(db, "properties", rentalInfo.propertyId, "messages"),
        orderBy("createdAt", "asc")
      ),
      (snap) => {
        setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage)));
        setLoading(false);
      },
      (err) => { console.warn("[tenant/messages]", err); setLoading(false); }
    );
  }, [rentalInfo?.propertyId]);

  // Auto-scroll en bas à chaque nouveau message
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  const send = useCallback(async () => {
    const t = text.trim();
    if (!t || !rentalInfo?.propertyId || !user?.uid) return;
    setText("");
    setSending(true);
    try {
      await addDoc(
        collection(db, "properties", rentalInfo.propertyId, "messages"),
        { senderId: user.uid, text: t, createdAt: serverTimestamp() }
      );
    } catch (err) {
      console.warn("[tenant/messages] send", err);
      setText(t); // restaurer si erreur
    } finally {
      setSending(false);
    }
  }, [text, rentalInfo?.propertyId, user?.uid]);

  const groups = groupByDate(messages);

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D1A47"]}
      style={{ flex: 1 }}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={[s.header, { paddingTop }]}>
          <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Messagerie</Text>
            <Text style={s.subtitle}>Votre bailleur</Text>
          </View>
          <View style={s.onlineDot} />
        </View>

        {/* Messages */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={COLORS.teal} size="large" />
          </View>
        ) : messages.length === 0 ? (
          <View style={s.center}>
            <Ionicons name="chatbubbles-outline" size={52} color="rgba(255,255,255,0.12)" />
            <Text style={s.emptyTitle}>Aucun message</Text>
            <Text style={s.emptyDesc}>
              Envoyez votre premier message à votre bailleur ci-dessous.
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={s.msgList}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
          >
            {groups.map((g) => (
              <View key={g.label}>
                <DateSep label={g.label} />
                {g.items.map((m) => (
                  <Bubble key={m.id} msg={m} isMine={m.senderId === user?.uid} />
                ))}
              </View>
            ))}
            <View style={{ height: 16 }} />
          </ScrollView>
        )}

        {/* Barre d'envoi */}
        <View style={[s.inputBar, { paddingBottom: paddingBot }]}>
          <TextInput
            style={s.input}
            placeholder="Écrivez un message…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
            returnKeyType="default"
            onSubmitEditing={send}
          />
          <Pressable
            style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnDisabled]}
            onPress={send}
            disabled={!text.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={16} color="#fff" />
            }
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  title:    { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", marginTop: 2 },
  onlineDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: "#10B981",
    borderWidth: 2, borderColor: COLORS.dark,
  },
  msgList: { paddingTop: 12, paddingBottom: 4 },
  center: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 12, paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 16, fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.35)", textAlign: "center",
  },
  emptyDesc: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.22)", textAlign: "center", lineHeight: 19,
  },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  input: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: "#fff",
    maxHeight: 120,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.teal,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  sendBtnDisabled: { opacity: 0.35 },
});
