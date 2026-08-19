/**
 * Messagerie locataire ↔ bailleur
 * - Messages texte + messages audio
 * - Enregistrement vocal avec expo-av, upload Firebase Storage
 * - Lecture des messages audio dans les bulles
 * - Fix layout : ScrollView ne capture plus le swipe-back iOS
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Platform, FlatList,
  Pressable, TextInput, ActivityIndicator, Alert,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  collection, onSnapshot, addDoc, orderBy, query,
  serverTimestamp, Timestamp,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import { Audio } from "expo-av";

// ─── Types ─────────────────────────────────────────────────────────────────────

type MsgType = "text" | "audio";

interface ChatMessage {
  id: string;
  senderId: string;
  type: MsgType;
  text?: string;
  audioUrl?: string;
  audioDuration?: number; // ms
  createdAt: Timestamp | null;
}

// ─── Utilitaire durée ─────────────────────────────────────────────────────────

function fmtDur(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ─── Bulle audio ──────────────────────────────────────────────────────────────

function AudioBubble({ msg, isMine }: { msg: ChatMessage; isMine: boolean }) {
  const [sound, setSound]       = useState<Audio.Sound | null>(null);
  const [playing, setPlaying]   = useState(false);
  const [pos, setPos]           = useState(0);   // 0-1
  const [loading, setLoading]   = useState(false);

  const duration = msg.audioDuration ?? 0;

  useEffect(() => () => { sound?.unloadAsync(); }, [sound]);

  const toggle = async () => {
    if (!msg.audioUrl) return;
    if (playing && sound) {
      await sound.pauseAsync();
      setPlaying(false);
      return;
    }
    if (sound) {
      await sound.playAsync();
      setPlaying(true);
      return;
    }
    setLoading(true);
    try {
      const { sound: s } = await Audio.Sound.createAsync(
        { uri: msg.audioUrl },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) { setPlaying(false); setPos(0); }
          else setPos(
            status.positionMillis && status.durationMillis
              ? status.positionMillis / status.durationMillis
              : 0
          );
        }
      );
      setSound(s);
      setPlaying(true);
    } catch (e) {
      Alert.alert("Erreur", "Impossible de lire l'audio.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[ab.row, isMine ? ab.right : ab.left]}>
      <Pressable style={[ab.bubble, isMine ? ab.mine : ab.them]} onPress={toggle}>
        <View style={ab.inner}>
          {/* Bouton play/pause */}
          <View style={[ab.playBtn, isMine ? ab.playMine : ab.playThem]}>
            {loading
              ? <ActivityIndicator size="small" color={isMine ? COLORS.teal : "#fff"} />
              : <Ionicons
                  name={playing ? "pause" : "play"}
                  size={14}
                  color={isMine ? COLORS.teal : "#fff"}
                />
            }
          </View>
          {/* Barre de progression + durée */}
          <View style={{ flex: 1, gap: 4 }}>
            <View style={ab.track}>
              <View style={[ab.fill, { width: `${Math.round(pos * 100)}%` }]} />
            </View>
            <Text style={[ab.dur, isMine ? ab.durMine : ab.durThem]}>
              {duration > 0 ? fmtDur(duration) : "…"}
            </Text>
          </View>
          <Ionicons name="mic-outline" size={12} color={isMine ? "rgba(0,180,160,0.7)" : "rgba(255,255,255,0.35)"} />
        </View>
      </Pressable>
    </View>
  );
}

const ab = StyleSheet.create({
  row:    { paddingHorizontal: 16, marginVertical: 3 },
  right:  { alignItems: "flex-end" },
  left:   { alignItems: "flex-start" },
  bubble: { borderRadius: 16, overflow: "hidden" },
  mine:   { backgroundColor: "rgba(0,180,160,0.15)", borderWidth: 1, borderColor: COLORS.teal + "55", borderBottomRightRadius: 4 },
  them:   { backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderBottomLeftRadius: 4 },
  inner:  { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, minWidth: 180 },
  playBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  playMine: { backgroundColor: "rgba(0,180,160,0.2)", borderWidth: 1, borderColor: COLORS.teal + "44" },
  playThem: { backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  track:  { height: 3, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 2, overflow: "hidden" },
  fill:   { height: "100%", backgroundColor: COLORS.teal, borderRadius: 2 },
  dur:    { fontSize: 10, fontFamily: "Inter_400Regular" },
  durMine: { color: "rgba(0,180,160,0.8)" },
  durThem: { color: "rgba(255,255,255,0.35)" },
});

// ─── Bulle texte ──────────────────────────────────────────────────────────────

function TextBubble({ msg, isMine }: { msg: ChatMessage; isMine: boolean }) {
  const time = msg.createdAt
    ? msg.createdAt.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "…";
  return (
    <View style={[tb.wrapper, isMine ? tb.right : tb.left]}>
      {!isMine && (
        <View style={tb.avatar}>
          <Ionicons name="person-outline" size={11} color={COLORS.teal} />
        </View>
      )}
      <View style={[tb.bubble, isMine ? tb.mine : tb.them]}>
        <Text style={[tb.text, isMine ? tb.textMine : tb.textThem]}>{msg.text}</Text>
        <Text style={[tb.time, isMine ? tb.timeMine : tb.timeThem]}>{time}</Text>
      </View>
    </View>
  );
}

const tb = StyleSheet.create({
  wrapper: { flexDirection: "row", alignItems: "flex-end", gap: 7, paddingHorizontal: 16, marginVertical: 3 },
  right:   { justifyContent: "flex-end" },
  left:    { justifyContent: "flex-start" },
  avatar:  { width: 25, height: 25, borderRadius: 13, backgroundColor: COLORS.teal + "22", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  bubble:  { maxWidth: "75%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, gap: 3 },
  mine:    { backgroundColor: COLORS.teal, borderBottomRightRadius: 4 },
  them:    { backgroundColor: "rgba(255,255,255,0.1)", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  text:    { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  textMine: { color: "#fff" },
  textThem: { color: "rgba(255,255,255,0.85)" },
  time:    { fontSize: 10, fontFamily: "Inter_400Regular" },
  timeMine: { color: "rgba(255,255,255,0.5)", textAlign: "right" },
  timeThem: { color: "rgba(255,255,255,0.28)" },
});

// ─── Séparateur de date ────────────────────────────────────────────────────────

function DateSep({ label }: { label: string }) {
  return (
    <View style={ds.row}>
      <View style={ds.line} /><Text style={ds.label}>{label}</Text><View style={ds.line} />
    </View>
  );
}

const ds = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10, paddingHorizontal: 20 },
  line:  { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.07)" },
  label: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.28)" },
});

// ─── Grouper par date ─────────────────────────────────────────────────────────

type ListItem = { kind: "sep"; label: string } | { kind: "msg"; msg: ChatMessage };

function buildList(msgs: ChatMessage[]): ListItem[] {
  const today     = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  const items: ListItem[] = [];
  let lastLabel = "";
  for (const m of msgs) {
    const date = m.createdAt?.toDate() ?? new Date();
    let label: string;
    if (date.toDateString() === today.toDateString())     label = "Aujourd'hui";
    else if (date.toDateString() === yesterday.toDateString()) label = "Hier";
    else label = fmt(date);
    if (label !== lastLabel) { items.push({ kind: "sep", label }); lastLabel = label; }
    items.push({ kind: "msg", msg: m });
  }
  return items;
}

// ─── Bouton micro — maintien pour enregistrer ─────────────────────────────────

interface MicButtonProps {
  onAudioReady: (uri: string, durationMs: number) => void;
  disabled?: boolean;
}

function MicButton({ onAudioReady, disabled }: MicButtonProps) {
  const [recording, setRecording] = useState(false);
  const recRef = useRef<Audio.Recording | null>(null);
  const startTime = useRef<number>(0);

  const start = async () => {
    if (disabled) return;
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { Alert.alert("Permission refusée", "Autorisez l'accès au microphone dans les réglages."); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recRef.current = rec;
      startTime.current = Date.now();
      setRecording(true);
    } catch (e) {
      console.warn("[mic] start", e);
      Alert.alert("Erreur", "Impossible de démarrer l'enregistrement.");
    }
  };

  const stop = async () => {
    if (!recRef.current) return;
    try {
      await recRef.current.stopAndUnloadAsync();
      const uri = recRef.current.getURI();
      const durationMs = Date.now() - startTime.current;
      recRef.current = null;
      setRecording(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (uri) onAudioReady(uri, durationMs);
    } catch (e) {
      console.warn("[mic] stop", e);
      setRecording(false);
    }
  };

  return (
    <Pressable
      style={[m.btn, recording && m.btnActive, disabled && m.btnDim]}
      onPressIn={start}
      onPressOut={stop}
    >
      <Ionicons
        name={recording ? "stop-circle" : "mic-outline"}
        size={18}
        color={recording ? "#EF4444" : (disabled ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.8)")}
      />
    </Pressable>
  );
}

const m = StyleSheet.create({
  btn:       { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", flexShrink: 0 },
  btnActive: { backgroundColor: "rgba(239,68,68,0.18)", borderColor: "#EF444455" },
  btnDim:    { opacity: 0.35 },
});

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function TenantMessages() {
  const insets     = useSafeAreaInsets();
  const router     = useRouter();
  const { user, rentalInfo } = useAuth();
  const flatRef    = useRef<FlatList>(null);

  const paddingTop = Platform.OS === "web" ? 67 + 16 : insets.top + 12;
  const paddingBot = Platform.OS === "ios" ? insets.bottom + 4 : 8;

  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [text, setText]           = useState("");
  const [sending, setSending]     = useState(false);

  // ── Firestore listener ───────────────────────────────────────────────────────

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

  // Auto-scroll
  useEffect(() => {
    if (messages.length > 0)
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  // ── Envoi texte ───────────────────────────────────────────────────────────────

  const sendText = useCallback(async () => {
    const t = text.trim();
    if (!t || !rentalInfo?.propertyId || !user?.uid || sending) return;
    setText("");
    setSending(true);
    try {
      await addDoc(
        collection(db, "properties", rentalInfo.propertyId, "messages"),
        { senderId: user.uid, type: "text", text: t, createdAt: serverTimestamp() }
      );
    } catch {
      setText(t);
    } finally {
      setSending(false);
    }
  }, [text, rentalInfo?.propertyId, user?.uid, sending]);

  // ── Envoi audio ───────────────────────────────────────────────────────────────

  const sendAudio = useCallback(async (uri: string, durationMs: number) => {
    if (!rentalInfo?.propertyId || !user?.uid) return;
    setSending(true);
    try {
      // Upload dans Firebase Storage
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const id   = Date.now().toString(36);
      const ref  = storageRef(storage, `messages/${rentalInfo.propertyId}/${id}.m4a`);
      await uploadBytes(ref, blob, { contentType: "audio/m4a" });
      const audioUrl = await getDownloadURL(ref);

      await addDoc(
        collection(db, "properties", rentalInfo.propertyId, "messages"),
        { senderId: user.uid, type: "audio", audioUrl, audioDuration: durationMs, createdAt: serverTimestamp() }
      );
    } catch (e) {
      console.warn("[tenant/messages] sendAudio", e);
      Alert.alert("Erreur", "Impossible d'envoyer le message audio.");
    } finally {
      setSending(false);
    }
  }, [rentalInfo?.propertyId, user?.uid]);

  // ── Rendu liste ───────────────────────────────────────────────────────────────

  const listItems = buildList(messages);

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.kind === "sep") return <DateSep label={item.label} />;
    const { msg } = item;
    const isMine = msg.senderId === user?.uid;
    if (msg.type === "audio") return <AudioBubble msg={msg} isMine={isMine} />;
    return <TextBubble msg={msg} isMine={isMine} />;
  };

  const hasText = text.trim().length > 0;

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
        {/* ── Header ── */}
        <View style={[s.header, { paddingTop }]}>
          <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Messagerie</Text>
            <Text style={s.subtitle}>Votre bailleur</Text>
          </View>
          <View style={s.onlineDot} />
        </View>

        {/* ── Liste ── */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={COLORS.teal} size="large" />
          </View>
        ) : messages.length === 0 ? (
          <View style={s.center}>
            <Ionicons name="chatbubbles-outline" size={52} color="rgba(255,255,255,0.1)" />
            <Text style={s.emptyTitle}>Aucun message</Text>
            <Text style={s.emptyDesc}>
              Envoyez un message texte ou maintenez 🎤 pour un message vocal.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            data={listItems}
            keyExtractor={(item, i) => item.kind === "sep" ? `sep-${i}` : item.msg.id}
            renderItem={renderItem}
            contentContainerStyle={{ paddingTop: 10, paddingBottom: 10 }}
            showsVerticalScrollIndicator={false}
            // Ne pas intercepter le swipe horizontal (évite le conflit avec swipe-back iOS)
            directionalLockEnabled
            keyboardDismissMode="on-drag"
          />
        )}

        {/* ── Barre d'envoi ── */}
        <View style={[s.bar, { paddingBottom: paddingBot }]}>
          <TextInput
            style={s.input}
            placeholder="Écrivez un message…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
            returnKeyType="default"
            blurOnSubmit={false}
          />

          {/* Micro — maintien pour enregistrer, masqué si texte en cours */}
          {!hasText && (
            <MicButton onAudioReady={sendAudio} disabled={sending} />
          )}

          {/* Envoyer — apparaît uniquement quand il y a du texte */}
          {hasText && (
            <Pressable
              style={[s.sendBtn, sending && s.sendBtnDim]}
              onPress={sendText}
            >
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="send" size={16} color="#fff" />
              }
            </Pressable>
          )}
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
  center: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 12, paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.3)", textAlign: "center" },
  emptyDesc:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.2)", textAlign: "center", lineHeight: 19 },

  bar: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 14, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  input: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: "#fff",
    maxHeight: 120, minHeight: 40,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.teal,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  sendBtnDim: { opacity: 0.4 },
});
