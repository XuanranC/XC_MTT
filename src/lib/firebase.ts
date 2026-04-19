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

// Progress sync helpers — schema V2 matches src/lib/progress.ts.
// Cloud docs from V1 are treated as stale and overwritten on first V2 write;
// the user has explicitly opted into this reset.
const PROGRESS_VERSION = 2;
const ATTEMPTS_CAP = 1000;

interface ProgressStat {
  total: number;
  correct: number;
}

interface ScenarioBreakdown {
  byHand: Record<string, ProgressStat>;
  byPosition: Record<string, ProgressStat>;
  byBB: Record<string, ProgressStat>;
}

interface AttemptRecord {
  hand: string;
  scenario: string;
  position: string;
  bb: number;
  vs?: string;
  selected: string;
  gtoActions: Array<{ action: string; pct: number }>;
  reach?: number;
  isCorrect: boolean;
  timestamp: number;
}

interface ProgressData {
  version: number;
  sessions: Array<{
    id: string;
    scenario: string;
    total: number;
    correct: number;
    timestamp: number;
  }>;
  byScenario: Record<string, { total: number; correct: number; lastPracticed: number }>;
  scenarioBreakdowns: Record<string, ScenarioBreakdown>;
  attempts: AttemptRecord[];
}

function mergeStatMap(
  a: Record<string, ProgressStat> | undefined,
  b: Record<string, ProgressStat> | undefined,
): Record<string, ProgressStat> {
  const out: Record<string, ProgressStat> = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) {
    // Prefer the side with more attempts (newer device usually wins)
    if (!out[k] || v.total > out[k].total) out[k] = v;
  }
  return out;
}

function mergeScenarioBreakdowns(
  a: Record<string, ScenarioBreakdown> | undefined,
  b: Record<string, ScenarioBreakdown> | undefined,
): Record<string, ScenarioBreakdown> {
  const out: Record<string, ScenarioBreakdown> = { ...(a ?? {}) };
  for (const [scenario, bd] of Object.entries(b ?? {})) {
    const existing = out[scenario];
    if (!existing) {
      out[scenario] = bd;
    } else {
      out[scenario] = {
        byHand: mergeStatMap(existing.byHand, bd.byHand),
        byPosition: mergeStatMap(existing.byPosition, bd.byPosition),
        byBB: mergeStatMap(existing.byBB, bd.byBB),
      };
    }
  }
  return out;
}

function mergeAttempts(
  a: AttemptRecord[] | undefined,
  b: AttemptRecord[] | undefined,
): AttemptRecord[] {
  const seen = new Set<string>();
  const merged: AttemptRecord[] = [];
  for (const att of [...(a ?? []), ...(b ?? [])]) {
    // (timestamp + hand + scenario) is unique because recordDrillSession
    // stamps sequential micro-offsets within a batch.
    const key = `${att.timestamp}|${att.hand}|${att.scenario}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(att);
  }
  merged.sort((x, y) => y.timestamp - x.timestamp);
  return merged.slice(0, ATTEMPTS_CAP);
}

export async function syncProgressToCloud(uid: string, localData: ProgressData): Promise<void> {
  const ref = doc(db, 'users', uid, 'data', 'progress');
  try {
    const snap = await getDoc(ref);
    const payload: ProgressData = {
      version: PROGRESS_VERSION,
      sessions: localData.sessions ?? [],
      byScenario: localData.byScenario ?? {},
      scenarioBreakdowns: localData.scenarioBreakdowns ?? {},
      attempts: localData.attempts ?? [],
    };

    if (!snap.exists()) {
      await setDoc(ref, { ...payload, updatedAt: Date.now() });
      return;
    }

    const cloud = snap.data() as Partial<ProgressData>;

    // Cloud is a stale V1 doc — overwrite rather than trying to merge shapes.
    if (cloud.version !== PROGRESS_VERSION) {
      await setDoc(ref, { ...payload, updatedAt: Date.now() });
      return;
    }

    // V2 + V2: dedupe sessions by id, merge stat maps by max total,
    // union attempts by (timestamp+hand+scenario).
    const existingSessionIds = new Set((cloud.sessions ?? []).map((s) => s.id));
    const mergedSessions = [
      ...(cloud.sessions ?? []),
      ...payload.sessions.filter((s) => !existingSessionIds.has(s.id)),
    ];

    const mergedByScenarioRaw = mergeStatMap(
      cloud.byScenario as Record<string, ProgressStat> | undefined,
      payload.byScenario as Record<string, ProgressStat>,
    );
    // byScenario carries an extra `lastPracticed` — re-attach from whichever
    // source supplied the winning total.
    const mergedByScenario: ProgressData['byScenario'] = {};
    for (const [k, stat] of Object.entries(mergedByScenarioRaw)) {
      const cloudEntry = cloud.byScenario?.[k];
      const localEntry = payload.byScenario[k];
      const winning = localEntry && localEntry.total === stat.total ? localEntry : cloudEntry;
      mergedByScenario[k] = {
        total: stat.total,
        correct: stat.correct,
        lastPracticed: winning?.lastPracticed ?? Date.now(),
      };
    }

    const mergedPayload: ProgressData = {
      version: PROGRESS_VERSION,
      sessions: mergedSessions,
      byScenario: mergedByScenario,
      scenarioBreakdowns: mergeScenarioBreakdowns(
        cloud.scenarioBreakdowns,
        payload.scenarioBreakdowns,
      ),
      attempts: mergeAttempts(cloud.attempts, payload.attempts),
    };

    await updateDoc(ref, {
      ...mergedPayload,
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
    const data = snap.data() as Partial<ProgressData>;
    // V1 cloud docs are ignored — the user opted to reset.
    if (data.version !== PROGRESS_VERSION) return null;
    return {
      version: PROGRESS_VERSION,
      sessions: data.sessions ?? [],
      byScenario: data.byScenario ?? {},
      scenarioBreakdowns: data.scenarioBreakdowns ?? {},
      attempts: data.attempts ?? [],
    };
  } catch (error) {
    console.error('Failed to load progress from cloud:', error);
    return null;
  }
}
