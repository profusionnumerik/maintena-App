import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AlertCard from "@/components/AlertCard";
import PhotoViewer from "@/components/PhotoViewer";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import {
  Announcement, AnnouncementType, ANNOUNCEMENT_TYPE_LABELS, ANNOUNCEMENT_TYPE_COLORS, Signalement,
} from "@/shared/types";

const MAX_SIGNAL_PHOTOS = 3;
const FlatListAny = FlatList as any;

function SignalCard({ item, isOwn }: { item: Signalement; isOwn: boolean }) {
  const isAck = item.acknowledged;
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const photoList = item.photos && item.photos.length > 0 ? item.photos : item.photoUrl ? [item.photoUrl] : [];
  return (
    <View style={[styles.sigCard, isAck && styles.sigCardAck, isOwn && styles.sigCardOwn]}>
      {viewerIdx !== null && (
        <PhotoViewer
          photos={photoList}
          initialIndex={viewerIdx}
          visible={viewerIdx !== null}
          onClose={() => setViewerIdx(null)}
        />
      )}
      <View style={styles.sigCardTop}>
        <View style={[styles.sigAvatarWrap, isOwn && styles.sigAvatarOwn]}>
          <Ionicons
            name={isOwn ? "person" : "warning"}
            size={13}
            color={isAck ? COLORS.success : (isOwn ? COLORS.primary : "#F59E0B")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.sigName}>{item.senderName || item.displayName}</Text>
            {isOwn && <Text style={styles.ownBadge}>Moi</Text>}
          </View>
          {item.apartmentNumber ? (
            <Text style={styles.sigAppt}>Appt {item.apartmentNumber}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text style={styles.sigDate}>
            {new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
          </Text>
          {isAck && (
            <View style={styles.sigAckBadge}>
              <Ionicons name="checkmark-circle" size={11} color={COLORS.success} />
              <Text style={styles.sigAckText}>Pris en compte</Text>
            </View>
          )}
        </View>
      </View>
      <Text style={styles.sigMessage}>{item.message}</Text>
      {photoList.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {photoList.map((url, idx) => (
              <Pressable key={idx} onPress={() => setViewerIdx(idx)} style={{ position: "relative" }}>
                <Image source={{ uri: url }} style={styles.sigPhoto} resizeMode="cover" />
                <View style={styles.sigPhotoZoom}>
                  <Ionicons name="expand-outline" size={12} color="#fff" />
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function SignalementModal({
  visible, onClose, onSend, insetBottom,
}: {
  visible: boolean; onClose: () => void;
  onSend: (message: string, senderName: string, apartmentNumber: string, photoUris?: string[]) => Promise<void>;
  insetBottom: number;
}) {
  const [senderName, setSenderName] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [message, setMessage] = useState("");
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const resetForm = () => { setSenderName(""); setApartmentNumber(""); setMessage(""); setPhotoUris([]); };

  const handlePickPhoto = async () => {
    if (photoUris.length >= MAX_SIGNAL_PHOTOS) return;
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permission requise", "Autorisez l'accès à la galerie dans les réglages."); return; }
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
      if (!result.canceled && result.assets.length > 0) {
        setPhotoUris((prev) => [...prev, result.assets[0].uri].slice(0, MAX_SIGNAL_PHOTOS));
      }
    } catch { Alert.alert("Erreur", "Impossible d'ouvrir la galerie."); }
  };

  const handleTakePhoto = async () => {
    if (Platform.OS === "web") { handlePickPhoto(); return; }
    if (photoUris.length >= MAX_SIGNAL_PHOTOS) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission requise", "Autorisez l'accès à l'appareil photo dans les réglages."); return; }
    try {
      const result = await ImagePicker.launchCameraAsync({ quality: 0.75 });
      if (!result.canceled && result.assets.length > 0) {
        setPhotoUris((prev) => [...prev, result.assets[0].uri].slice(0, MAX_SIGNAL_PHOTOS));
      }
    } catch { Alert.alert("Erreur", "Impossible d'ouvrir l'appareil photo."); }
  };

  const removePhoto = (idx: number) => setPhotoUris((prev) => prev.filter((_, i) => i !== idx));

  const handleSend = async () => {
    const trimmedMsg = message.trim();
    const trimmedName = senderName.trim();
    const trimmedAppt = apartmentNumber.trim();
    if (!trimmedMsg || !trimmedName || !trimmedAppt) return;
    setSending(true);
    try {
      await onSend(trimmedMsg, trimmedName, trimmedAppt, photoUris.length > 0 ? photoUris : undefined);
      resetForm(); onClose();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Erreur", e.message ?? "Impossible d'envoyer le signalement.");
    } finally {
      setSending(false);
    }
  };

  const canSend = !!message.trim() && !!senderName.trim() && !!apartmentNumber.trim() && !sending;
  const canAddMore = photoUris.length < MAX_SIGNAL_PHOTOS;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose} />
      <ScrollView
        style={{ flex: 0 }}
        contentContainerStyle={[styles.signalSheetScroll, { paddingBottom: insetBottom + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.modalHandle} />
        <View style={styles.signalHeader}>
          <View style={styles.signalIconWrap}>
            <Ionicons name="warning" size={20} color="#F59E0B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>Signaler un problème</Text>
            <Text style={styles.signalSub}>Visible par tous les propriétaires de la copropriété.</Text>
          </View>
        </View>
        <View style={styles.signalRow}>
          <TextInput
            style={[styles.signalInputSmall, { flex: 1 }]}
            placeholder="Votre nom"
            placeholderTextColor={COLORS.textMuted}
            value={senderName}
            onChangeText={setSenderName}
          />
          <TextInput
            style={[styles.signalInputSmall, { width: 100 }]}
            placeholder="Appt n°"
            placeholderTextColor={COLORS.textMuted}
            value={apartmentNumber}
            onChangeText={setApartmentNumber}
          />
        </View>
        <TextInput
          style={styles.signalInput}
          placeholder="Ex : Fuite d'eau au rez-de-chaussée, portail bloqué..."
          placeholderTextColor={COLORS.textMuted}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {photoUris.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {photoUris.map((uri, idx) => (
                <View key={idx} style={{ position: "relative" }}>
                  <Image source={{ uri }} style={styles.signalThumb} resizeMode="cover" />
                  <Pressable style={styles.signalThumbRemove} onPress={() => removePhoto(idx)} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {canAddMore && (
          <View style={styles.signalPhotoRow}>
            <Pressable style={styles.signalPhotoBtn} onPress={handleTakePhoto}>
              <Ionicons name="camera-outline" size={18} color={COLORS.primary} />
              <Text style={styles.signalPhotoBtnText}>Photo</Text>
            </Pressable>
            <Pressable style={styles.signalPhotoBtn} onPress={handlePickPhoto}>
              <Ionicons name="images-outline" size={18} color={COLORS.primary} />
              <Text style={styles.signalPhotoBtnText}>
                {photoUris.length === 0 ? "Ajouter des photos" : `Ajouter (${photoUris.length}/${MAX_SIGNAL_PHOTOS})`}
              </Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.signalSendBtn, !canSend && styles.signalSendBtnDisabled, pressed && { opacity: 0.85 }]}
          onPress={handleSend}
          disabled={!canSend}
        >
          {sending
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Ionicons name="send" size={16} color="#fff" /><Text style={styles.signalSendBtnText}>Envoyer le signalement</Text></>
          }
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

function AnnouncementCard({
  item, canDelete, onDelete,
}: {
  item: Announcement; canDelete: boolean; onDelete: () => void;
}) {
  const typeColor = ANNOUNCEMENT_TYPE_COLORS[item.type];
  const typeLabel = ANNOUNCEMENT_TYPE_LABELS[item.type];
  const isExpired = item.expiresAt ? new Date(item.expiresAt) < new Date() : false;
  return (
    <View style={[styles.annoCard, isExpired && styles.annoCardExpired]}>
      <View style={styles.annoTop}>
        <View style={[styles.annoBadge, { backgroundColor: typeColor + "18", borderColor: typeColor + "30" }]}>
          <View style={[styles.annoDot, { backgroundColor: typeColor }]} />
          <Text style={[styles.annoBadgeText, { color: typeColor }]}>{typeLabel}</Text>
        </View>
        <Text style={styles.annoDate}>
          {new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}
        </Text>
        {canDelete && (
          <Pressable onPress={onDelete} hitSlop={8} style={{ padding: 2 }}>
            <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
          </Pressable>
        )}
      </View>
      <Text style={styles.annoTitle}>{item.title}</Text>
      <Text style={styles.annoMessage}>{item.message}</Text>
      {item.expiresAt && (
        <Text style={[styles.annoExpiry, isExpired && { color: COLORS.danger }]}>
          {isExpired ? "Expiré" : `Expire le ${new Date(item.expiresAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })}`}
        </Text>
      )}
    </View>
  );
}

const ANNOUNCEMENT_TYPES: AnnouncementType[] = ["info", "eau", "chauffage", "travaux", "urgent"];

function CreateAnnouncementModal({
  visible, onClose, onSave, insetBottom,
}: {
  visible: boolean; onClose: () => void;
  onSave: (title: string, message: string, type: AnnouncementType) => Promise<void>;
  insetBottom: number;
}) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<AnnouncementType>("info");
  const [saving, setSaving] = useState(false);

  const reset = () => { setTitle(""); setMessage(""); setType("info"); };

  const handleSave = async () => {
    if (!title.trim() || !message.trim()) return;
    setSaving(true);
    try {
      await onSave(title.trim(), message.trim(), type);
      reset(); onClose();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Erreur", e.message ?? "Impossible de publier l'annonce.");
    } finally {
      setSaving(false);
    }
  };

  const canSave = !!title.trim() && !!message.trim() && !saving;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose} />
      <ScrollView
        style={{ flex: 0 }}
        contentContainerStyle={[styles.signalSheetScroll, { paddingBottom: insetBottom + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.modalHandle} />
        <View style={styles.signalHeader}>
          <View style={[styles.signalIconWrap, { backgroundColor: "rgba(37,99,235,0.1)" }]}>
            <Ionicons name="megaphone" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>Nouvelle annonce</Text>
            <Text style={styles.signalSub}>Visible par tous les membres de la copropriété</Text>
          </View>
        </View>

        <Text style={styles.signalFieldLabel}>Type d'annonce</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
            {ANNOUNCEMENT_TYPES.map((t) => {
              const color = ANNOUNCEMENT_TYPE_COLORS[t];
              const selected = t === type;
              return (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={[
                    styles.typeChip,
                    selected ? { backgroundColor: color, borderColor: color } : { borderColor: color + "50" }
                  ]}
                >
                  <Text style={[styles.typeChipText, { color: selected ? "#fff" : color }]}>
                    {ANNOUNCEMENT_TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <Text style={styles.signalFieldLabel}>Titre</Text>
        <TextInput
          style={styles.signalInputSmall}
          placeholder="Ex : Coupure d'eau ce vendredi"
          placeholderTextColor={COLORS.textMuted}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.signalFieldLabel}>Message</Text>
        <TextInput
          style={styles.signalInput}
          placeholder="Détails de l'annonce..."
          placeholderTextColor={COLORS.textMuted}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        <Pressable
          style={({ pressed }) => [styles.signalSendBtn, !canSave && styles.signalSendBtnDisabled, pressed && { opacity: 0.85 }]}
          onPress={handleSave}
          disabled={!canSave}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Ionicons name="megaphone" size={16} color="#fff" /><Text style={styles.signalSendBtnText}>Publier l'annonce</Text></>
          }
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

export default function AlertsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    currentCopro, currentRole, signalements, announcements,
    acknowledgeSignalement, deleteSignalement, markSignalementRead,
    addSignalement, toggleAlertEmail, addAnnouncement, deleteAnnouncement,
  } = useCoPro();

  const isAdmin        = currentRole === "admin";
  const isPrestataire  = currentRole === "prestataire";
  const isProprietaire = currentRole === "propriétaire";

  const [activeTab, setActiveTab] = useState<"alertes" | "annonces">("alertes");
  const [signalModalVisible, setSignalModalVisible] = useState(false);
  const [annoModalVisible, setAnnoModalVisible] = useState(false);
  const [togglingEmail, setTogglingEmail] = useState(false);

  const top    = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const unacknowledged = useMemo(() => signalements.filter(s => !s.acknowledged).length, [signalements]);
  const mySignals    = useMemo(() => signalements.filter(s => s.uid === (user?.uid ?? "")), [signalements, user?.uid]);
  const otherSignals = useMemo(() => signalements.filter(s => s.uid !== (user?.uid ?? "")), [signalements, user?.uid]);

  const handleAcknowledge = async (id: string) => {
    try { await acknowledgeSignalement(id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
  };
  const handleDeleteSignal = (id: string) => {
    Alert.alert("Supprimer ce signalement", "Cette action est irréversible.", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => {
        try { await deleteSignalement(id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
      }},
    ]);
  };
  const handleRead = async (id: string) => { try { await markSignalementRead(id); } catch {} };
  const handleToggleEmail = async () => {
    if (!currentCopro) return;
    setTogglingEmail(true);
    try { await toggleAlertEmail(); } catch {} finally { setTogglingEmail(false); }
  };
  const handleSend = async (message: string, senderName: string, apartmentNumber: string, photoUris?: string[]) => {
    await addSignalement(message, senderName, apartmentNumber, photoUris);
  };
  const handleDeleteAnnouncement = (id: string) => {
    Alert.alert("Supprimer l'annonce", "Cette action est irréversible.", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => {
        try { await deleteAnnouncement(id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
      }},
    ]);
  };

  const tabSwitcher = (
    <View style={styles.tabSwitcher}>
      <Pressable
        style={[styles.tabBtn, activeTab === "alertes" && styles.tabBtnActive]}
        onPress={() => setActiveTab("alertes")}
      >
        <Text style={[styles.tabBtnText, activeTab === "alertes" && styles.tabBtnTextActive]}>
          Alertes
        </Text>
        {unacknowledged > 0 && isAdmin && (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText}>{unacknowledged}</Text>
          </View>
        )}
      </Pressable>
      <Pressable
        style={[styles.tabBtn, activeTab === "annonces" && styles.tabBtnActive]}
        onPress={() => setActiveTab("annonces")}
      >
        <Text style={[styles.tabBtnText, activeTab === "annonces" && styles.tabBtnTextActive]}>
          Annonces
        </Text>
        {announcements.length > 0 && (
          <View style={[styles.tabBadge, { backgroundColor: COLORS.primary }]}>
            <Text style={styles.tabBadgeText}>{announcements.length}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );

  const topBar = (
    <View style={[styles.topBar, { paddingTop: top + 16 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.pageTitle}>Communication</Text>
        {currentCopro?.name && (
          <Text style={styles.coProSubtitle} numberOfLines={1}>{currentCopro.name}</Text>
        )}
      </View>
      {isAdmin && activeTab === "alertes" && (
        <View style={styles.emailToggleRow}>
          <Ionicons
            name="mail-outline"
            size={15}
            color={currentCopro?.alertEmailEnabled ? COLORS.primary : COLORS.textMuted}
          />
          {togglingEmail
            ? <ActivityIndicator size="small" color={COLORS.primary} />
            : <Switch
                value={!!currentCopro?.alertEmailEnabled}
                onValueChange={handleToggleEmail}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                thumbColor="#fff"
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
          }
        </View>
      )}
      {isProprietaire && activeTab === "alertes" && (
        <Pressable style={styles.addBtn} onPress={() => setSignalModalVisible(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      )}
      {isAdmin && activeTab === "annonces" && (
        <Pressable style={styles.addBtn} onPress={() => setAnnoModalVisible(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      )}
    </View>
  );

  const announcementsContent = (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 16 }]}
    >
      {announcements.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="megaphone-outline" size={42} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>Aucune annonce</Text>
          <Text style={styles.emptyDesc}>
            {isAdmin
              ? "Publiez une annonce pour informer les résidents (coupures, travaux…)"
              : "Le syndic n'a pas encore publié d'annonce"}
          </Text>
          {isAdmin && (
            <Pressable
              style={[styles.signalBtn, { marginTop: 16 }]}
              onPress={() => setAnnoModalVisible(true)}
            >
              <Ionicons name="megaphone-outline" size={18} color="#fff" />
              <Text style={styles.signalBtnText}>Publier une annonce</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
          {announcements.map((a) => (
            <AnnouncementCard
              key={a.id}
              item={a}
              canDelete={isAdmin}
              onDelete={() => handleDeleteAnnouncement(a.id)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );

  if (isPrestataire) {
    return (
      <View style={styles.root}>
        {topBar}
        {tabSwitcher}
        {activeTab === "alertes" ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 16 }]}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              style={({ pressed }) => [styles.signalBtn, { margin: 20 }, pressed && { opacity: 0.85 }]}
              onPress={() => setSignalModalVisible(true)}
            >
              <Ionicons name="warning-outline" size={20} color="#fff" />
              <Text style={styles.signalBtnText}>Signaler un problème</Text>
            </Pressable>
            <Text style={styles.prestataireSub}>
              Vos signalements seront transmis au syndic de cette copropriété.
            </Text>
          </ScrollView>
        ) : announcementsContent}
        <SignalementModal
          visible={signalModalVisible}
          onClose={() => setSignalModalVisible(false)}
          onSend={handleSend}
          insetBottom={bottom}
        />
      </View>
    );
  }

  if (isAdmin) {
    return (
      <View style={styles.root}>
        {topBar}
        {tabSwitcher}
        {activeTab === "alertes" ? (
          <FlatListAny
            data={signalements}
            keyExtractor={(s: Signalement) => s.id}
            renderItem={({ item }: { item: Signalement }) => (
              <AlertCard
                item={item}
                onAcknowledge={() => handleAcknowledge(item.id)}
                onDelete={() => handleDeleteSignal(item.id)}
                onRead={() => handleRead(item.id)}
              />
            )}
            ListHeaderComponent={unacknowledged > 0 ? (
              <View style={styles.summaryBanner}>
                <Ionicons name="warning" size={13} color="#D97706" />
                <Text style={styles.summaryText}>
                  {unacknowledged} alerte{unacknowledged > 1 ? "s" : ""} non traitée{unacknowledged > 1 ? "s" : ""}
                </Text>
              </View>
            ) : undefined}
            ListEmptyComponent={(
              <View style={styles.emptyWrap}>
                <Ionicons name="checkmark-circle-outline" size={42} color={COLORS.success} />
                <Text style={styles.emptyTitle}>Aucune alerte</Text>
                <Text style={styles.emptyDesc}>Tout est tranquille pour cette copropriété</Text>
              </View>
            )}
            contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 16 }]}
            showsVerticalScrollIndicator={false}
          />
        ) : announcementsContent}
        <CreateAnnouncementModal
          visible={annoModalVisible}
          onClose={() => setAnnoModalVisible(false)}
          onSave={addAnnouncement}
          insetBottom={bottom}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {topBar}
      {tabSwitcher}
      {activeTab === "alertes" ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 16 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.proprietaireBanner}>
            <Ionicons name="information-circle-outline" size={13} color={COLORS.primary} />
            <Text style={styles.proprietaireBannerText}>Visible par tous les membres de la copropriété</Text>
          </View>
          {signalements.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="checkmark-circle-outline" size={42} color={COLORS.success} />
              <Text style={styles.emptyTitle}>Aucun signalement</Text>
              <Text style={styles.emptyDesc}>Appuyez sur + pour signaler un problème</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16 }}>
              {mySignals.length > 0 && (
                <View style={styles.groupSection}>
                  <View style={styles.groupHeader}>
                    <View style={[styles.groupDot, { backgroundColor: COLORS.primary }]} />
                    <Text style={styles.groupTitle}>Mes alertes</Text>
                    <Text style={styles.groupCount}>{mySignals.length}</Text>
                  </View>
                  {mySignals.map(s => <SignalCard key={s.id} item={s} isOwn={true} />)}
                </View>
              )}
              {otherSignals.length > 0 && (
                <View style={styles.groupSection}>
                  <View style={styles.groupHeader}>
                    <View style={[styles.groupDot, { backgroundColor: "#F59E0B" }]} />
                    <Text style={styles.groupTitle}>Copropriété</Text>
                    <Text style={styles.groupCount}>{otherSignals.length}</Text>
                  </View>
                  {otherSignals.map(s => <SignalCard key={s.id} item={s} isOwn={false} />)}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      ) : announcementsContent}
      <SignalementModal
        visible={signalModalVisible}
        onClose={() => setSignalModalVisible(false)}
        onSend={handleSend}
        insetBottom={bottom}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  topBar: {
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  pageTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text },
  coProSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  emailToggleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  addBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center",
  },
  summaryBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(245,158,11,0.1)",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(245,158,11,0.2)",
  },
  summaryText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#B45309" },
  proprietaireBanner: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "rgba(37,99,235,0.06)",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(37,99,235,0.1)",
  },
  proprietaireBannerText: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.primary },
  prestataireBanner: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "rgba(37,99,235,0.06)",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(37,99,235,0.1)",
  },
  prestataireBannerText: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.primary },
  signalBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, margin: 20, padding: 16, borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  signalBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  prestataireSub: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted,
    textAlign: "center", paddingHorizontal: 32,
  },
  listContent: { flexGrow: 1 },
  emptyWrap: { alignItems: "center", paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },

  groupSection: { marginBottom: 8 },
  groupHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 12,
  },
  groupDot: { width: 7, height: 7, borderRadius: 4 },
  groupTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, flex: 1 },
  groupCount: {
    fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted,
    backgroundColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 1,
  },

  sigCard: {
    marginBottom: 8,
    backgroundColor: "#FFFDF5", borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
    padding: 12, gap: 6,
  },
  sigCardAck: { backgroundColor: "#F0FDF4", borderColor: "rgba(16,185,129,0.2)" },
  sigCardOwn: { backgroundColor: "rgba(37,99,235,0.04)", borderColor: "rgba(37,99,235,0.15)" },
  sigCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  sigAvatarWrap: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  sigAvatarOwn: { backgroundColor: "rgba(37,99,235,0.1)" },
  sigName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  ownBadge: {
    fontSize: 9, fontFamily: "Inter_600SemiBold", color: COLORS.primary,
    backgroundColor: "rgba(37,99,235,0.1)", borderRadius: 6,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  sigAppt: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  sigDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  sigAckBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  sigAckText: { fontSize: 10, fontFamily: "Inter_500Medium", color: COLORS.success },
  sigMessage: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.text },
  sigPhoto: { width: 160, height: 110, borderRadius: 8 },
  sigPhotoZoom: {
    position: "absolute", bottom: 4, right: 4,
    backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 10, padding: 3,
  },

  modalOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border,
    alignSelf: "center", marginBottom: 14,
  },
  modalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 12 },
  signalSheetScroll: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingTop: 12,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
  },
  signalHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  signalIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.12)", alignItems: "center", justifyContent: "center",
  },
  signalSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 3 },
  signalRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  signalInputSmall: {
    height: 44, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.background, paddingHorizontal: 12,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
  },
  signalInput: {
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.background, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    minHeight: 90, marginBottom: 10,
  },
  signalPhotoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  signalPhotoBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.primary,
    backgroundColor: "rgba(37,99,235,0.05)",
  },
  signalPhotoBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.primary },
  signalThumb: { width: 64, height: 64, borderRadius: 10 },
  signalThumbRemove: { position: "absolute", top: -6, right: -6 },
  signalSendBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 14, height: 50,
  },
  signalSendBtnDisabled: { opacity: 0.45 },
  signalSendBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  signalFieldLabel: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted,
    marginBottom: 6, marginTop: 4,
  },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, backgroundColor: "transparent",
  },
  typeChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  tabSwitcher: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingHorizontal: 16,
  },
  tabBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 12, paddingHorizontal: 12, marginRight: 4,
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomColor: COLORS.primary },
  tabBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  tabBtnTextActive: { color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  tabBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },

  annoCard: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 14, gap: 6,
  },
  annoCardExpired: { opacity: 0.55 },
  annoTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  annoBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20, borderWidth: 1,
  },
  annoDot: { width: 6, height: 6, borderRadius: 3 },
  annoBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  annoDate: {
    fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginLeft: "auto" as any,
  },
  annoTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text },
  annoMessage: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, lineHeight: 20 },
  annoExpiry: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted, marginTop: 2 },
});
