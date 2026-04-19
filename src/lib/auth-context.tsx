'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User } from 'firebase/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  syncProgress: () => Promise<void>;
  syncing: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  syncProgress: async () => {},
  syncing: false,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [firebaseReady, setFirebaseReady] = useState(false);

  // Lazy load firebase to avoid SSR issues and allow graceful degradation
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      // Firebase not configured — work in offline mode
      setLoading(false);
      return;
    }

    import('./firebase').then(({ onAuthChange }) => {
      setFirebaseReady(true);
      const unsub = onAuthChange((u) => {
        setUser(u);
        setLoading(false);
      });
      return unsub;
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async () => {
    if (!firebaseReady) return;
    const { signInWithGoogle } = await import('./firebase');
    await signInWithGoogle();
  }, [firebaseReady]);

  const handleSignOut = useCallback(async () => {
    if (!firebaseReady) return;
    const { signOut: fbSignOut } = await import('./firebase');
    await fbSignOut();
  }, [firebaseReady]);

  const syncProgress = useCallback(async () => {
    if (!user || !firebaseReady) return;
    setSyncing(true);
    try {
      const { syncProgressToCloud, loadProgressFromCloud } = await import('./firebase');

      // Get local progress (V2 schema — see src/lib/progress.ts)
      const localRaw = localStorage.getItem('drillProgressV2');
      const localData = localRaw
        ? JSON.parse(localRaw)
        : {
            version: 2,
            sessions: [],
            byScenario: {},
            scenarioBreakdowns: {},
            attempts: [],
          };

      // Upload local to cloud (merge)
      await syncProgressToCloud(user.uid, localData);

      // Download merged cloud data
      const cloudData = await loadProgressFromCloud(user.uid);
      if (cloudData) {
        localStorage.setItem('drillProgressV2', JSON.stringify(cloudData));
      }
      // Stamp the moment we finished syncing so staleness check works.
      localStorage.setItem('lastSyncedAt', String(Date.now()));
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(false);
    }
  }, [user, firebaseReady]);

  // Auto-sync 1: whenever user transitions to signed-in. Fires on fresh
  // sign-in AND on app open with persisted session.
  useEffect(() => {
    if (user && firebaseReady) {
      syncProgress();
    }
  }, [user, firebaseReady, syncProgress]);

  // Auto-sync 2: when the tab regains focus after being idle for >5 min,
  // re-sync so a device that sat unopened for a day pulls down recent
  // drills from other devices.
  useEffect(() => {
    if (!user || !firebaseReady) return;
    const STALE_MS = 5 * 60 * 1000; // 5 minutes
    const onFocus = () => {
      const last = Number(localStorage.getItem('lastSyncedAt') ?? 0);
      if (Date.now() - last > STALE_MS) {
        syncProgress();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onFocus();
    });
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [user, firebaseReady, syncProgress]);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut: handleSignOut, syncProgress, syncing }}>
      {children}
    </AuthContext.Provider>
  );
}
