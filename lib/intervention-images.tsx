import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { pickCompressAndUploadImage } from "@/lib/intervention-image-upload";
import type { InterventionPhoto } from "@/types/intervention-photo";

type Props = {
  coProId: string;
  interventionId: string;
  initialPhotos?: InterventionPhoto[];
};

export default function InterventionPhotosSection({
  coProId,
  interventionId,
  initialPhotos = [],
}: Props) {
  const [photos, setPhotos] = useState<InterventionPhoto[]>(initialPhotos);
  const [isUploading, setIsUploading] = useState(false);

  const canAddMore = useMemo(() => photos.length < 5, [photos.length]);

  const handleAddPhoto = async () => {
    if (!canAddMore) {
      Alert.alert("Limite atteinte", "Maximum 5 photos par intervention.");
      return;
    }

    try {
      setIsUploading(true);

      const uploaded = await pickCompressAndUploadImage({
        coProId,
        interventionId,
        existingPhotosCount: photos.length,
        source: "library",
      });

      if (uploaded) {
        setPhotos((prev) => [...prev, uploaded]);
      }
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Impossible d'ajouter la photo.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Pressable
        onPress={handleAddPhoto}
        disabled={isUploading || !canAddMore}
        style={{
          backgroundColor: "#0B1628",
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 10,
          opacity: isUploading || !canAddMore ? 0.7 : 1,
        }}
      >
        {isUploading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={{ color: "white", fontWeight: "600", textAlign: "center" }}>
            {canAddMore ? "Ajouter une photo" : "Limite de 5 photos atteinte"}
          </Text>
        )}
      </Pressable>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {photos.map((photo) => (
            <Image
              key={photo.id}
              source={{ uri: photo.thumbnailURL || photo.downloadURL }}
              style={{
                width: 110,
                height: 110,
                borderRadius: 12,
                backgroundColor: "#E5E7EB",
              }}
              resizeMode="cover"
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}