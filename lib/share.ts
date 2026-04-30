import { Alert, Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";

export async function crossShare(message: string, title?: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: message, title });
        return;
      } catch {}
    }
    await Clipboard.setStringAsync(message);
    Alert.alert("Copié !", "Le message a été copié dans le presse-papiers.");
    return;
  }
  await Share.share({ message, title });
}
