import type { ExpoConfig } from 'expo/config';

const APP_NAME = process.env.EXPO_PUBLIC_APP_NAME || 'Maintena';
const APP_SLUG = process.env.EXPO_PUBLIC_APP_SLUG || 'maintena';
const APP_SCHEME = process.env.EXPO_PUBLIC_APP_SCHEME || 'maintena';
const IOS_BUNDLE_ID =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_ID || 'com.profusionnumerik.maintena';
const ANDROID_PACKAGE =
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE || 'com.profusionnumerik.maintena';

const config: ExpoConfig = {
  name: APP_NAME,
  slug: APP_SLUG,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: APP_SCHEME,
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  runtimeVersion: {
    policy: 'appVersion',
  },
  updates: {
    url: 'https://u.expo.dev/f942f5d6-18ac-41c4-89a0-4d9b2fe98138',
  },
  splash: {
    image: './assets/images/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0B1628',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: IOS_BUNDLE_ID,
    infoPlist: {
      NSCameraUsageDescription:
        "Maintena utilise l'appareil photo pour photographier les interventions et les problèmes signalés.",
      NSPhotoLibraryUsageDescription:
        'Maintena accède à votre galerie pour joindre des photos aux interventions.',
      NSPhotoLibraryAddUsageDescription:
        'Maintena enregistre des photos dans votre galerie à votre demande.',
      NSLocationWhenInUseUsageDescription:
        "Maintena utilise votre position uniquement pendant l'utilisation de l'application pour vérifier votre présence sur le site d'intervention.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: {
      backgroundColor: '#0B1628',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'CAMERA',
    ],
  },
  web: {
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-web-browser',
    'expo-updates',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Maintena accède à vos photos pour joindre des images aux interventions.',
        cameraPermission:
          "Maintena utilise l'appareil photo pour documenter une intervention.",
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          "Maintena utilise votre position pendant l'utilisation de l'application pour confirmer la présence sur le site.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: 'f942f5d6-18ac-41c4-89a0-4d9b2fe98138',
    },
    publicLegalUrls: {
      privacyPolicy: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || 'https://maintena.profusionnumerik.fr/privacy-policy',
      accountDeletion: process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL || 'https://maintena.profusionnumerik.fr/account-deletion',
    },
  },
  owner: process.env.EXPO_OWNER || undefined,
};

export default config;