import * as DocumentPicker from "expo-document-picker";
import { cacheDirectory, downloadAsync } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query,
} from "firebase/firestore";
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes,
} from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { wa, wConfirm } from "@/shared/dialogs";

const DOC_TYPES = [
  { key: "reglement",    label: "Règlement de copropriété",  icon: "document-text",      color: "#2563EB" },
  { key: "assurance",    label: "Assurance immeuble",        icon: "shield-checkmark",   color: "#16A34A" },
  { key: "diagnostic",   label: "Diagnostics (DPE, amiante…)",icon: "flask",             color: "#D97706" },
  { key: "ag",           label: "Procès-verbaux AG",         icon: "people",             color: "#7C3AED" },
  { key: "contrat",      label: "Contrats prestataires",     icon: "briefcase",          color: "#0891B2" },
  { key: "autre",        label: "Autre document",            icon: "attach",             color: "#6B7280" },
] as const;
type DocType = (typeof DOC_TYPES)[number]["key"];

interface CoProDoc {
  id: string;
  name: string;
  type: DocType;
  url: string;
  storagePath: string;
  size?: number;
  addedBy: string;
  addedByName: string;
  createdAt: string;
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { currentCopro, currentRole } = useCoPro();

  const isAdmin = currentRole === "admin" || currentRole === "co-admin";
  const canWrite = isAdmin || currentRole === "conseil";

  const [docs, setDocs] = useState<CoProDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<DocType | null>(null);

  useEffect(() => {
    if (!currentCopro?.id) return;
    const q = query(
      collection(db, "copros", currentCopro.id, "documents"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CoProDoc)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [currentCopro?.id]);

  const handleUpload = async (type: DocType) => {
    if (!canWrite || !currentCopro?.id || !user) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*", "application/msword",
               "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];

      setUploading(true);
      const blob = await (await fetch(asset.uri)).blob();
      const path = `copros/${currentCopro.id}/documents/${Date.now()}_${asset.name}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, blob, { contentType: asset.mimeType ?? "application/octet-stream" });
      const url = await getDownloadURL(ref);

      await addDoc(collection(db, "copros", currentCopro.id, "documents"), {
        name: asset.name,
        type,
        url,
        storagePath: path,
        size: asset.size,
        addedBy: user.uid,
        addedByName: user.displayName ?? user.email ?? "Inconnu",
        createdAt: new Date().toISOString(),
      });
    } catch (e: any) {
      if (!String(e).includes("cancelled")) wa("Erreur", "Impossible d'ajouter le document.");
    } finally { setUploading(false); }
  };

  const handleOpen = async (d: CoProDoc) => {
    if (Platform.OS === "web") {
      // @ts-ignore
      window.open(d.url, "_blank");
      return;
    }
    try {
      const localPath = (cacheDirectory ?? "") + d.name;
      const { uri } = await downloadAsync(d.url, localPath);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      }
    } catch { wa("Erreur", "Impossible d'ouvrir le document."); }
  };

  const handleDelete = (d: CoProDoc) => {
    if (!canWrite) return;
    wConfirm("Supprimer ce document", `"${d.name}" sera supprimé définitivement.`, async () => {
      try {
        await deleteDoc(doc(db, "copros", currentCopro!.id, "documents", d.id));
        try { await deleteObject(storageRef(storage, d.storagePath)); } catch {}
      } catch { wa("Erreur", "Impossible de supprimer."); }
    }, "Supprimer");
  };

  const filtered = docs.filter((d) => {
    const matchSearch = !search.trim() || d.name.toLowerCase().includes(search.toLowerCase());
    const matchType = !filterType || d.type === filterType;
    return matchSearch && matchType;
  });

  const typeConfig = Object.fromEntries(DOC_TYPES.map((t) => [t.key, t]));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Documents</Text>
          <Text style={styles.headerSub}>{currentCopro?.name}</Text>
        </View>
        {uploading && <ActivityIndicator color={COLORS.primary} />}
      </View>

      {/* Barre de recherche */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={15} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher un document…"
          placeholderTextColor={COLORS.textMuted}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Filtres par type */}
      <View style={styles.filterRow}>
        <Pressable
          style={[styles.filterChip, !filterType && styles.filterChipActive]}
          onPress={() => setFilterType(null)}
        >
          <Text style={[styles.filterChipText, !filterType && styles.filterChipTextActive]}>Tous</Text>
        </Pressable>
        {DOC_TYPES.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.filterChip, filterType === t.key && styles.filterChipActive]}
            onPress={() => setFilterType(filterType === t.key ? null : t.key)}
          >
            <Ionicons name={t.icon as any} size={12} color={filterType === t.key ? "#fff" : COLORS.textMuted} />
            <Text style={[styles.filterChipText, filterType === t.key && styles.filterChipTextActive]} numberOfLines={1}>
              {t.label.split(" ")[0]}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={COLORS.primary} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="folder-open-outline" size={40} color={COLORS.border} />
              <Text style={styles.emptyTitle}>{search || filterType ? "Aucun résultat" : "Aucun document"}</Text>
              <Text style={styles.emptyDesc}>
                {canWrite && !search && !filterType
                  ? "Ajoutez le règlement de copropriété, les diagnostics, les PV d'AG…"
                  : "Aucun document ne correspond à votre recherche."}
              </Text>
            </View>
          }
          renderItem={({ item: d }) => {
            const tc = typeConfig[d.type];
            return (
              <Pressable
                style={({ pressed }) => [styles.docRow, pressed && { opacity: 0.75 }]}
                onPress={() => handleOpen(d)}
              >
                <View style={[styles.docIcon, { backgroundColor: tc?.color ? `${tc.color}18` : "#F1F5F9" }]}>
                  <Ionicons name={(tc?.icon ?? "document") as any} size={20} color={tc?.color ?? COLORS.textMuted} />
                </View>
                <View style={styles.docContent}>
                  <Text style={styles.docName} numberOfLines={1}>{d.name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <Text style={styles.docType}>{tc?.label ?? d.type}</Text>
                    {d.size ? <Text style={styles.docMeta}>· {formatSize(d.size)}</Text> : null}
                    <Text style={styles.docMeta}>· {new Date(d.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</Text>
                  </View>
                  <Text style={styles.docAddedBy} numberOfLines={1}>Ajouté par {d.addedByName}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {canWrite && (
                    <Pressable
                      style={styles.docDeleteBtn}
                      onPress={(e) => { e.stopPropagation(); handleDelete(d); }}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                    </Pressable>
                  )}
                  <Ionicons name="open-outline" size={16} color={COLORS.textMuted} />
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* Boutons d'ajout par type */}
      {canWrite && (
        <View style={[styles.addSection, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.addSectionTitle}>Ajouter un document</Text>
          <View style={styles.addBtnsGrid}>
            {DOC_TYPES.map((t) => (
              <Pressable
                key={t.key}
                style={({ pressed }) => [styles.addTypeBtn, pressed && { opacity: 0.75 }]}
                onPress={() => handleUpload(t.key)}
                disabled={uploading}
              >
                <View style={[styles.addTypeIcon, { backgroundColor: `${t.color}18` }]}>
                  <Ionicons name={t.icon as any} size={18} color={t.color} />
                </View>
                <Text style={styles.addTypeLabel} numberOfLines={2}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 10 : 7,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, paddingVertical: 0 },

  filterRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4,
  },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  filterChipTextActive: { color: "#fff" },

  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 },

  docRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  docIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  docContent: { flex: 1 },
  docName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  docType: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.primary },
  docMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  docAddedBy: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  docDeleteBtn: { padding: 6 },

  emptyState: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center", paddingHorizontal: 40 },

  addSection: {
    borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingTop: 14, paddingHorizontal: 16,
    backgroundColor: COLORS.surface,
  },
  addSectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  addBtnsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  addTypeBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: COLORS.background, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: COLORS.border,
    minWidth: "47%", flex: 1,
  },
  addTypeIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  addTypeLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.text, flex: 1 },
});
