const required = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_IOS_BUNDLE_ID',
  'EXPO_PUBLIC_ANDROID_PACKAGE',
];

const placeholders = [
  'TON_VRAI_FIREBASE_API_KEY',
  'AIza...',
  'YOUR_EAS_PROJECT_ID',
  'YOUR_EXPO_ACCOUNT',
  'admin@example.com',
  'pk_live_xxx',
  'sk_live_xxx',
  'price_xxx',
  'whsec_xxx',
  're_xxx',
];

const missing = required.filter((key) => !process.env[key] || !String(process.env[key]).trim());

if (missing.length) {
  console.error('Variables manquantes :');
  missing.forEach((key) => console.error(`- ${key}`));
  process.exit(1);
}

const withPlaceholders = required.filter((key) => {
  const val = String(process.env[key] ?? '').trim();
  return placeholders.some((p) => val === p || val.startsWith(p));
});

if (withPlaceholders.length) {
  console.error('Variables contenant des valeurs placeholder (à remplacer) :');
  withPlaceholders.forEach((key) => console.error(`- ${key} = ${process.env[key]}`));
  process.exit(1);
}

if (process.env.EXPO_PUBLIC_IOS_BUNDLE_ID === 'com.maintena' || process.env.EXPO_PUBLIC_ANDROID_PACKAGE === 'com.maintena') {
  console.error('Les identifiants com.maintena doivent être remplacés par des identifiants uniques.');
  process.exit(1);
}

console.log('Variables d\'environnement OK pour la publication.');
