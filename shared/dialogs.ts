import { Alert, Platform } from "react-native";

/** Simple alert — works on both web and native. */
export function wa(title: string, message?: string): void {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

/**
 * Confirmation dialog that calls `onConfirm` when the user agrees.
 * On web uses window.confirm(); on native uses Alert.alert with Annuler/Confirmer buttons.
 * @param destructive  If true (default), the confirm button uses the destructive style on native.
 */
export function wConfirm(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  confirmLabel = "Confirmer",
  destructive = true,
): void {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: "Annuler", style: "cancel" },
      {
        text: confirmLabel,
        style: destructive ? "destructive" : "default",
        onPress: () => { onConfirm(); },
      },
    ]);
  }
}
