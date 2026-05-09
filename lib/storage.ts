import * as ImageManipulator from "expo-image-manipulator";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { Platform } from "react-native";
import { storage } from "@/lib/firebase";

const MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.7;

function makeFileName() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
}

async function compressImage(uri: string): Promise<string> {
  if (!uri || typeof uri !== "string") {
    throw new Error("URI image invalide.");
  }

  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_WIDTH } }],
    {
      compress: JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );

  if (!result?.uri || typeof result.uri !== "string") {
    throw new Error("Impossible de compresser l'image.");
  }

  return result.uri;
}

export async function uploadPhoto(
  coProId: string,
  interventionId: string,
  localUri: string
): Promise<string> {
  if (!coProId) {
    throw new Error("coProId manquant.");
  }

  if (!interventionId) {
    throw new Error("interventionId manquant.");
  }

  if (!localUri || typeof localUri !== "string") {
    throw new Error("URI invalide.");
  }

  console.log("UPLOAD INTERVENTION PHOTO =", localUri);

  const fileName = makeFileName();
  const path = `copros/${coProId}/interventions/${interventionId}/photos/${fileName}`;
  const storageRef = ref(storage, path);

  let blob: Blob;
  if (Platform.OS === "web") {
    const response = await fetch(localUri);
    blob = await response.blob();
  } else {
    const compressedUri = await compressImage(localUri);
    const response = await fetch(compressedUri);
    blob = await response.blob();
  }

  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });

  return await getDownloadURL(storageRef);
}

export async function uploadPhotoPending(
  coProId: string,
  localUri: string
): Promise<string> {
  if (!coProId) {
    throw new Error("coProId manquant.");
  }

  if (!localUri || typeof localUri !== "string") {
    throw new Error("URI invalide.");
  }

  console.log("UPLOAD PENDING PHOTO =", localUri);

  const fileName = makeFileName();
  const path = `copros/${coProId}/pending/${fileName}`;
  const storageRef = ref(storage, path);

  let blob: Blob;
  if (Platform.OS === "web") {
    const response = await fetch(localUri);
    blob = await response.blob();
  } else {
    const compressedUri = await compressImage(localUri);
    const response = await fetch(compressedUri);
    blob = await response.blob();
  }

  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });

  return await getDownloadURL(storageRef);
}