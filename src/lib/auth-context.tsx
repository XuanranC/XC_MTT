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

      // Get local progress
      const localRaw = localStorage.getItem('drillProgress');
      const localData = localRaw ? JSON.parse(localRaw) : { sessions: [], byScenario: {}, byHand: {} };

      // Upload local to cloud (merge)
      await syncProgressToCloud(user.uid, localData);

      // Download merged cloud data
      const cloudData = await loadProgressFromCloud(user.uid);
      if (cloudData) {
        localStorage.setItem('drillProgress', JSON.stringify(cloudData));
      }
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(false);
    }
  }, [user, firebaseReady]);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut: handleSignOut, syncProgress, syncing }}>
      {children}
    </AuthContext.Provider>
  );
}
