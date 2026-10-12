import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from 'firebase/firestore';

// Web config is public by design; access is controlled by firestore.rules.
const app = initializeApp({
  apiKey: 'AIzaSyCxbCPEehO2z8XOsu3rH6Ae46Z5_WaS_zY',
  // Serving the sign-in handler from the same domain as the app keeps
  // redirect sign-in working in Safari / home-screen apps.
  authDomain: location.hostname.endsWith('.web.app') ? location.hostname : 'volleyrate-f03aa.firebaseapp.com',
  projectId: 'volleyrate-f03aa',
  storageBucket: 'volleyrate-f03aa.firebasestorage.app',
  messagingSenderId: '878122507475',
  appId: '1:878122507475:web:34d52de7fe1d628d220826',
});

export const auth = getAuth(app);
// Keep a copy of the data on the device: reopening the app shows it straight away, and only what changed is
// downloaded (instead of every game, every time). Browsers that can't store it (e.g. some private windows)
// fall back to memory.
function cache() {
  try { return persistentLocalCache({ tabManager: persistentMultipleTabManager() }); }
  catch { return memoryLocalCache(); }
}
export const db = initializeFirestore(app, { localCache: cache() });
