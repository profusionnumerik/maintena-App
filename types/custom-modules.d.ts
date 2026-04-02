declare module "@react-native-async-storage/async-storage" {
  const AsyncStorage: any;
  export default AsyncStorage;
}

declare module "firebase/auth/react-native" {
  export function getReactNativePersistence(storage: any): any;
}

declare module "firebase/app";
declare module "firebase/auth";
declare module "firebase/firestore";
declare module "firebase/storage";
declare module "@/lib/storage";
