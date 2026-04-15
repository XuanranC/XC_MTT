'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SCENARIO_LABELS } from '@/lib/types';

interface SessionRecord {
  id: string;
  scenario: string;
  total: number;
  correct: number;
  timestamp: number;
}

interface ProgressData {
  sessions: SessionRecord[];
  byScenario: Record<string, { total: number; correct: number; lastPracticed: number }>;
  byHand: Record<string, { total: number; correct: number }>;
}

function getProgress(): ProgressData {
  const defaultData: ProgressData = {
    sessions: [],
    byScenario: {},
    byHand: {},
  };

  try {
    const stored = localStorage.getItem('drillProgress');
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return defaultData;
}

function ProgressBar({ value, max, color = 'bg-green-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-400 w-10 text-right">{pct}%</span>
    </div>
  );
}

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);

  useEffect(() => {
    setProgress(getProgress());
  }, []);

  if (!progress) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  const totalSessions = progress.sessions.length;
  const totalQuestions = progress.sessions.reduce((s, r) => s + r.total, 0);
  const totalCorrect = progress.sessions.reduce((s, r) => s + r.correct, 0);
  const overallPct = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

  // Weak hands: sort by error rate, take top 10
  const weakHands = Object.entries(progress.byHand)
    .map(([hand, stat]) => ({
      hand,
      ...stat,
      errorRate: stat.total > 0 ? Math.round(((stat.total - stat.correct) / stat.total) * 100) : 0,
    }))
    .filter((h) => h.total >= 3 && h.errorRate > 30)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10);

  // Recent sessions (last 10)
  const recentSessions = [...progress.sessions]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);

  if (totalSessions === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center py-16">
          <div className="text-6xl mb-4">📊</div>
          <h2 className="text-xl font-bold text-slate-200 mb-2">No Progress Yet</h2>
          <p className="text-slate-400 mb-6">Start drilling to track your progress here.</p>
          <Link
            href="/drill"
            className="inline-block px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
          >
            Start Drilling
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-6">
      <h1 className="text-2xl font-bold text-slate-100 mb-6">Progress Dashboard</h1>

      {/* Overview Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-green-400">{totalSessions}</div>
          <div className="text-xs text-slate-400 mt-1">Sessions</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-blue-400">{totalQuestions}</div>
          <div className="text-xs text-slate-400 mt-1">Questions</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-amber-400">{overallPct}%</div>
          <div className="text-xs text-slate-400 mt-1">Accuracy</div>
        </div>
      </div>

      {/* By Scenario */}
      <div className="bg-slate-800 rounded-xl p-4 mb-6">
        <h2 className="font-bold text-slate-200 mb-4">Scenario Mastery</h2>
        <div className="space-y-3">
          {Object.entries(progress.byScenario)
            .sort(([, a], [, b]) => {
              const aPct = a.total > 0 ? a.correct / a.total : 0;
              const bPct = b.total > 0 ? b.correct / b.total : 0;
              return aPct - bPct;
            })
            .map(([scenario, stat]) => {
              const pct = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
              return (
                <div key={scenario}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300">
                      {SCENARIO_LABELS[scenario] || scenario}
                    </span>
                    <span className="text-slate-400">
                      {stat.correct}/{stat.total}
                    </span>
                  </div>
                  <ProgressBar
                    value={stat.correct}
                    max={stat.total}
                    color={pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500'}
                  />
                </div>
              );
            })}
        </div>
      </div>

      {/* Weak Hands */}
      {weakHands.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-4 mb-6">
          <h2 className="font-bold text-slate-200 mb-4">
            Weak Spots
            <span className="text-sm text-slate-400 font-normal ml-2">
              (hands with &gt;30% error rate, min 3 attempts)
            </span>
          </h2>
          <div className="space-y-2">
            {weakHands.map((h) => (
              <div key={h.hand} className="flex items-center justify-between py-1">
                <span className="font-mono font-bold text-white">{h.hand}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">
                    {h.correct}/{h.total}
                  </span>
                  <span className="text-sm text-red-400 font-bold w-12 text-right">
                    {h.errorRate}% err
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Sessions */}
      <div className="bg-slate-800 rounded-xl p-4 mb-6">
        <h2 className="font-bold text-slate-200 mb-4">Recent Sessions</h2>
        <div className="space-y-2">
          {recentSessions.map((s) => {
            const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
            const date = new Date(s.timestamp);
            return (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
                <div>
                  <div className="text-sm text-slate-300">
                    {SCENARIO_LABELS[s.scenario] || s.scenario}
                  </div>
                  <div className="text-xs text-slate-500">
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-bold ${pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {pct}%
                  </div>
                  <div className="text-xs text-slate-400">
                    {s.correct}/{s.total}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Export/Import */}
      <div className="bg-slate-800 rounded-xl p-4">
        <h2 className="font-bold text-slate-200 mb-3">Data Sync</h2>
        <p className="text-sm text-slate-400 mb-3">
          Export your progress to sync across devices, or import from a backup.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              const data = JSON.stringify(progress, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `gto-drill-progress-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Export JSON
          </button>
          <label className="flex-1">
            <div className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors text-center cursor-pointer">
              Import JSON
            </div>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const data = JSON.parse(reader.result as string);
                    localStorage.setItem('drillProgress', JSON.stringify(data));
                    setProgress(data);
                    alert('Progress imported successfully!');
                  } catch {
                    alert('Invalid file format.');
                  }
                };
                reader.readAsText(file);
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
