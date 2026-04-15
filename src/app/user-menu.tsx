'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export function UserMenu() {
  const { user, loading, signIn, signOut, syncProgress, syncing } = useAuth();
  const [open, setOpen] = useState(false);

  if (loading) return null;

  if (!user) {
    return (
      <button
        onClick={signIn}
        className="text-xs px-3 py-1.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors font-medium"
      >
        Sign In
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt=""
            className="w-6 h-6 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-accent/30 flex items-center justify-center text-xs font-bold text-accent">
            {user.displayName?.[0] || user.email?.[0] || '?'}
          </div>
        )}
        <span className="hidden md:inline text-xs truncate max-w-[100px]">
          {user.displayName || user.email}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-48 bg-slate-800 rounded-lg border border-white/10 shadow-xl z-50 py-1">
            <div className="px-3 py-2 text-xs text-slate-400 border-b border-white/10 truncate">
              {user.email}
            </div>
            <button
              onClick={async () => {
                await syncProgress();
                setOpen(false);
              }}
              disabled={syncing}
              className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Sync Progress'}
            </button>
            <button
              onClick={async () => {
                await signOut();
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-slate-700 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
