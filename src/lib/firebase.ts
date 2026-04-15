import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

// Firebase config — replace with your own project config
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { auth, db };

// Auth helpers
export async function signInWithGoogle(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Google sign-in failed:', error);
    return null;
  }
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

// Progress sync helpers
interface ProgressData {
  sessions: Array<{
    id: string;
    scenario: string;
    total: number;
    correct: number;
    timestamp: number;
  }>;
  byScenario: Record<string, { total: number; correct: number; lastPracticed: number }>;
  byHand: Record<string, { total: number; correct: number }>;
}

export async function syncProgressToCloud(uid: string, localData: ProgressData): Promise<void> {
  const ref = doc(db, 'users', uid, 'data', 'progress');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { ...localData, updatedAt: Date.now() });
      return;
    }

    // Merge: combine sessions, merge stats
    const cloud = snap.data() as ProgressData;
    const existingSessionIds = new Set(cloud.sessions.map((s) => s.id));
    const newSessions = localData.sessions.filter((s) => !existingSessionIds.has(s.id));

    const mergedSessions = [...cloud.sessions, ...newSessions];

    // Merge byScenario
    const mergedByScenario = { ...cloud.byScenario };
    for (const [key, val] of Object.entries(localData.byScenario)) {
      if (mergedByScenario[key]) {
        // Only add delta from new sessions
        const cloudTotal = mergedByScenario[key].total;
        const localTotal = val.total;
        if (localTotal > cloudTotal) {
          mergedByScenario[key] = val;
        }
      } else {
        mergedByScenario[key] = val;
      }
    }

    // Merge byHand
    const mergedByHand = { ...cloud.byHand };
    for (const [key, val] of Object.entries(localData.byHand)) {
      if (mergedByHand[key]) {
        const cloudTotal = mergedByHand[key].total;
        if (val.total > cloudTotal) {
          mergedByHand[key] = val;
        }
      } else {
        mergedByHand[key] = val;
      }
    }

    await updateDoc(ref, {
      sessions: mergedSessions,
      byScenario: mergedByScenario,
      byHand: mergedByHand,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error('Failed to sync progress to cloud:', error);
    throw error;
  }
}

export async function loadProgressFromCloud(uid: string): Promise<ProgressData | null> {
  const ref = doc(db, 'users', uid, 'data', 'progress');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as ProgressData;
  } catch (error) {
    console.error('Failed to load progress from cloud:', error);
    return null;
  }
}
